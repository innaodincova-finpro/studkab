const {test}=require('node:test');const assert=require('node:assert/strict');const q=require('../draft-quality.js');
test('student attachments augment rather than overwrite executor inputs',()=>{const x={doc:{inputs:{materials:'Ручные материалы',sources:'Ручной источник'},attachmentMaterials:'Файл задания',attachmentSources:'Файл источников'}};const p=q.inputs(x);assert.match(p.materials,/Ручные материалы[\s\S]*Файл задания/);assert.match(p.sources,/Ручной источник[\s\S]*Файл источников/);assert.equal(x.doc.inputs.materials,'Ручные материалы');});
test('approved passport sources must all appear in bibliography',()=>{const x={passports:[{status:'approved',items:[{id:'SOURCES',text:'Источники: ISO 21502:2020; PMBOK Guide, 7-е издание, 2021'}]}],doc:{inputs:{sources:'[S1] PMBOK Guide. 7th ed. 2021.'},order:[{id:'intro',name:'Введение'},{id:'refs',name:'Источники'}],structure:{intro:{text:'Содержательный текст [S1].'},refs:{text:'[S1] PMBOK Guide. 7th ed. 2021.'}}}};assert.match(q.sourceCheck(x).errors.join('\n'),/ISO 21502:2020/);});
test('source evidence binds verified details and fragment to a supported claim',()=>{
 const good='[S1]\nРеквизиты: Иванов И. И. Управление проектами. 2024. С. 15.\nФрагмент: Проектная команда распределяет ответственность между участниками.\nПодтверждает: В разделе 1 описано распределение ответственности.';
 const card=q.sourceEvidence(good);assert.equal(card.errors.length,0);assert.match(card.cards[1].fragment,/распределяет ответственность/);
 for(const bad of [
  '[S1]\nФрагмент: Достаточно длинный проверяемый фрагмент источника.\nПодтверждает: Утверждение раздела 1.',
  '[S1]\nРеквизиты: Автор, название, 2024.\nПодтверждает: Утверждение раздела 1.',
  '[S1]\nРеквизиты: Автор, название, 2024.\nФрагмент: Достаточно длинный проверяемый фрагмент источника.'
 ])assert.ok(q.sourceEvidence(bad).errors.length);
});
test('one-word prose fragment blocks readiness',()=>{const x={doc:{order:[{id:'ch2',name:'Глава 2'}],structure:{ch2:{text:'Основной вывод подтверждён материалами. Дополнительно.'}}}};assert.match(q.proseIntegrity(x).errors.join('\n'),/Дополнительно/);});
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

