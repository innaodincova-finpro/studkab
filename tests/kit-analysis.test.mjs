import test from 'node:test';import assert from 'node:assert/strict';
import {kitPlan,kitBlocks,validKitPart,verifyKitExtraction,verifyKitReviewOutput,finishKitReview,KIT_METHOD} from '../supabase/functions/_shared/kit-analysis.mjs';
import {REVIEW_VERSION} from '../supabase/functions/_shared/registered-review.mjs';
const cell=(table,row,column,text)=>({kind:'table_cell',text,source:{part:'word/document.xml',table,row,column}});
const para=(n,text)=>({kind:'paragraph',text,source:{part:'word/document.xml',paragraph:n}});
const file=(id,name,blocks)=>({id,file_name:name,file_hash:id[0].repeat(64),read_status:'ready',read_version:'r1',read_result:{status:'ready',readerVersion:'r1',blocks}});
function source(extra={}){return {studyProtocol:REVIEW_VERSION,deadline:'2026-10-30',files:[
 file('a1','01_Задание.docx',[para(1,'Задание на курсовую работу'),cell(1,1,1,'Параметр'),cell(1,1,2,'Значение'),cell(1,2,1,'Дисциплина'),cell(1,2,2,'Менеджмент'),cell(1,3,1,'Уровень и курс'),cell(1,3,2,'Бакалавриат, 3 курс')]),
 file('b2','03_Данные.docx',[para(1,'Движение персонала'),cell(1,1,1,'Показатель'),cell(1,1,2,'2023'),cell(1,1,3,'2024'),cell(1,2,1,'Уволенные'),cell(1,2,2,'8'),cell(1,2,3,'12')]),
 file('c3','02_Методичка.docx',[para(1,'Для дипломной работы объём 80 страниц.'),para(2,'Шрифт Times New Roman, 14 пт.')])],...extra};}
