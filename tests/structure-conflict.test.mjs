import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicateNumberedHeadings,structureConflicts} from '../supabase/functions/_shared/structure-conflict.mjs';
import {sourceMinimumGuard} from '../supabase/functions/_shared/source-minimum.mjs';

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