test('FIN-UAT labelled profile measures body only and never grants blanket acceptance',()=>{
 const req='УЧЕБНАЯ МЕТОДИЧКА FIN-UAT-01\nАвторские критерии приёмки версии 1.0.';
 const counts={intro:500,ch1:1400,ch2:2800,ch3:900,concl:400,refs:12000,app_a:100,app_b:100,app_c:100};
 const x={doc:{inputs:{requirements:req},order:Object.keys(counts).map(id=>({id})),structure:Object.fromEntries(Object.entries(counts).map(([id,n])=>[id,{text:'слово '.repeat(n)}]))}};
 const r=q.finAcceptance(x);assert.equal(r.total,6000);assert.equal(r.errors.length,2);assert.match(r.errors[1],/не подтверждена/);
 x.doc.structure.ch2.text='Коротко.';assert(q.finAcceptance(x).errors.some(e=>e.startsWith('Глава 2: 1 слов')));
 x.doc.inputs.requirements=req.replace('версии 1.0.','версии 2.0.');assert.match(q.finAcceptance(x).errors[0],/отличаются/);
 assert.equal(q.finAcceptance({doc:{inputs:{requirements:'Иное задание'}}}).applicable,false);
});
test('final review uses universal criteria outside the labelled financial profile',()=>{
 const management=q.reviewCriteria({topic:'Управление проектной командой',doc:{inputs:{requirements:'Методические требования кафедры менеджмента'}}});
 assert.equal(management.length,16);assert.deepEqual(management.map(x=>x.code),Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']));
 assert(management.some(x=>x.label.includes('методички')));assert(management.some(x=>x.label.includes('неприменимы')));
 assert(!management.some(x=>/прибыль|денежные потоки|финансов/i.test(x.label)));
 const finance=q.reviewCriteria({doc:{inputs:{requirements:'УЧЕБНАЯ МЕТОДИЧКА FIN-UAT-01\nАвторские критерии приёмки версии 1.0.'}}});
 assert(finance.some(x=>x.label==='Прибыль и денежные потоки'));
});
test('document acceptance applies measurable requirements from this methodology',()=>{
 const x={methodNotes:'Не менее 2 таблиц\n1 рисунок\n2 приложения',doc:{inputs:{requirements:'Работа должна содержать обязательные элементы.'},order:[{id:'intro',name:'Введение',pages:1},{id:'body',name:'Основная часть',pages:2},{id:'app_a',name:'Приложение А',pages:1}],structure:{intro:{text:'Текст'},body:{text:'| А | Б |\n| --- | --- |\n| 1 | 2 |',figures:[{mimeType:'image/png'}]},app_a:{text:'Материал'}}}};
 const result=q.documentAcceptance(x);
 assert.deepEqual(result.profile.minimum,{tables:2,figures:1,appendices:2});
 assert.deepEqual(result.facts,{tables:1,figures:1,appendices:1,sections:['intro','body','app_a']});
 assert(result.errors.some(e=>e.includes('не менее 2 таблиц')));assert(result.errors.some(e=>e.includes('не менее 2 приложений')));assert(!result.errors.some(e=>e.includes('рисунков')));
});
test('document acceptance uses saved section passport and never invents missing methodology',()=>{
 const x={doc:{inputs:{requirements:'Методичка кафедры'},order:[{id:'a',name:'Раздел А',pages:1},{id:'b',name:'Раздел Б',pages:2}],structure:{a:{text:'Готово'},b:{text:''}}}};
 const result=q.documentAcceptance(x);assert.equal(result.profile.sections.length,2);assert(result.errors.some(e=>e.includes('Раздел Б')));
 const absent=q.documentAcceptance({doc:{order:[],structure:{},inputs:{requirements:''}}});assert(absent.errors.some(e=>e.includes('не зафиксированы')));
});
test('ordinary volume gate measures body but not bibliography or appendices',()=>{
 const body='слово '.repeat(220),short='служебный материал';
 const x={doc:{inputs:{requirements:'Нефинансовая методичка'},order:[
  {id:'intro',name:'Введение',pages:1},{id:'refs',name:'Список использованных источников',pages:1},
  {id:'sec-app',name:'Приложение А',pages:1}
 ],structure:{intro:{text:body},refs:{text:short},'sec-app':{text:short}}}};
 const result=q.finAcceptance(x);
 assert.equal(result.applicable,true);assert.equal(result.total,220);assert.equal(result.sections.length,1);
 assert.equal(result.sections[0].id,'intro');assert.equal(result.errors.length,0);
});
test('maximum and ambiguous ranges are not misread as minimum requirements',()=>{
 const x={methodNotes:'Не более 5 таблиц; от 2 до 4 рисунков; минимум 1 приложение',doc:{inputs:{requirements:'Требования приложены'},order:[],structure:{}}};
 assert.deepEqual(q.requirementProfile(x).minimum,{tables:null,figures:null,appendices:1});
});
test('cloud Word captures only one job, preserves gaps and carries version and incomplete notice',()=>{
 const info={job:{id:'test-job',version:'abc123'},parts:[{ordinal:0,section:'ch2',state:'done',text:'Облачный текст.'},{ordinal:1,section:'ch2',state:'unknown',text:null}]};
 const before=JSON.stringify(info),d=q.cloudDraft(info);assert.equal(d.draftNotice,'Неполный черновик');assert.match(d.structure.notice.text,/abc123/);assert.match(d.structure.cloud_0.text,/Часть 2 не сохранена/);
 info.parts[0].text='Другая версия';assert.match(d.structure.cloud_0.text,/Облачный текст/);assert.notEqual(JSON.stringify(info),before);
 assert.throws(()=>q.cloudDraft({job:{id:'a',version:'b'},parts:[]}));assert.throws(()=>q.cloudDraft({...info,job:{id:'a'}}));
});
test('Word preserves editable tables with 12pt single spacing and native subsection heading',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ctx={window:{},TextEncoder,Blob};vm.runInNewContext(fs.readFileSync('result-docx.js','utf8'),ctx);
 const blob=ctx.window.ResultDocx({topic:'Тест',draftNotice:'Неполный черновик',structure:{ch2:{text:'### 2.1 Анализ\nТекст.\n| Показатель | 2025 |\n| --- | --- |\n| Активы | 12800 |'}}},[{id:'ch2',name:'Глава 2'}]);
 const zip=Buffer.from(await blob.arrayBuffer()).toString('utf8');assert(zip.includes('Неполный черновик'));assert(!zip.includes('### 2.1'));assert(zip.includes('<w:pStyle w:val="Heading2"/>'));
 const table=zip.slice(zip.indexOf('<w:tbl>'),zip.indexOf('</w:tbl>'));assert(table.includes('<w:tblHeader/>'));assert(table.includes('w:sz w:val="24"'));assert(table.includes('w:line="240"'));assert(!table.includes('w:sz w:val="28"'));
});