const byText=(plan,t)=>plan[0].blocks.find(b=>b.text.includes(t)).blockId;
test('KIT-02: весь комплект в двух частях; строки таблиц целиком с заголовками; названия файлов видны модели',()=>{
 const plan=kitPlan(source());assert.equal(plan.length,2);assert.deepEqual(plan.map(p=>p.kind),['kit_extraction','kit_review']);
 assert.ok(plan.every(p=>p.method===KIT_METHOD&&p.temperature===0&&p.max_output_tokens===4000&&p.max_cost_microusd>0));
 const texts=plan[0].blocks.map(b=>b.text);
 assert.ok(texts.includes('Таблица 1, строка 3: Параметр: Уровень и курс | Значение: Бакалавриат, 3 курс'));
 assert.ok(texts.includes('Таблица 1, строка 2: Показатель: Уволенные | 2023: 8 | 2024: 12'));
 assert.ok(texts.some(t=>t.includes('2026-10-30')));
 const prompt=JSON.parse(plan[0].prompt);assert.deepEqual(prompt.files.map(f=>f.file),['01_Задание.docx','03_Данные.docx','02_Методичка.docx','Сведения из заявки']);
 // Адреса исходных ячеек сохранены в плане, а не в запросе.
 const row=plan[0].blocks.find(b=>b.kind==='table_row'&&b.text.includes('Уволенные'));assert.equal(row.source.cells.length,3);assert.equal(row.fileId,'b2');
 assert.ok(!plan[0].prompt.includes('word/document.xml'));
 plan.forEach((p,i)=>assert.equal(validKitPart(JSON.parse(JSON.stringify(p)),i,2),true));
 // Порядок ключей после хранения в базе не делает часть недействительной; подмена текста — делает.
 const reordered=JSON.parse(JSON.stringify(plan[1]));reordered.blocks[0]=Object.fromEntries(Object.entries(reordered.blocks[0]).reverse());assert.equal(validKitPart(reordered,1,2),true);
 const forged=JSON.parse(JSON.stringify(plan[0]));forged.blocks[0].text='Другое';assert.equal(validKitPart(forged,0,2),false);
 assert.equal(validKitPart(plan[0],1,2),false);assert.equal(validKitPart(plan[1],0,2),false);assert.equal(validKitPart({...plan[0],temperature:0.4},0,2),false);
});
test('KIT-02: сведения подтверждаются текстом указанного фрагмента; неподтверждённое отклоняется поштучно с причиной',()=>{
 const plan=kitPlan(source()),part=plan[0];
 const out={fields:[{field:'subject',value:'Менеджмент',ids:[byText(plan,'Дисциплина')]},{field:'student_name',value:'Иванов И.И.',ids:[byText(plan,'Дисциплина')]},{field:'nickname',value:'x',ids:['b0']}],
  requirements:[{type:'length',ids:[byText(plan,'80 страниц')],condition:'Для дипломной работы'},{type:'formatting',ids:[byText(plan,'Times')],condition:''},{type:'data',ids:['b999']}],
  roles:[{file:'01_Задание.docx',role:'assignment'},{file:'нет такого',role:'data'}]};
 const r=verifyKitExtraction('```json\n'+JSON.stringify(out)+'\n```',part);
 assert.deepEqual(r.candidates.map(c=>c.field),['d','length','formatting']);
 assert.equal(r.candidates[0].refs[0].fileId,'a1');assert.equal(r.candidates[1].condition,'Для дипломной работы');assert.equal(r.candidates[2].value,'Шрифт Times New Roman, 14 пт.');
 assert.deepEqual(r.rejected.map(x=>x.reason),['UNSUPPORTED_VALUE','INVALID_FIELD','INVALID_SOURCE','INVALID_ROLE']);
 assert.equal(r.roles[0].refs[0].fileId,'a1');
 assert.throws(()=>verifyKitExtraction('Вот ответ: {}',part),/INVALID_EXTRACTION/);
 assert.throws(()=>verifyKitExtraction(JSON.stringify({fields:[],requirements:[],roles:[]}),part),/EMPTY_EXTRACTION/);
 assert.throws(()=>verifyKitExtraction(JSON.stringify({fields:[],requirements:[{type:'length',ids:[byText(plan,'80 страниц')],condition:'Для магистров'}],roles:[]}),part),/EMPTY_EXTRACTION/);
 const result=finishKitReview([r],{gaps:[],answerReviews:[],returnedReviews:[]});
 assert.equal(result.fields.d.values[0].value,'Менеджмент');assert.equal(result.fields.length.status,'needs_review');assert.equal(result.kitReview.version,REVIEW_VERSION);assert.equal(result.rejected.length,4);
});
test('KIT-02: вопросы ссылаются на фрагменты оригинала; ответ студента и возвращённый вопрос проверяются',()=>{
 const s=source({studentAnswers:[{id:'ans-1',question:'Какой вид работы?',itemId:'FIELD_GAP_kind',answer:'Курсовая',source:'Сказал преподаватель',author:'st'}],reviewInstructions:[{proposalId:'p-1',itemId:'FIELD_GAP_x',comment:'Проверьте объём.'}]});
 const plan=kitPlan(s),part=plan[1],answer=part.blocks.find(b=>b.source?.questionId==='ans-1').blockId,vol=byText(plan,'80 страниц');
 assert.equal(validKitPart(JSON.parse(JSON.stringify(part)),1,2),true);
 const out={gaps:[{key:'тема',question:'Уточните вид работы.',reason:'Объём зависит от вида работы.',ids:[vol,answer],answerId:'ans-1',returnedProposalIds:['p-1']}],
  answerReviews:[{questionId:'ans-1',status:'insufficient',reason:'Ответ не подтверждён документом.',ids:[answer]}],
  returnedReviews:[{proposalId:'p-1',status:'unresolved',reason:'Условие о дипломе остаётся неясным.',ids:[vol]}]};
 const r=verifyKitReviewOutput(JSON.stringify(out),part);assert.equal(r.gaps[0].key,'gap_1');assert.equal(r.gaps[0].refs[0].quote,'Для дипломной работы объём 80 страниц.');
 assert.throws(()=>verifyKitReviewOutput(JSON.stringify({...out,gaps:[{...out.gaps[0],ids:['b999']}]}),part),/INVALID_REVIEW_SOURCE/);
 assert.throws(()=>verifyKitReviewOutput(JSON.stringify({...out,answerReviews:[]}),part),/INCOMPLETE_KIT_REVIEW/);
 assert.throws(()=>verifyKitReviewOutput(JSON.stringify({...out,gaps:[]}),part),/UNRESOLVED_STUDENT_ANSWER/);
 assert.throws(()=>verifyKitReviewOutput(JSON.stringify({...out,gaps:[{...out.gaps[0],ids:[answer]}]}),part),/INVALID_REVIEW_SOURCE/);
});
test('KIT-02: непрочитанный или слишком большой комплект не отправляется, а останавливается до оплаты',()=>{
 const unread=source();unread.files[0].read_status='failed';assert.throws(()=>kitPlan(unread),/READING_INCOMPLETE/);
 const big=source();big.files[2].read_result.blocks=Array.from({length:40},(_,i)=>para(i+1,'Требование '+i+' '+'текст '.repeat(200)));assert.throws(()=>kitPlan(big),/KIT_REVIEW_LIMIT/);
 const many=source();many.files[2].read_result.blocks=Array.from({length:520},(_,i)=>para(i+1,'п'+i));assert.throws(()=>kitBlocks(many),/KIT_REVIEW_LIMIT/);
});
