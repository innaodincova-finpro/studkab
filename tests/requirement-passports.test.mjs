import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260914105509_studkab_requirement_passports.sql',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../supabase/migrations/20260915070508_mandatory_passport_generation_limits.sql',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
const {defaultPassport}=await import('../supabase/functions/studkab-requests/requirements.mjs');

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
 assert.match(ui,/filter\(function\(entry\)\{return \/не указано\|требуется уточнить\/i/);
 assert.match(ui,/all=items\.map\(function\(q\)\{return Object\.assign\(\{\},q\);\}\)/);
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

const {statedRequirements,fillMissingDraft,requirementAction}=await import('../supabase/functions/studkab-requests/requirements.mjs');
const inputFacts={rq:'Учебный тест. 25–30 страниц основного текста: введение 2, теория 6–7, анализ 8–10. Источники: пять предоставленных учебных фрагментов S1–S5 и исходные данные; не выдавать за реальные публикации. Оригинальность не проверена, порог не задан.',mn:'Разделы 2 / 6–7 / 8–10 / 7–8 / 2 страницы (25–29, в пределах 25–30).'};
test('explicit total and source restrictions survive extraction without invented originality',()=>{
 const items=defaultPassport(inputFacts).items;
 assert.equal(items.find(x=>x.id==='VOLUME').text,'Объём: 25–30 страниц основного текста');
 assert.equal(items.find(x=>x.id==='SOURCES').text,'Источники: пять предоставленных учебных фрагментов S1–S5 и исходные данные; не выдавать за реальные публикации.');
 assert.match(items.find(x=>x.id==='ANTIPLAGIARISM').text,/Не указано/);
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
test('ensure persists repaired draft as a separate version and subsequent reads do not resave',async()=>{
 let rows=[{...defaultPassport({}),id:'old',revision:1,status:'draft',source_fingerprint:'a'.repeat(64)}],writes=0;
 const deps={config:async()=>({executor_email:'executor@example.test'}),db:async(path,method,body)=>{
  if(path.startsWith('studkab_requests?'))return [{payload:inputFacts}];
  if(path.startsWith('studkab_requirement_passports?'))return rows;
  assert.equal(path,'rpc/studkab_requirement_passport_save');writes++;
  const next={id:'new',revision:2,status:'draft',items:body.p_items,source_fingerprint:body.p_source_fingerprint};rows=[next,...rows];return next;
 }};
 const request={action:'passport-ensure',id:'33333333-3333-4333-8333-333333333333',sourceFingerprint:'a'.repeat(64)};
 const user={id:'22222222-2222-4222-8222-222222222222',email:'executor@example.test'};
 const first=await requirementAction(request,user,deps);assert.equal(first.data.created,true);assert.equal(rows[1].items.find(x=>x.id==='VOLUME').text,'Объём: Не указано — требуется уточнить');
 assert.equal((await requirementAction(request,user,deps)).data.created,false);assert.equal(writes,1);
 assert.equal((await requirementAction(request,{...user,email:'student@example.test'},deps)).status,403);
});