test('C074 original assignment minima survive a weakened passport and summary approval',()=>{
 const x={passports:[{status:'approved',summary:'Согласовано',items:[{id:'P1',text:'Объём 25–30 страниц; структура: введение, три главы, заключение, не менее 5 источников и приложения. Использовать только предоставленные данные и S1–S5.'}]}],doc:{inputs:{requirements:'Задание'},attachmentMaterials:'Файл: задание.docx; категория: assignment; SHA-256: test\nСписок источников\n\nНе менее 10 позиций; в тесте использовать материалы',order:[{id:'refs',name:'Источники'}],structure:{refs:{text:Array.from({length:5},(_,i)=>`${i+1}. Учебный источник`).join('\n')}}}};
 const before=JSON.stringify(x),r=q.sourceRequirements(x);
 assert.equal(r.minimum,10);assert.equal(r.passportMinimum,5);assert.equal(r.bibliographyEntries,5);
 assert.equal(r.errors.length,2);assert(q.documentAcceptance(x).errors.some(e=>e.includes('меньший минимум')));
 assert.equal(JSON.stringify(x),before);
 x.passports[0].items[0].text='Не менее 10 источников.';
 assert.equal(q.sourceRequirements(x).errors.length,1); // Correcting passport alone never makes five references ten.
 x.doc.structure.refs.text=Array.from({length:10},(_,i)=>`${i+1}. Учебный источник`).join('\n');
 assert.deepEqual(q.sourceRequirements(x).errors,[]);
});
test('C074 evidence report distinguishes blockers, observations and manual verification',()=>{
 const x={topic:'Менеджмент',doc:{inputs:{requirements:'Проверить содержание',materials:'Учебные данные',sources:''},order:[{id:'intro',name:'Введение'}],structure:{intro:{text:'Текст.'}}}};
 const r=q.riskReport(x);assert.equal(r.sources.minimum,null);assert(r.manual.length>0);
 assert(r.groups.some(g=>g.title==='Источники и ссылки'));assert(r.blockers.length>0);
 assert(!JSON.stringify(r).includes('все требования выполнены'));
});
test('C074 browser and Edge explicit minima remain equivalent',async()=>{
 const {explicitMinima}=await import('../supabase/functions/_shared/source-minimum.mjs');
 for(const text of ['Не менее 10 источников.','Список источников\n\nНе менее 10 позиций; в тесте использовать материалы','Минимальное количество источников: 12','Не более 10 источников','В материалах 5 источников','Не менее 5 источников на иностранном языке','Не менее 10 источников, из них минимум 5 источников.'])assert.deepEqual(q.sourceMinima(text),explicitMinima(text));
});

test('C074 numeric statements in data attachments are not treated as assignment minima',()=>{
 const x={doc:{attachmentMaterials:'Файл: данные.docx; категория: data; SHA-256: test\nВ опросе респонденту предложено минимум 50 источников.',structure:{},order:[]}};
 assert.equal(q.sourceRequirements(x).minimum,null);
 x.doc.attachmentMaterials+='\n\n---\n\nФайл: задание.docx; категория: assignment; SHA-256: test\nНе менее 10 источников.';
 assert.equal(q.sourceRequirements(x).minimum,10);
});

