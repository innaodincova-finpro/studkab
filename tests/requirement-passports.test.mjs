import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260914105509_studkab_requirement_passports.sql',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../supabase/migrations/20260915070508_mandatory_passport_generation_limits.sql',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
const {defaultPassport,validatePassport,originalityText}=await import('../supabase/functions/studkab-requests/requirements.mjs');
test('C104 separates documented university threshold from service report without a number',()=>{
 const source=defaultPassport({});
 for(const o of [{mode:'university_threshold',service:'Система вуза',thresholdPercent:70},{mode:'university_no_threshold',service:'Система вуза',thresholdPercent:null},{mode:'service_only',service:'',thresholdPercent:null}]){
  const item=source.items.find(x=>x.id==='ANTIPLAGIARISM');item.originality=o;item.text=originalityText(o);item.source=o.mode==='service_only'?'Стандарт STUDKAB и просмотренное задание':'Методичка, с. 4';item.verified=true;
  assert.deepEqual(validatePassport(source).items.find(x=>x.id==='ANTIPLAGIARISM').originality,o);
 }
 const item=source.items.find(x=>x.id==='ANTIPLAGIARISM');item.originality={mode:'service_only',service:'',thresholdPercent:65};assert.throws(()=>validatePassport(source),/Порог/);
});

test('assignment threshold without a named checker preserves the number and rejects an invented checker',()=>{const p=defaultPassport({}),item=p.items.find(x=>x.id==='ANTIPLAGIARISM');item.originality={mode:'university_threshold_no_service',service:'',thresholdPercent:65};item.text=originalityText(item.originality);item.source='01_assignment.txt, пункт оригинальности';item.verified=true;assert.match(item.text,/65%/);assert.deepEqual(validatePassport(p).items.find(x=>x.id==='ANTIPLAGIARISM').originality,item.originality);item.originality.service='Выдуманная система';assert.throws(()=>validatePassport(p),/без выдуманной системы/);});
test('passport schema is private and callable only through the authenticated server adapter',()=>{
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/revoke all on public\.studkab_requirement_passports from public, anon, authenticated/i);
 assert.doesNotMatch(sql,/grant\s+(?:select|insert|update|delete|all)[^;]+to\s+(?:anon|authenticated)/i);
 assert.match(sql,/security invoker/i);
 assert.match(sql,/revoke all on function[\s\S]+from public,anon,authenticated/i);
 assert.match(sql,/grant execute on function[\s\S]+to service_role/i);
});

test('generation gate binds approved passport, work limits and temporary total ceiling',()=>{
 assert.match(gate,/source_fingerprint=coalesce\(p_input->>'material_fingerprint',''\)/i);
 assert.match(gate,/\('control',100000\),\('coursework',250000\),\('thesis',600000\)/i);
 assert.match(gate,/temporary_total_microusd\) values\(true,500000\)/i);
 assert.match(gate,/cost>j\.max_cost_microusd-used/i);
 assert.match(gate,/least\(b\.limit_microusd,policy\.temporary_total_microusd\)/i);
});

test('passport versions are request-scoped, immutable in number and approve only unchanged items',()=>{
 assert.match(sql,/unique\(request_id, revision\)/i);
 assert.match(sql,/where id=p_passport and request_id=p_request for update/i);
 assert.match(sql,/selected\.items <> p_expected_items/i);
 assert.match(sql,/set status='stale' where request_id=p_request and status='approved'/i);
});

test('executor UI keeps four evidence categories separate and exposes no automatic AI action',()=>{
 for(const label of ['Требование методички','Измеримая проверка','Предметная рекомендация','Предположение'])assert.match(ui,new RegExp(label));
 assert.match(ui,/Сохранить уточнения/);
 assert.match(ui,/Повторно вводить остальные данные не нужно/);
 assert.match(ui,/Утвердить/);
 assert.doesNotMatch(ui,/data-act="passport-auto-approve"/);
});

