import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicateNumberedHeadings,structureConflicts,structureFindings} from '../supabase/functions/_shared/structure-conflict.mjs';
import {sourceMinimumGuard} from '../supabase/functions/_shared/source-minimum.mjs';
import {validatePassport,defaultPassport,requirementAction} from '../supabase/functions/studkab-requests/requirements.mjs';

const method=`Наименование и структура практической части работы:
2 Расчёт технико-экономических показателей производственной деятельности предприятия
2.1 Расчёт численности работников и годового фонда зарплаты предприятия
2.2 Составление сметы затрат на производство продукции
2.3 Составление калькуляции затрат по видам изделий и расчёт цены продукции
2.3 Расчёт финансовых результатов деятельности предприятия
2.5 Определение среднеквартальных остатков оборотных средств
2.6 Расчёт показателей производственно-хозяйственной деятельности предприятия`;
const id='11111111-1111-4111-8111-111111111111';
test('same number on different nearby TUSUR headings is an unresolved conflict',async()=>{
 const conflicts=duplicateNumberedHeadings(method);
 assert.equal(conflicts.length,1);assert.equal(conflicts[0].number,'2.3');
 const file={category:'methodology',file_name:'tusur_method.pdf',file_hash:'a'.repeat(64),extracted_text:method};
 assert.equal(structureConflicts([file]).fileName,'tusur_method.pdf');
 const block=await sourceMinimumGuard(async()=>[file],id,[{id:'STRUCTURE',text:'Сверена структура',source:'PDF'}]);
 assert.equal(block.code,'STRUCTURE_NUMBER_CONFLICT');assert.match(block.error,/2\.3/);
});
test('identical table-of-contents and body headings do not falsely conflict',()=>{
 const text='2.3 Составление калькуляции затрат ........ 14\n'+('Текст раздела.\n').repeat(200)+'2.3 Составление калькуляции затрат\n';
 assert.deepEqual(duplicateNumberedHeadings(text),[]);
 assert.deepEqual(duplicateNumberedHeadings('2.1 Первый раздел\n2.2 Второй раздел\n2.3 Третий раздел'),[]);
});
test('TUSUR appendix variants reuse 1.1 without adding a false conflict',()=>{
 const appendix=`6. Финансовые результаты деятельности предприятия
1. Теоретически основы исследования финансовых результатов деятельности предприятия
1.1 Сущностная характеристика финансовых результатов
деятельности предприятия
1.2. Виды прибыли и порядок формирования прибыли предприятия
1.3. Направления повышения финансовых результатов деятельности предприятия
7. Издержки производства и факторы их снижения
1. Себестоимость производства как экономическая категория
1.1. Понятие издержек и себестоимости продукции
1.2. Классификация затрат образующих издержки производства
1.3. Источники и факторы снижения издержек предприятия
8 Особенности современного предпринимательства
1.Теоретические аспекты предпринимательства.
1.1.Сущность предпринимательства, его цели и задачи.
1.2. Формы предпринимательской деятельности.
1.3. Современные особенности предпринимательства.
9 Производственная программа предприятия и пути её формирования.
1. Формирование производственной программы предприятия
1.1 Понятие и система показателей производственной
программы предприятия.
1.2 Алгоритм разработки производственной программы.
1.3. Условия оптимальной производственной программы.`;
 assert.deepEqual(duplicateNumberedHeadings(appendix),[]);
 assert.deepEqual(duplicateNumberedHeadings(method+'\n'+appendix).map(x=>x.number),['2.3']);
});
test('different documents may reuse numbering independently and no extracted headings is not approval',()=>{
 assert.equal(structureConflicts([{category:'assignment',extracted_text:'2.3 Первый раздел'},{category:'methodology',extracted_text:'2.3 Другой раздел'}]),null);
 assert.deepEqual(duplicateNumberedHeadings('Не удалось распознать документ'),[]);
});
test('confirmed resolution is bound to the exact file and two headings',async()=>{
 const file={category:'methodology',file_name:'tusur_method.pdf',file_hash:'a'.repeat(64),extracted_text:method};
 const conflict=structureFindings([file])[0];
 const resolution={fileHash:file.file_hash,number:conflict.number,first:conflict.first,second:conflict.second,chosenNumber:'2.4',reason:'Последовательность 2.3, 2.5; проверены оба заголовка',verified:true};
 const p=defaultPassport({});const item=p.items.find(q=>q.id==='STRUCTURE');item.verified=true;item.source='Методичка, с. 6';item.text='Структура: 2.4 '+conflict.second;item.structure_resolutions=[resolution];
 const saved=validatePassport(p).items;
 assert.equal(structureFindings([file],saved)[0].resolved,true);
 assert.equal(await sourceMinimumGuard(async()=>[file],id,saved),null);
 for(const altered of [{...file,file_hash:'b'.repeat(64)},{...file,extracted_text:method.replace('финансовых результатов','финансовых итогов')}])assert.equal(structureFindings([altered],saved)[0].resolved,false);
 for(const invalid of [{...resolution,chosenNumber:'2.5'},{...resolution,reason:'нет'},{...resolution,verified:false}]){
  const items=saved.map(q=>q.id==='STRUCTURE'?{...q,structure_resolutions:[invalid]}:q);
  assert.equal((await sourceMinimumGuard(async()=>[file],id,items)).code,'STRUCTURE_NUMBER_CONFLICT');
 }
});
test('executor can read exact conflict; student cannot access private audit',async()=>{
 const file={category:'methodology',file_name:'method.pdf',file_hash:'a'.repeat(64),extracted_text:method};
 const deps={config:async()=>({executor_email:'executor@example.test'}),db:async path=>{
  if(path.startsWith('studkab_requests?'))return [{id,ready_at:'2026-09-26T00:00:00Z',revision:1,studkab_material_revisions:[],studkab_request_reassignments:[]}];
  if(path.startsWith('studkab_requirement_passports?'))return [{items:defaultPassport({}).items}];
  if(path.startsWith('studkab_request_attachments?'))return [file];
  throw Error('Unexpected '+path);
 }};
 const input={action:'passport-structure-audit',id};
 const allowed=await requirementAction(input,{id,email:'executor@example.test'},deps);
 assert.equal(allowed.status,200);assert.equal(allowed.data.findings[0].number,'2.3');
 assert.equal((await requirementAction(input,{id,email:'student@example.test'},deps)).status,403);
});
test('passport approval accepts only a persisted confirmed resolution for current source',async()=>{
 const file={category:'methodology',file_name:'method.pdf',file_hash:'a'.repeat(64),extracted_text:method};
 const conflict=structureFindings([file])[0];
 const passport=defaultPassport({});passport.items=passport.items.map(q=>({...q,verified:true,source:q.id==='ANTIPLAGIARISM'?'Стандарт STUDKAB и методичка':'Методичка, с. 6',text:q.id==='ANTIPLAGIARISM'?'Внешний отчёт по стандарту STUDKAB; в предоставленных материалах числовое условие вуза не обнаружено.':q.id==='STRUCTURE'?'Структура: 2.4 '+conflict.second:'Подтверждённое требование',...(q.id==='ANTIPLAGIARISM'?{originality:{mode:'service_only',service:'',thresholdPercent:null}}:{})}));
 const item=passport.items.find(q=>q.id==='STRUCTURE');item.structure_resolutions=[{fileHash:file.file_hash,number:conflict.number,first:conflict.first,second:conflict.second,chosenNumber:'2.4',reason:'Номер 2.4 свободен между 2.3 и 2.5 в учебном кейсе',verified:true}];
 let approved=0;const deps={config:async()=>({executor_email:'executor@example.test'}),db:async path=>{
  if(path.startsWith('studkab_requests?'))return [{id,ready_at:'2026-09-26T00:00:00Z',revision:1,studkab_material_revisions:[],studkab_request_reassignments:[]}];
  if(path.startsWith('studkab_requirement_passports?'))return [{items:validatePassport(passport).items}];
  if(path.startsWith('studkab_request_attachments?'))return [file];
  if(path==='rpc/studkab_material_manifest_check')return {valid:true};
  if(path==='rpc/studkab_requirement_passport_approve'){approved++;return {status:'approved'};}
  throw Error('Unexpected '+path);
 }};
 const input={action:'passport-approve',id,passportId:id,sourceFingerprint:'b'.repeat(64),passport};
 assert.equal((await requirementAction(input,{id,email:'executor@example.test'},deps)).status,200);assert.equal(approved,1);
 item.structure_resolutions[0].fileHash='c'.repeat(64);
 const blocked=await requirementAction(input,{id,email:'executor@example.test'},deps);
 assert.equal(blocked.status,409);assert.equal(blocked.data.code,'STRUCTURE_NUMBER_CONFLICT');assert.equal(approved,1);
});
test('a document with more conflicts than the review limit cannot bypass the gate',async()=>{
 const headings=Array.from({length:13},(_,i)=>`${i+1}.1 Первый подраздел\n${i+1}.1 Второй подраздел`).join('\n');
 const file={category:'methodology',file_name:'many.pdf',file_hash:'a'.repeat(64),extracted_text:headings};
 const issues=structureFindings([file]);assert.equal(issues.length,13);assert.equal(issues.at(-1).tooMany,true);
 const block=await sourceMinimumGuard(async()=>[file],id,[{id:'STRUCTURE',verified:true,source:'Методичка',text:'Структура'}]);
 assert.equal(block.code,'STRUCTURE_NUMBER_CONFLICT');
});