const duplicateCard='[S1]\nРеквизиты: Учебный конспект, 2026, с. 4–6\nФрагмент: Показатели должны быть определены до начала измерения.\nПодтверждает: Необходимость заранее определить показатели.';
const plainOccurrence='S1 Учебный конспект, 2026, с. 4–6\nПоказатели должны быть определены до начала измерения.';
test('explicit source card survives attached plain occurrence in both orders',()=>{
 for(const parts of [[duplicateCard,plainOccurrence],[plainOccurrence,duplicateCard]]){
  const result=q.sourceEvidence(parts.join('\n\n'));
  assert.deepEqual(result.errors,[]);assert.equal(result.cards[1].fragment,'Показатели должны быть определены до начала измерения.');
 }
 const x={doc:{inputs:{sources:duplicateCard},attachmentSources:plainOccurrence}};
 assert.deepEqual(q.sourceEvidence(q.inputs(x).sources).errors,[]);
});
test('identical cards are harmless but conflicting cards block in both orders',()=>{
 assert.deepEqual(q.sourceEvidence(duplicateCard+'\n'+duplicateCard).errors,[]);
 const other=duplicateCard.replace('Учебный конспект','Другой конспект');
 for(const parts of [[duplicateCard,other],[other,duplicateCard]])assert.match(q.sourceEvidence(parts.join('\n')).errors.join(' '),/различающиеся карточки/);
});
test('incomplete duplicate cards cannot fabricate a complete source by merging fields',()=>{
 const parts=['[S1]\nРеквизиты: Учебный конспект, 2026','[S1]\nФрагмент: Проверяемый фрагмент длиной больше двадцати знаков.\nПодтверждает: Утверждение первой главы.'];
 for(const list of [parts,[...parts].reverse()])assert.ok(q.sourceEvidence(list.join('\n')).errors.length>0);
 assert.ok(q.sourceEvidence(plainOccurrence).errors.length>0);
});

test('C078 numeric citations resolve bibliography positions to evidence cards, including ranges',()=>{
 const cards=[1,2,3].map(n=>'[S'+n+']\nРеквизиты: Автор '+n+'. Подтверждённое исследование '+n+'. 2026.\nФрагмент: Проверенный фрагмент для сопоставления источника.\nПодтверждает: конкретное утверждение документа.').join('\n\n');
 const x={doc:{inputs:{sources:cards},order:[{id:'ch1',name:'Глава 1'},{id:'refs',name:'Источники'}],structure:{ch1:{text:'Первый [1], второй [2, с. 12], все [1–3] и [1]–[3].'},refs:{text:[1,2,3].map(n=>n+'. Автор '+n+'. Подтверждённое исследование '+n+'. 2026.').join('\n')}}}};
 assert.deepEqual(q.sourceCheck(x).errors,[]);assert.deepEqual(q.sourceCheck(x).used,[1,2,3]);
 x.doc.structure.ch1.text='Составная ссылка [1; 2; 3].';assert.deepEqual(q.sourceCheck(x).errors,[]);
 x.doc.structure.refs.text='1. Автор 3. Подтверждённое исследование 3. 2026.\n2. Автор 1. Подтверждённое исследование 1. 2026.\n3. Автор 2. Подтверждённое исследование 2. 2026.';
 assert.deepEqual(q.sourceCheck(x).used,[3,1,2]);
 x.doc.structure.refs.text='1. Неизвестный автор и совершенно другая книга. 2026.';
 assert(q.sourceCheck(x).errors.some(e=>e.includes('не сопоставлена')));
 x.doc.structure.ch1.text='Явные ссылки [S1–S3].';assert.deepEqual(q.sourceCheck(x).errors,[]);
 x.doc.structure.ch1.text='Неизвестный [S9].';assert(q.sourceCheck(x).errors.some(e=>e.includes('нет в списке')));
});
test('C078 ambiguous bibliography does not validate numeric references',()=>{
 const cards=q.sourceEvidence('[S1]\nРеквизиты: Один автор. Название общего источника. 2026.\nФрагмент: Проверенный фрагмент длиной более двадцати знаков.\nПодтверждает: утверждение в работе.\n[S2]\nРеквизиты: Один автор. Название общего источника. 2026.\nФрагмент: Иной проверенный фрагмент длиной более двадцати знаков.\nПодтверждает: другое утверждение в работе.').cards;
 assert.deepEqual(q.bibliographyLinks('1. Один автор. Название общего источника. 2026.',cards),{});
 assert.deepEqual(q.bibliographyLinks('1. [S1] Источник\n1. [S2] Другой',cards),{});
 assert.deepEqual(q.citationTokens('[0] [3–1] [1–999] [2026] [данные студента]'),[]);
});

