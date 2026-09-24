import test from 'node:test';
import assert from 'node:assert/strict';
import {findings,explicitMinima,sourceMinimumGuard} from '../supabase/functions/_shared/source-minimum.mjs';
import {requirementAction,defaultPassport} from '../supabase/functions/studkab-requests/requirements.mjs';
import {resultAction} from '../supabase/functions/studkab-requests/results.mjs';
import {handler} from '../supabase/functions/studkab-generation-api/handler.mjs';
const id='11111111-1111-4111-8111-111111111111',hash='a'.repeat(64);
const user={id,email:'owner@example.test',email_confirmed_at:'yes'};
const items=[{id:'P1',category:'method',required:true,text:'Объём 25–30 страниц; структура: введение, три главы, заключение, не менее 5 источников и приложения. Использовать только предоставленные данные и S1–S5.',source:'задание'}];
const attachments=[{category:'assignment',file_name:'Задание.docx',file_hash:hash,extracted_text:'Список источников\n\nНе менее 10 позиций; в тесте использовать предоставленные материалы'}];
function setup({failure=false}={}){
 const writes=[];
 const db=async(path,...args)=>{
  if(path==='rpc/studkab_material_manifest_check')return {valid:true};
  if(path.startsWith('rpc/')){writes.push(path);return {};}
  if(path.startsWith('studkab_request_attachments')){if(failure)throw Error('READ_FAILED');return attachments;}
  if(path.startsWith('studkab_requirement_passports'))return [{id,status:'approved',items,summary:'Согласовано',source_fingerprint:hash}];
  if(path.startsWith('studkab_requests'))return [{id,student_id:id,payload:{k:'Курсовая работа'}}];
  if(path.startsWith('studkab_gen_limits'))return [{max_cost_microusd:250000}];
  throw Error('Unexpected '+path);
 };
 return {db,writes,config:async()=>({executor_email:user.email})};
}
test('explicit source minimum catches real adjacent UAT lines and arbitrary passport item IDs',()=>{
 const result=findings({attachments,items});assert.equal(result.status,'conflict');assert.equal(result.conflicts[0].source.minimum,10);assert.equal(result.conflicts[0].passport.itemId,'P1');
});
test('only explicit minimums count; availability, maximum, dates and unrelated positions do not',()=>{
 for(const text of ['Приложено 5 источников','Не более 10 источников','30 октября, 17 позиций','Не менее 10 таблиц','Список источников\nОписание\nНе менее 10 позиций'])assert.deepEqual(explicitMinima(text),[],text);
 assert.equal(explicitMinima('Минимальное количество источников: 12')[0].minimum,12);
 assert.equal(findings({attachments,items:[]}).status,'unparsed');
 assert.equal(findings({attachments,items:[{text:'Не менее 10 источников'}]}).status,'no_detected_conflict');
});
test('approval uses persisted passport and blocks before mutation despite summary agreement',async()=>{
 const deps=setup();const result=await requirementAction({action:'passport-approve',id,passportId:id,sourceFingerprint:hash,passport:{summary:'Согласовано',items:defaultPassport({}).items.map(q=>({...q,text:q.id==='SOURCES'?'Не менее 10 источников':q.id==='ANTIPLAGIARISM'?'Оригинальность: не менее 70% в системе Учебная система.':'Конкретное условие',source:'Задание, с. 2',verified:true,...(q.id==='ANTIPLAGIARISM'?{originality:{mode:'university_threshold',service:'Учебная система',thresholdPercent:70}}:{})}))}},user,deps);
 assert.equal(result.status,409);assert.equal(result.data.code,'SOURCE_MINIMUM_CONFLICT');assert.deepEqual(deps.writes,[]);
});
test('generation estimate and start block existing approved conflicting passport without reservation',async()=>{
 for(const action of ['estimate','start']){
  const deps=setup();const h=handler({...deps,auth:async()=>user,settings:()=>({enabled:true})});
  const response=await h(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({action,request:id,system:'Материалы',materialFingerprint:hash,parts:[{id:'intro',prompt:'Введение'}]})}));
  assert.equal(response.status,409);assert.equal((await response.json()).code,'SOURCE_MINIMUM_CONFLICT');assert.deepEqual(deps.writes,[]);
 }
});
test('review and delivery cannot omit document to bypass source conflict',async()=>{
 for(const action of ['review-result','deliver']){
  const deps=setup();const result=await resultAction({action,id,versionId:id,recipientId:id,fileHash:hash,documentHash:hash,reviewId:id,deliveryId:id},user,deps);
  assert.equal(result.status,409);assert.equal(result.data.code,'SOURCE_MINIMUM_CONFLICT');assert.deepEqual(deps.writes,[]);
 }
});
test('failed attachment read never authorizes mutation',async()=>{
 const deps=setup({failure:true});await assert.rejects(sourceMinimumGuard(deps.db,id,items),/READ_FAILED/);assert.deepEqual(deps.writes,[]);
});

test('qualified source subsets never become total source minimums',()=>{
 for(const text of ['Не менее 5 источников на иностранном языке','Из них минимум 5 источников','В том числе не менее 5 источников.','На иностранном языке не менее 5 источников','Не менее 5 источников за последние 3 года','Минимальное количество источников: 10000'])assert.deepEqual(explicitMinima(text),[],text);
 const result=findings({attachments,items:[{text:'Не менее 10 источников; из них минимум 5 источников на иностранном языке'}]});
 assert.equal(result.status,'no_detected_conflict');assert.equal(result.passport.length,1);
 assert.equal(findings({attachments,items:[{text:'Из них минимум 5 источников'}]}).status,'unparsed');
});

test('missing or malformed persisted passport items fail closed',async()=>{
 for(const items of [undefined,null,{},[null],[{id:'P1'}]]){
  const deps=setup();await assert.rejects(sourceMinimumGuard(deps.db,id,items),/требования паспорта/);assert.deepEqual(deps.writes,[]);
 }
});

test('conflict response is bounded even for repeated evidence',async()=>{
 const repeated=Array.from({length:100},()=>({text:'Не менее 5 источников'}));
 const result=await sourceMinimumGuard(async()=>attachments,id,repeated);
 assert.equal(result.findings.length,20);assert.ok(JSON.stringify(result).length<15000);
});
