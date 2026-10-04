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
 // KIT-05: вопрос без подтверждённого основания отклоняется; ответ студента без вопроса остаётся ошибкой.
 assert.throws(()=>verifyKitReviewOutput(JSON.stringify({...out,gaps:[{...out.gaps[0],ids:['b999']}]}),part),/UNRESOLVED_STUDENT_ANSWER/);
 assert.throws(()=>verifyKitReviewOutput(JSON.stringify({...out,answerReviews:[]}),part),/INCOMPLETE_KIT_REVIEW/);
 assert.throws(()=>verifyKitReviewOutput(JSON.stringify({...out,gaps:[]}),part),/UNRESOLVED_STUDENT_ANSWER/);
 assert.throws(()=>verifyKitReviewOutput(JSON.stringify({...out,gaps:[{...out.gaps[0],ids:[answer]}]}),part),/UNRESOLVED_STUDENT_ANSWER/);
});
test('KIT-02: непрочитанный или слишком большой комплект не отправляется, а останавливается до оплаты',()=>{
 const unread=source();unread.files[0].read_status='failed';assert.throws(()=>kitPlan(unread),/READING_INCOMPLETE/);
 const big=source();big.files[2].read_result.blocks=Array.from({length:40},(_,i)=>para(i+1,'Требование '+i+' '+'текст '.repeat(200)));assert.throws(()=>kitPlan(big),/KIT_REVIEW_LIMIT/);
 const many=source();many.files[2].read_result.blocks=Array.from({length:520},(_,i)=>para(i+1,'п'+i));assert.throws(()=>kitBlocks(many),/KIT_REVIEW_LIMIT/);
});

test('KIT-05: отдельный неподтверждённый вопрос отклоняется с причиной, остальные сохраняются',()=>{
 const plan=kitPlan(source()),part=plan[1],vol=byText(plan,'80 страниц'),ids=part.blocks.filter(b=>b.fileId).map(b=>b.blockId);
 const ok={key:'k1',type:'missing',question:'Где данные?',reason:'Без них нельзя.',ids:[vol]};
 const out={gaps:[ok,{...ok,key:'k2',ids:['b999']},{...ok,key:'k3',type:'conflict',ids:[vol]},{...ok,key:'k4',type:'other'},{...ok,key:'k5',ids:[...ids,...ids,'b999'].slice(0,20)}],answerReviews:[],returnedReviews:[]};
 const r=verifyKitReviewOutput(JSON.stringify(out),part);
 assert.deepEqual(r.gaps.map(g=>g.key),['k1','k5']);assert.equal(r.gaps[0].type,'missing');assert.ok(r.gaps[1].refs.length<=12);
 assert.deepEqual(r.rejected.map(x=>x.reason),['INVALID_REVIEW_SOURCE','CONFLICT_NEEDS_TWO_SOURCES','INVALID_GAP_TYPE']);
 assert.equal(finishKitReview([{candidates:[],roles:[],rejected:[]}],r).kitReview.rejected.length,3);
});
test('KIT-05: в строке таблицы название столбца видно, даже если оно совпадает со значением',()=>{
 const file={id:'f',file_name:'d.docx',file_hash:'h',read_status:'ready',read_version:'v',read_result:{status:'ready',readerVersion:'v',blocks:[cell(1,1,1,'Оценка'),cell(1,1,2,'5'),cell(1,2,1,'Ответы'),cell(1,2,2,'5')]}};
 const rows=kitBlocks({files:[file]}).map(b=>b.text);
 assert.equal(rows[1],'Таблица 1, строка 2: Оценка: Ответы | 5: 5');
});

test('KIT-07: прямой выбор студентом одного из расходящихся значений закрывает противоречие; «файл приложен» без файла — нет',async()=>{
 const {CHECKLIST_DIALOG_SYSTEM}=await import('../supabase/functions/_shared/checklist-review.mjs');
 assert.match(CHECKLIST_DIALOG_SYSTEM,/прямо выбрал одно из этих значений[^.]*— это sufficient/);
 assert.match(CHECKLIST_DIALOG_SYSTEM,/приложил файл или данные, а среди фрагментов их нет, — insufficient/);
 // Правило добавлено только в инструкцию с ответами; JSON-формат ответа прежний.
 assert.match(CHECKLIST_DIALOG_SYSTEM,/Верни только JSON без пояснений: \{"checks"/);
});

test('KIT-07b: достаточный ответ студента закрывает расхождение параметра, найденное программой',async()=>{
 const {checklistReviewOutput}=await import('../supabase/functions/_shared/checklist-review.mjs');
 const blocks=[
  {blockId:'b0',text:'Основная часть 25–30 страниц',fileId:'f1',fileHash:'h1',fileName:'01.docx',readerVersion:'r',source:{part:'word/document.xml',paragraph:1}},
  {blockId:'b1',text:'Объём 40–45 страниц',fileId:'f2',fileHash:'h2',fileName:'02.docx',readerVersion:'r',source:{part:'word/document.xml',paragraph:2}},
  {blockId:'b2',text:'Применять объём из задания: 25–30 страниц',source:{kind:'student_answer',questionId:'q1'}}];
 const inventory={needs:[],params:[{kind:'volume',name:'объём основной части',value:'25–30 страниц',ids:['b0']},{kind:'volume',name:'объём основной части',value:'40–45 страниц',ids:['b1']}]};
 const request={blocks,checks:[],returned:[],answers:[{id:'q1',question:'В комплекте указаны разные значения параметра «объём основной части»: «25–30 страниц» и «40–45 страниц». Какое значение применять?'}]};
 const run=status=>checklistReviewOutput(JSON.stringify({checks:[],answerReviews:[{questionId:'q1',status,reason:'Студент выбрал значение из задания.',ids:['b2','b0'],question:status==='sufficient'?'':'Уточните объём.'}],returnedReviews:[]}),request,inventory);
 const ok=run('sufficient');
 assert.equal(ok.gaps.length,0);assert.equal(ok.answerReviews[0].status,'sufficient');
 const bad=run('insufficient');
 assert.deepEqual(bad.gaps.map(g=>g.type+':'+g.key),['conflict:conflict_1','missing:answer_1']);
 // Ответ на другой вопрос не закрывает расхождение объёма.
 const other={...request,answers:[{id:'q1',question:'Пришлите результаты опроса.'}]};
 const r=checklistReviewOutput(JSON.stringify({checks:[],answerReviews:[{questionId:'q1',status:'sufficient',reason:'Данные приложены.',ids:['b2','b0']}],returnedReviews:[]}),other,inventory);
 assert.deepEqual(r.gaps.map(g=>g.key),['conflict_1']);
});