test('C078 absent volume guidance does not invent an appendix target',()=>{
 const x={doc:{order:[{id:'app_a',name:'Приложение А',pages:0}],structure:{app_a:{text:'Краткие данные.'}}}};
 assert.deepEqual(q.editorialNotes(x),[]);
});

test('C086 section prompts carry latest approved requirements without mutating source basis',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const html=fs.readFileSync(require.resolve('../reestr.html'),'utf8');
 const build=html.slice(html.indexOf('function approvedStructure(x){'),html.indexOf('/* ---------- ПОСТАВЩИКИ'));
 const section=html.slice(html.indexOf('function sectionPrompt(x, c){'),html.indexOf('function ruPages('));
 const ctx={DraftQuality:q,docOf:x=>x.doc};vm.createContext(ctx);vm.runInContext(build+'\n'+section,ctx);
 for(const [topic,condition] of [['Педагогика','Сравнить пять подходов; сформулировать пять рекомендаций.'],['Менеджмент','Предложить четыре мероприятия с затратами.'],['История','Сравнить три трактовки; расчёты не предусмотрены.']]){
  const x={topic,passports:[{id:'current',revision:6,status:'approved',items:[{id:'TEACHER',text:condition,source:'Ответ преподавателя от 22.09.2026'}]}],doc:{inputs:{requirements:'Исходное задание',materials:'Материалы',sources:'Источники'},order:[{id:'ch3',name:'Предложения',pages:3}],structure:{}}};
  const before=JSON.stringify(x),basis=JSON.stringify(q.inputs(x));
  const prompt=ctx.sectionPrompt(x,x.doc.order[0]);
  assert(prompt.system.includes(condition));assert(prompt.system.includes('Ответ преподавателя от 22.09.2026'));assert(prompt.system.includes('"revision":6'));
  assert(!prompt.user.includes('не более трёх'));assert(!prompt.system.includes('Автономия равна'));
  assert.equal(JSON.stringify(x),before);
  x.passports[0].items[0].text='Изменённое подтверждённое условие';
  assert(ctx.sectionPrompt(x,x.doc.order[0]).system.includes('Изменённое подтверждённое условие'));
  assert.equal(JSON.stringify(q.inputs(x)),basis);
  for(const state of ['draft','stale']){
   x.passports.unshift({status:state,items:[]});
   assert(!ctx.sectionPrompt(x,x.doc.order[0]).system.includes('Изменённое подтверждённое условие'));
   x.passports.shift();
  }
 }
 assert(!q.sectionRules({id:'ch2'}).includes('числитель и знаменатель'));
 assert(q.sectionRules({id:'custom'}).includes('утверждённом паспорте'));
});

