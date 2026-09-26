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
