const {test}=require('node:test');const assert=require('node:assert/strict');const q=require('../draft-quality.js');
const data='2024;100;60;40;20;40;150;15\n2025;120;70;50;30;40;180;18';
test('deterministic ratios and transpose table preserve years and evidence',()=>{const r=q.finance(data);assert.deepEqual(r.metrics[0],[2024,1.5,0.4,1.5,20,10]);assert.match(r.text,/\| Показатель \| 2024 \| 2025 \|/);assert.match(r.text,/Таблица 2/);});
test('refinancing alone does not alter equity or liabilities ratios',()=>{const r=q.finance('2024;100;60;40;20;40;150;15\n2025;100;60;40;40;20;150;15');assert.equal(r.metrics[0][2],r.metrics[1][2]);assert.equal(r.metrics[0][3],r.metrics[1][3]);});
test('missing cells, broken balance and mismatching periods block preparation',()=>{assert.throws(()=>q.finance(data.replace(';100;',';;')));assert.throws(()=>q.finance(data.replace(';120;',';121;')));assert(q.preflight({topic:'Анализ финансового состояния',doc:{inputs:{organization:'А',period:'2023–2025',requirements:'Р',materials:'М',sources:'С',finance:data}}}).some(x=>x.includes('Период')));});
test('zero denominator and negative equity are explicit without infinity',()=>{const r=q.finance('2024;100;60;0;100;0;0;-15\n2025;100;60;-10;110;0;0;-15');assert.equal(r.metrics[0][1],null);assert.equal(r.metrics[1][3],null);assert(!r.text.includes('Infinity'));});
test('incomplete draft and phantom tables are not ready',()=>{const doc={order:[{id:'a',name:'А'},{id:'b',name:'Б'}],structure:{a:{text:'Таблица 1 показывает [ДАННЫЕ СТУДЕНТА: значение]'},b:{text:''}}};assert.equal(q.issues(doc).length,4);});
test('introduction and conclusion follow body, sources last; edits invalidate review',()=>{const x={topic:'Тема',doc:{order:['intro','ch1','ch2','concl','refs'].map(id=>({id,name:id})),structure:{ch1:{text:'А'}}}};assert.deepEqual(q.sequence(x.doc).map(c=>c.id),['ch1','ch2','intro','concl','refs']);const stamp=q.stamp(x);x.doc.structure.ch1.text='Б';assert.notEqual(q.stamp(x),stamp);});
test('volume notes exclude supplied financial tables and bibliography',()=>{const x={topic:'Анализ финансового состояния',doc:{inputs:{finance:data},order:[{id:'ch2',name:'Анализ',pages:1},{id:'refs',name:'Источники',pages:1}],structure:{ch2:{text:q.finance(data).text+'\n\n'+'А'.repeat(1800)},refs:{text:'Источник'}}}};assert.deepEqual(q.editorialNotes(x),[]);x.doc.structure.ch2.text+='Б'.repeat(500);assert.match(q.editorialNotes(x)[0],/длиннее/);});
test('repeated paragraphs are reported across sections, short quotations are not',()=>{const paragraph='Проверяем содержательное повторение текста в двух главах. '.repeat(4);const x={doc:{order:[{id:'a',name:'А',pages:1},{id:'b',name:'Б',pages:1}],structure:{a:{text:paragraph},b:{text:paragraph}}}};assert(q.editorialNotes(x).some(n=>n.includes('полностью повторяющий')));x.doc.structure.b.text='Другая мысль.';assert(!q.editorialNotes(x).some(n=>n.includes('полностью повторяющий')));});
test('only an exact leading duplicate title is removed',()=>{const c={name:'Глава 3. Результаты'};assert.equal(q.cleanSection('## Глава 3. Результаты\n\n3.1 Выводы\nТекст',c),'3.1 Выводы\nТекст');assert.equal(q.cleanSection('Глава 3. Результаты анализа показывают рост.',c),'Глава 3. Результаты анализа показывают рост.');assert.deepEqual(q.budget({pages:1}),{target:1800,min:1350,max:2070});});

test('review is invalidated by formatting, author and recipient edits',()=>{
 const base={id:'a',requestNumber:1,topic:'Т',student:'С',format:{size:14},doc:{order:[],structure:{}}};
 for(const [k,value] of [['id','b'],['student','Другой'],['format',{size:12}],['supervisor','Другой руководитель']]){
  const x=structuredClone(base),before=q.stamp(x);x[k]=value;assert.notEqual(q.stamp(x),before);
 }
});
test('financial recommendations flag repeated metrics and unsupported policy prescriptions',()=>{
 const x={topic:'Анализ финансового состояния'},c={id:'ch3'};
 const text='Ликвидность 1,5, автономия 0,4 и рентабельность 10%. Закрепить нормативы в учётной политике.';
 assert.equal(q.sectionNotes(x,c,text).length,2);
 assert.equal(q.sectionNotes(x,{id:'ch2'},text).length,0);
 assert.equal(q.sectionNotes(x,c,'За 2024 и 2025 годы уточнить состав оборотного капитала. Подобрать отраслевые ориентиры ликвидности, автономии и рентабельности.').length,0);
 assert.equal(q.sectionNotes(x,c,'Сопоставить сроки поступления платежей и погашения обязательств; проверить результат по платёжному календарю.').length,0);
});

test('prose word count excludes markdown tables headings code URLs and citations',()=>{
 assert.equal(q.wordCount('# Заголовок\nАнализ — это 2025 год. [S1]\n| Таблица | 999 |\n```js\nне текст\n```\n[Источник](https://example.test) https://example.test'),5);
 assert.equal(q.wordCount('из-за роста cash-flow'),3);
});
test('cloud assembly preserves exact text, orders parts and marks missing results',()=>{
 const parts=[{ordinal:2,section:'ch2',state:'done',text:'Третий абзац.'},{ordinal:0,section:'ch2',state:'done',text:'Первый абзац.'},{ordinal:1,section:'ch2',state:'unknown',text:'Нельзя включать'}];
 const before=JSON.stringify(parts),r=q.cloudReport(parts);
 assert.equal(r.sections[0].text,'Первый абзац.\n\n[Часть 2 не сохранена]\n\nТретий абзац.');
 assert.equal(r.words,4);assert.equal(r.saved,2);assert.equal(r.total,3);assert.equal(JSON.stringify(parts),before);
 assert(!r.sections[0].text.includes('Нельзя включать'));assert.equal(r.notes.length,1);
});
test('cloud assembly rejects duplicate ordinals and identifies empty or gapped plans',()=>{
 const part={ordinal:0,id:'ch1',state:'done',text:'Текст'};
 assert.equal(q.cloudReport([part,part]).sections.length,0);
 assert.equal(q.cloudReport([{...part,ordinal:-1}]).sections.length,0);
 assert.equal(q.cloudReport([]).notes.length,1);
 assert(q.cloudReport([{...part,ordinal:2}]).notes.some(n=>n.includes('пропуски')));
 assert.equal(q.cloudReport([{...part,text:' '}]).saved,0);
});
test('cloud report counts sections separately and reports repeated prose without deletion',()=>{
 const text='Содержательный абзац, который повторяется в разных частях. '.repeat(4);
 const r=q.cloudReport([{ordinal:0,section:'ch1',state:'done',text},{ordinal:1,section:'ch2',state:'done',text}]);
 assert.equal(r.sections.length,2);assert.equal(r.sections[1].text,text);assert(r.notes.some(n=>n.includes('повторяется')));
 assert.equal(r.words,2*q.wordCount(text));
});