test('C087 approximate word ranges warn but never certify or reject Word pagination',()=>{
 for(const words of [30,300,1000]){
  const x={topic:'Педагогика',doc:{inputs:{requirements:'Основной текст: 1 страница'},order:[{id:'intro',name:'Введение',pages:1}],structure:{intro:{text:'слово '.repeat(words)}}}};
  const before=JSON.stringify(x),volume=q.finAcceptance(x),report=q.riskReport(x);
  assert.deepEqual(volume.errors,[]);assert(volume.notes.some(n=>n.includes('приблизительный ориентир')));
  assert(report.notes.some(n=>n.includes('приблизительный ориентир')));
  assert(!report.blockers.some(n=>n.includes('приблизительный ориентир')));
  assert(report.manual.some(n=>n.includes('страницы точного Word')));
  assert(q.reviewCriteria(x).find(c=>c.code==='C12').label.includes('фактические страницы'));
  assert.equal(JSON.stringify(x),before);
  x.doc.structure.intro.text='';
  assert(q.riskReport(x).blockers.some(n=>/Не заполнен раздел|отсутствует раздел/.test(n)));
 }
 const fin={doc:{inputs:{requirements:'УЧЕБНАЯ МЕТОДИЧКА FIN-UAT-01\nАвторские критерии приёмки версии 1.0.'},order:[{id:'intro',name:'Введение',pages:2}],structure:{intro:{text:'слово '.repeat(30)}}}};
 assert(q.finAcceptance(fin).errors.some(n=>n.includes('требуется 500–700')));
});

test('C088 explicit percentage arithmetic catches errors and accepts rounding without evaluating prose',()=>{
 const work=text=>({doc:{order:[{id:'body',name:'Анализ'}],structure:{body:{text}}}});
 for(const expr of ['9 / 18 × 100 = 50%','8/13*100=61,54%','1:3·100=33%','-1/4×100=-25%','1,5 / 3 × 100 = 50,0%']){
  const r=q.percentageCheck(work(expr));assert.equal(r.checks.length,1,expr);assert.deepEqual(r.errors,[],expr);
 }
 for(const expr of ['9 / 18 × 100 = 60%','8/13*100=61,55%','1/0×100=0%','Доля: 9/18×100=60%','Доля:9/18×100=60%']){
  const x=work(expr),r=q.percentageCheck(x);assert.equal(r.errors.length,1,expr);assert(q.riskReport(x).blockers.some(e=>e.includes(expr.replace(/^Доля:\s*/,''))));
 }
 for(const expr of ['9/18','9 / n × 100 = 50%','2 + 9/18×100=60%','10e9/18×100=60%','1 000/18×100=60%','(9/18×100=60%)','9/18×100=60% + 1','2 : 9/18×100=60%','−9/18×100=60%'])assert.equal(q.percentageCheck(work(expr)).checks.length,0,expr);
 assert.equal(q.percentageCheck(work('Большинство: 9 из 18 человек.')).checks.length,0);
});
test('C088 source comparisons expose actual citation context and never infer semantic truth',()=>{
 const x={doc:{inputs:{sources:'[S1]\nРеквизиты: Учебный источник, 2026, с. 1.\nФрагмент: Протокол совещания содержит решения и ответственных.\nПодтверждает: Протокол должен фиксировать решения.'},order:[{id:'body',name:'Анализ'},{id:'refs',name:'Источники'}],structure:{body:{text:'Совещания увеличивают прибыль на 30% [1].'},refs:{text:'1. Учебный источник, 2026, с. 1.'}}}};
 const before=JSON.stringify(x),r=q.sourceReview(x);
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].citation,'S1');assert(r.rows[0].context.includes('прибыль на 30%'));assert(r.rows[0].fragment.includes('решения и ответственных'));assert.equal(r.rows[0].status,'manual');assert.equal(JSON.stringify(x),before);
 x.doc.structure.body.text='Протокол должен фиксировать решения [S1].';assert.equal(q.sourceReview(x).rows[0].status,'manual');
 x.doc.structure.body.text='Контекст с неизвестной ссылкой [99].';assert.equal(q.sourceReview(x).rows[0].fragment,'');assert.equal(q.sourceReview(x).rows[0].status,'manual');
});
test('C088 evidence panel escapes source text and says semantic verification remains manual',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const context={window:{},DraftQuality:q,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../draft-editor.js'),'utf8'),context);
 const x={doc:{inputs:{sources:'[S1]\nРеквизиты: <img src=x onerror=alert(1)>\nФрагмент: Источник содержит произвольный учебный текст.\nПодтверждает: Заявленное подтверждение.'},order:[{id:'body',name:'Текст'}],structure:{body:{text:'Утверждение документа [S1].'}}}};
 const html=context.window.DraftEditor.sourceReview(x);assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('Требует ручной проверки смысла'));
});