test('default passport stores formatting as readable Russian text instead of internal JSON',()=>{
 const passport=defaultPassport({fm:{fn:'Times New Roman',sz:14,ml:30,mr:15,mt:20,mb:20,sp:1.5,ind:1.25}});
 const formatting=passport.items.find(item=>item.id==='FORMATTING').text;
 assert.match(formatting,/Times New Roman, 14 пт/);
 assert.match(formatting,/слева 30 мм/);
 assert.match(formatting,/межстрочный интервал 1,5/);
 assert.doesNotMatch(formatting,/\{"fn"/);
});

test('passport UI blocks approval and paid preparation while required facts are unresolved',()=>{
 assert.match(ui,/Паспорт не утверждён — платная подготовка запрещена/);
 assert.match(ui,/data-act="passport-approve"[\s\S]+disabled title="Сначала заполните обязательные требования"/);
 assert.match(ui,/return requireApprovedPassport\(x\)\.then/);
});

const {statedRequirements,fillMissingDraft,linkLiteralDraftSources,inventoryExplicitClauses,requirementAction}=await import('../supabase/functions/studkab-requests/requirements.mjs');
const inputFacts={rq:'Учебный тест. 25–30 страниц основного текста: введение 2, теория 6–7, анализ 8–10. Источники: пять предоставленных учебных фрагментов S1–S5 и исходные данные; не выдавать за реальные публикации. Оригинальность не проверена, порог не задан.',mn:'Разделы 2 / 6–7 / 8–10 / 7–8 / 2 страницы (25–29, в пределах 25–30).'};
test('explicit total and source restrictions survive extraction without invented originality',()=>{
 const items=defaultPassport(inputFacts).items;
 assert.equal(items.find(x=>x.id==='VOLUME').text,'Объём: 25–30 страниц основного текста');
 assert.equal(items.find(x=>x.id==='SOURCES').text,'Источники: пять предоставленных учебных фрагментов S1–S5 и исходные данные; не выдавать за реальные публикации.');
 assert.match(items.find(x=>x.id==='ANTIPLAGIARISM').text,/Требуется уточнить/);
 assert.equal(statedRequirements({mn:'Введение 2 страницы; глава 8 страниц'}).VOLUME,null);
 assert.equal(statedRequirements({...inputFacts,mn:'Объём: 40 страниц'}).VOLUME,null);
 assert.equal(statedRequirements({...inputFacts,mn:'Источники: минимум 10 публикаций'}).SOURCES,null);
});
test('repair only fills standard placeholders of a draft without mutating historical or manual text',()=>{
 const before={...defaultPassport({}),status:'draft'};const snapshot=JSON.stringify(before);
 const repaired=fillMissingDraft(before,inputFacts);
 assert.notEqual(repaired,before);assert.equal(JSON.stringify(before),snapshot);
 assert.equal(fillMissingDraft(repaired,inputFacts),repaired);
 const approved={...before,status:'approved'};assert.equal(fillMissingDraft(approved,inputFacts),approved);
 const manual={...before,items:[{id:'VOLUME',text:'Объём: 33 страницы'},{id:'SOURCES',text:'Источники: уточнить у преподавателя'}]};
 assert.equal(fillMissingDraft(manual,inputFacts),manual);
});
test('literal requirement links only to one current source and never becomes verified',()=>{
 const phrase='Обязательно представить анализ выручки за три отчётных периода';
 const base={status:'draft',items:[{id:'ANALYSIS',text:'Требование: '+phrase,source:'Методичка',verified:false},
  {id:'CALCULATIONS',text:'Расчёты: Не указано — требуется уточнить',verified:false}]};
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',old='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const attachments=[{id:old,category:'methodology',extracted_text:phrase,supersedes:null},
  {id,category:'methodology',file_name:'method.txt',extracted_text:'Введение\n'+phrase,supersedes:old}];
 const linked=linkLiteralDraftSources(base,attachments);
 assert.equal(base.items[0].source_attachment_id,undefined);
 assert.equal(linked.items[0].source_attachment_id,id);
 assert.match(linked.items[0].source,/method\.txt, строка извлечённого текста 2/);
 assert.equal(linked.items[0].verified,false);
 assert.equal(linked.items[1].source_attachment_id,undefined);
 assert.equal(linkLiteralDraftSources(linked,attachments),linked);
 assert.equal(linkLiteralDraftSources(base,[...attachments,{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',category:'assignment',extracted_text:phrase}]),base);
 assert.equal(linkLiteralDraftSources({...base,status:'approved'},attachments).items[0].source_attachment_id,undefined);
});
test('enumerated obligations enter the draft without fabricated approval, and superseded clauses leave the new draft',()=>{
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',next='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const phrase='Работа должна включать введение, три главы и заключение';
 const base={status:'draft',items:defaultPassport({}).items};
 const old={id,category:'methodology',file_name:'guide.txt',extracted_text:'Предисловие\n1. '+phrase+'\n2. Нужно подумать\n3. Таблица должна содержать расчёт по каждому году'};
 const first=inventoryExplicitClauses(base,[old]);
 assert.equal(first.items.length,base.items.length+2);
 const added=first.items.find(i=>i.id==='REQ_'+id.replace(/-/g,'')+'_2');
 assert.equal(added.text,phrase);
 assert.equal(added.source_attachment_id,id);
 assert.equal(added.verified,false);
 assert.match(added.source,/guide\.txt, строка извлечённого текста 2/);
 assert.equal(inventoryExplicitClauses(first,[old]),first);
 assert.equal(inventoryExplicitClauses({status:'draft',items:[{id:'STRUCTURE',text:'Структура: '+phrase}]},[old]).items.some(i=>i.id==='REQ_'+id.replace(/-/g,'')+'_2'),false);
 assert.equal(inventoryExplicitClauses({...first,status:'approved'},[]).items.length,first.items.length);
 const fresh={...first,status:'draft'};
 const replaced=inventoryExplicitClauses(fresh,[old,{id:next,category:'methodology',file_name:'guide-v2.txt',supersedes:id,
  extracted_text:'1. Документ должен включать обоснование расчёта и выводы'}]);
 assert.equal(replaced.items.some(i=>i.source_attachment_id===id),false);
 assert.equal(replaced.items.at(-1).source_attachment_id,next);
});
test('short unnumbered obligations are inventoried while background prose stays out',()=>{
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const text='Введение в учебную дисциплину\nРабота должна содержать сравнение показателей за три года.\nНеобходимо привести таблицу исходных данных и указать её источник.\nОписание исходных данных для учебного примера.';
 const result=inventoryExplicitClauses({status:'draft',items:[]},[{id,category:'assignment',file_name:'task.txt',extracted_text:text}]);
 assert.equal(result.items.length,2);
 assert.deepEqual(result.items.map(i=>i.source_attachment_id),[id,id]);
 assert.ok(result.items.every(i=>i.verified===false));
});
test('approval refuses an omitted enumerated obligation before any approval RPC',async()=>{
 const p=defaultPassport({});
 p.items=p.items.map(i=>({...i,text:i.id==='ANTIPLAGIARISM'?'Внешний отчёт по стандарту STUDKAB; в предоставленных материалах числовое условие вуза не обнаружено.':'Конкретное требование',source:'Задание',verified:true}));
 p.items.find(i=>i.id==='ANTIPLAGIARISM').originality={mode:'service_only',service:'',thresholdPercent:null};
 p.items.find(i=>i.id==='ANTIPLAGIARISM').source='Стандарт STUDKAB';
 let approved=false;
 const result=await requirementAction({action:'passport-approve',id:'33333333-3333-4333-8333-333333333333',passportId:'44444444-4444-4444-8444-444444444444',passport:p},
  {id:'22222222-2222-4222-8222-222222222222',email:'executor@example.test'},
  {config:async()=>({executor_email:'executor@example.test'}),db:async path=>{
   if(path.startsWith('studkab_requests?'))return [{payload:{}}];
   if(path.startsWith('studkab_request_attachments?'))return [{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',category:'assignment',file_name:'task.txt',extracted_text:'1. Работа должна содержать анализ выручки за три года'}];
   approved=true;throw Error('Unexpected approval access');
  }});
 assert.equal(result.status,409);
 assert.match(result.data.error,/отдельные условия/);
 assert.equal(approved,false);
});
test('approval refuses to downgrade an inventoried obligation to optional',async()=>{
 const p=defaultPassport({}),source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 p.items=p.items.map(i=>({...i,text:i.id==='ANTIPLAGIARISM'?originalityText({mode:'service_only',service:'',thresholdPercent:null}):'Конкретное требование',source:i.id==='ANTIPLAGIARISM'?'Стандарт STUDKAB':'Задание',verified:true}));
 p.items.find(i=>i.id==='ANTIPLAGIARISM').originality={mode:'service_only',service:'',thresholdPercent:null};
 p.items.push({id:'REQ_'+source.replace(/-/g,'')+'_1',category:'method',required:false,verified:false,
  text:'Работа должна содержать анализ выручки за три года',source:'task.txt, строка 1',source_attachment_id:source,answer_ids:[]});
 const result=await requirementAction({action:'passport-approve',id:'33333333-3333-4333-8333-333333333333',passportId:'44444444-4444-4444-8444-444444444444',passport:p},
  {id:'22222222-2222-4222-8222-222222222222',email:'executor@example.test'},
  {config:async()=>({executor_email:'executor@example.test'}),db:async path=>{
   if(path.startsWith('studkab_requests?'))return [{payload:{}}];
   if(path.startsWith('studkab_request_attachments?'))return [{id:source,category:'assignment',file_name:'task.txt',extracted_text:'1. Работа должна содержать анализ выручки за три года'}];
   throw Error('Approval must stop before database mutation: '+path);
  }});
 assert.equal(result.status,409);assert.match(result.data.error,/отдельные условия/);
});
test('approval asks the student despite a client-supplied structure resolution',async()=>{
 const p=defaultPassport({}),id='33333333-3333-4333-8333-333333333333',actor='22222222-2222-4222-8222-222222222222';
 const file={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',category:'methodology',file_name:'guide.txt',file_hash:'f'.repeat(64),
  extracted_text:'2.3 Анализ выручки по периодам\n2.3 Анализ себестоимости по периодам'};
 p.items=p.items.map(i=>({...i,text:i.id==='ANTIPLAGIARISM'?originalityText({mode:'service_only',service:'',thresholdPercent:null}):'Конкретное требование',source:i.id==='ANTIPLAGIARISM'?'Стандарт STUDKAB':'Задание',verified:true}));
 p.items.find(i=>i.id==='ANTIPLAGIARISM').originality={mode:'service_only',service:'',thresholdPercent:null};
 const structure=p.items.find(i=>i.id==='STRUCTURE');
 structure.text='Структура: Анализ себестоимости по периодам — 2.4';
 structure.structure_resolutions=[{fileHash:file.file_hash,number:'2.3',chosenNumber:'2.4',first:'Анализ выручки по периодам',second:'Анализ себестоимости по периодам',verified:true,reason:'Подтверждено преподавателем'}];
 let asked=0;
 const result=await requirementAction({action:'passport-approve',id,passportId:'44444444-4444-4444-8444-444444444444',passport:p},
  {id:actor,email:'executor@example.test'},
  {config:async()=>({executor_email:'executor@example.test'}),db:async(path,method,body)=>{
   if(path.startsWith('studkab_requests?'))return [{payload:{}}];
   if(path.startsWith('studkab_request_attachments?')){assert.match(path,/\bfile_hash\b/);return [file];}
   if(path==='rpc/studkab_clarification_ask'){
    asked++;assert.equal(body.p_item,'STRUCTURE');assert.equal(body.p_actor,actor);return {id:body.p_id,answer:null};
   }
   throw Error('Approval must wait for the student: '+path);
  }});
 assert.equal(asked,1);assert.equal(result.status,409);assert.match(result.data.error,/Ожидается ответ студента/);
});
test('ensure persists repaired draft as a separate version and subsequent reads do not resave',async()=>{
 let rows=[{...defaultPassport({}),id:'old',revision:1,status:'draft',source_fingerprint:'a'.repeat(64)}],writes=0;
 const deps={config:async()=>({executor_email:'executor@example.test'}),db:async(path,method,body)=>{
  if(path.startsWith('studkab_requests?'))return [{payload:inputFacts}];
  if(path.startsWith('studkab_requirement_passports?'))return rows;
  if(path.startsWith('studkab_request_attachments?'))return [];
  assert.equal(path,'rpc/studkab_requirement_passport_save');writes++;
  const next={id:'new',revision:2,status:'draft',items:body.p_items,source_fingerprint:body.p_source_fingerprint};rows=[next,...rows];return next;
 }};
 const request={action:'passport-ensure',id:'33333333-3333-4333-8333-333333333333',sourceFingerprint:'a'.repeat(64)};
 const user={id:'22222222-2222-4222-8222-222222222222',email:'executor@example.test'};
 const first=await requirementAction(request,user,deps);assert.equal(first.data.created,true);assert.equal(rows[1].items.find(x=>x.id==='VOLUME').text,'Объём: Не указано — требуется уточнить');
 assert.equal((await requirementAction(request,user,deps)).data.created,false);assert.equal(writes,1);
 assert.equal((await requirementAction(request,{...user,email:'student@example.test'},deps)).status,403);
});
test('ensure stores one literal source link, but refreshes it after a material revision',async()=>{
 const id='33333333-3333-4333-8333-333333333333',actor='22222222-2222-4222-8222-222222222222';
 const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const phrase='Обязательно представить анализ выручки за три отчётных периода';
 const base=defaultPassport({});base.items.push({id:'ANALYSIS',category:'method',required:true,text:phrase,source:'Задание',verified:false});
 let rows=[{...base,status:'draft',source_fingerprint:'a'.repeat(64)}],attachments=[{id:first,category:'assignment',file_name:'task.txt',extracted_text:phrase}];
 const db=async(path,method,body)=>{
  if(path.startsWith('studkab_requests?'))return [{payload:{}}];
  if(path.startsWith('studkab_requirement_passports?'))return rows;
  if(path.startsWith('studkab_request_attachments?'))return attachments;
  assert.equal(path,'rpc/studkab_requirement_passport_save');
  const saved={...base,status:'draft',source_fingerprint:body.p_source_fingerprint,items:body.p_items};rows=[saved,...rows];return saved;
 };
 const deps={config:async()=>({executor_email:'executor@example.test'}),db};
 const user={id:actor,email:'executor@example.test'};
 const input={action:'passport-ensure',id,sourceFingerprint:'a'.repeat(64)};
 assert.equal((await requirementAction(input,user,deps)).data.created,true);
 assert.equal(rows[0].items.at(-1).source_attachment_id,first);
 assert.equal((await requirementAction(input,user,deps)).data.created,false);
 attachments=[{...attachments[0],id:second,supersedes:first}];
 assert.equal((await requirementAction({...input,sourceFingerprint:'b'.repeat(64)},user,deps)).data.created,true);
 assert.equal(rows[0].items.at(-1).source_attachment_id,second);
 assert.equal(rows[0].items.at(-1).verified,false);
});
test('ensure persists a separate draft item for an enumerated assignment obligation',async()=>{
 const id='33333333-3333-4333-8333-333333333333',source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 let saved;
 const result=await requirementAction({action:'passport-ensure',id,sourceFingerprint:'a'.repeat(64)},
  {id:'22222222-2222-4222-8222-222222222222',email:'executor@example.test'},
  {config:async()=>({executor_email:'executor@example.test'}),db:async(path,method,body)=>{
   if(path.startsWith('studkab_requests?'))return [{payload:{}}];
   if(path.startsWith('studkab_requirement_passports?'))return [];
   if(path.startsWith('studkab_request_attachments?'))return [{id:source,category:'assignment',file_name:'task.txt',extracted_text:'2. Работа должна содержать анализ выручки за три года'}];
   if(path==='rpc/studkab_requirement_passport_save'){saved=body.p_items;return {id:'new',items:saved};}
   throw Error('Unexpected dependency '+path);
  }});
 assert.equal(result.status,200);
 assert.equal(saved.length,11);
 assert.equal(saved.at(-1).source_attachment_id,source);
 assert.equal(saved.at(-1).verified,false);
});
test('duplicate section number creates one stable question for the student on repeated ensure',async()=>{
 const id='33333333-3333-4333-8333-333333333333',actor='22222222-2222-4222-8222-222222222222';
 const file={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',category:'methodology',file_name:'guide.txt',file_hash:'f'.repeat(64),
  extracted_text:'2.3 Анализ выручки по периодам\n2.3 Анализ себестоимости по периодам'};
 let rows=[],savedQuestions=new Map(),acknowledge=false;
 const deps={config:async()=>({executor_email:'executor@example.test'}),db:async(path,method,body)=>{
  if(path.startsWith('studkab_requests?'))return [{payload:{}}];
  if(path.startsWith('studkab_requirement_passports?'))return rows;
  if(path.startsWith('studkab_request_attachments?')){assert.match(path,/\bfile_hash\b/);return [file];}
  if(path==='rpc/studkab_requirement_passport_save'){
   const created={id:'44444444-4444-4444-8444-444444444444',status:'draft',source_fingerprint:'a'.repeat(64),items:body.p_items};rows=[created];return created;
  }
  if(path==='rpc/studkab_clarification_ask'){
   assert.equal(body.p_item,'STRUCTURE');assert.equal(body.p_actor,actor);
   assert.match(body.p_question,/Анализ выручки.*Анализ себестоимости/s);
   savedQuestions.set(body.p_id,body.p_question);return acknowledge?{id:body.p_id}:undefined;
  }
  throw Error('Unexpected dependency '+path);
 }};
 const input={action:'passport-ensure',id,sourceFingerprint:'a'.repeat(64)};
 const user={id:actor,email:'executor@example.test'};
 assert.equal((await requirementAction(input,user,deps)).status,409);
 acknowledge=true;
  assert.equal((await requirementAction(input,user,deps)).data.created,false);
  assert.equal((await requirementAction(input,user,deps)).data.created,false);
  assert.equal(savedQuestions.size,1);
  const structure=rows[0].items.find(item=>item.id==='STRUCTURE');
  Object.assign(structure,{verified:true,source:'Ответ преподавателя',text:'Структура: Анализ себестоимости по периодам — 2.4',structure_resolutions:[{
   fileHash:file.file_hash,number:'2.3',chosenNumber:'2.4',first:'Анализ выручки по периодам',second:'Анализ себестоимости по периодам',verified:true,reason:'Подтверждено преподавателем'
  }]});
  assert.equal((await requirementAction(input,user,deps)).status,200);
  assert.equal(savedQuestions.size,1);
  file.file_hash='e'.repeat(64);
  assert.equal((await requirementAction(input,user,deps)).status,200);
  assert.equal(savedQuestions.size,2);
});

const semanticInput={
 rq:'Учебный тест MGMT-02. 25–30 страниц основного текста: введение 2, теория 6–7, анализ 8–10, рекомендации 7–8, заключение 2. Источники: пять учебных фрагментов S1–S5. Оригинальность не проверена, порог не задан.',
 mn:'MGMT-02, редакция 2. Использовать обновлённое задание: разделы 2 / 6–7 / 8–10 / 7–8 / 2 страницы (25–29, в пределах 25–30). Корпус: S1–S5 и данные организации. Руководитель, город, кафедра и группа не заданы; не выдумывать. Без платной генерации.'
};
test('C082 separates stated structure and instructions without inventing research methods',()=>{
 const snapshot=JSON.stringify(semanticInput),p=defaultPassport(semanticInput);
 const structure=p.items.find(x=>x.id==='STRUCTURE'),method=p.items.find(x=>x.id==='METHODOLOGY');
 assert.equal(structure.text,'Структура: введение 2, теория 6–7, анализ 8–10, рекомендации 7–8, заключение 2');
 assert.equal(method.text,'Методические указания: MGMT-02, редакция 2. Использовать обновлённое задание. Корпус: S1–S5 и данные организации. Руководитель, город, кафедра и группа не заданы; не выдумывать. Без платной генерации.');
 assert.equal(JSON.stringify(semanticInput),snapshot);
 const conflict=defaultPassport({...semanticInput,mn:semanticInput.mn.replace('6–7','9–10')});
 assert.equal(conflict.items.find(x=>x.id==='STRUCTURE').text,'Структура: '+semanticInput.mn.replace('6–7','9–10'));
});
test('C082 repairs legacy draft copies once and retains manual and approved versions',()=>{
 const original={...defaultPassport({}),status:'draft'};
 original.items=original.items.map(x=>x.id==='STRUCTURE'?{...x,text:'Структура: '+semanticInput.mn}:x.id==='METHODOLOGY'?{...x,text:'Методология: '+semanticInput.mn}:x);
 const snapshot=JSON.stringify(original),fixed=fillMissingDraft(original,semanticInput);
 assert.equal(JSON.stringify(original),snapshot);assert.notEqual(fixed,original);
 assert.equal(fillMissingDraft(fixed,semanticInput),fixed);
 assert.equal(fillMissingDraft({...original,status:'approved'},semanticInput).status,'approved');
 const manual={...original,items:[{id:'STRUCTURE',text:'Структура: три главы'},{id:'METHODOLOGY',text:'Методология: интервью и анализ данных'}]};
 assert.equal(fillMissingDraft(manual,semanticInput),manual);
});
test('C082 absence of originality threshold remains blocked even for a test',async()=>{
 const p=defaultPassport(semanticInput),originality=p.items.find(x=>x.id==='ANTIPLAGIARISM');
 assert.match(originality.text,/Порог в заявке не задан\. Проверка не проводилась/);
 assert.equal(originality.required,true);assert.doesNotMatch(originality.text,/[0-9]+\s*%/);
 assert.equal(originality.source,'Заявка студента');
 assert.equal(defaultPassport({}).items.find(x=>x.id==='ANTIPLAGIARISM').source,'');
 let saved=false;
 const result=await requirementAction({action:'passport-approve',id:'33333333-3333-4333-8333-333333333333',passportId:'44444444-4444-4444-8444-444444444444',passport:p},
  {id:'22222222-2222-4222-8222-222222222222',email:'executor@example.test'},
  {config:async()=>({executor_email:'executor@example.test'}),db:async(path)=>{if(path.startsWith('studkab_requests?'))return [{payload:semanticInput}];saved=true;return [];}});
 assert.equal(result.status,409);assert.equal(saved,false);
 const conflicting=defaultPassport({...semanticInput,mn:semanticInput.mn+' Оригинальность не менее 70%.'});
 assert.match(conflicting.items.find(x=>x.id==='ANTIPLAGIARISM').text,/Не указано/);
});
