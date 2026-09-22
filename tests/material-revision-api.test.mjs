import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {materialRevisionAction} from '../supabase/functions/studkab-requests/material-revision.mjs';
import {requirementAction} from '../supabase/functions/studkab-requests/requirements.mjs';
import {attachmentAction} from '../supabase/functions/studkab-requests/attachments.mjs';
import {actor,items,fingerprint} from './material-revision-fixture.mjs';

const request=randomUUID(),cycle=randomUUID();
const executor={id:actor.executor,email:'executor@example.test'};
const student={id:actor.student,email:'student@example.test'};
const foreign={id:actor.other,email:'other@example.test'};
const input={id:request,cycleId:cycle,expectedRevision:9,reason:'Загрузить исходную таблицу данных'};
function fixture({member=true,result={materials:{state:'open',requestRevision:10,cycleId:cycle}}}={}){
 const calls=[];
 return {calls,deps:{config:async()=>({executor_email:executor.email}),isMember:async()=>member,db:async(path,method,body)=>{
  calls.push({path,method,body});
  if(path.startsWith('studkab_requests?'))return path.includes('&student_id=eq.'+actor.other)?[]:[{id:request,student_id:actor.student}];
  return result;
 }}};
}

test('C096 independent API: actor is session-bound; caller-supplied owner/actor are ignored',async()=>{
 for(const [action,user,rpc] of [['material-revision-open',executor,'open'],['material-revision-complete',student,'complete']]){
  const {deps,calls}=fixture();
  const response=await materialRevisionAction({...input,action,actorId:actor.other,p_actor:actor.other,student_id:actor.other},user,deps);
  assert.equal(response.status,200);
  const call=calls.find(x=>x.path==='rpc/studkab_material_revision_'+rpc);
  assert.ok(call);assert.equal(call.body.p_actor,user.id);assert.equal(call.body.p_request,request);
  assert.equal(call.body.p_expected,9);assert.equal(call.body.p_cycle,cycle);
 }
});

test('C096 independent API: wrong role, foreign request and missing membership never call mutation RPC',async()=>{
 for(const [action,user,member,status] of [
  ['material-revision-open',student,true,403],['material-revision-complete',executor,true,403],
  ['material-revision-state',foreign,true,404],['material-revision-complete',foreign,true,404],
  ['material-revision-complete',student,false,403]
 ]){
  const {deps,calls}=fixture({member});
  const response=await materialRevisionAction({...input,action},user,deps);
  assert.equal(response.status,status);
  assert.equal(calls.filter(x=>x.path.startsWith('rpc/')).length,0);
 }
});

test('C096 independent API: revision and reason validation rejects before mutations; conflicts are not success',async()=>{
 for(const patch of [{expectedRevision:-1},{expectedRevision:1.5},{expectedRevision:'9'},
  {expectedRevision:undefined},{cycleId:'invalid'},{reason:'short'},{reason:'x'.repeat(501)}]){
  const {deps,calls}=fixture();
  assert.equal((await materialRevisionAction({...input,...patch,action:'material-revision-open'},executor,deps)).status,400);
  assert.equal(calls.filter(x=>x.path.startsWith('rpc/')).length,0);
 }
 const {deps}=fixture({result:{error:'Заявка изменилась'}});
 const response=await materialRevisionAction({...input,action:'material-revision-open'},executor,deps);
 assert.equal(response.status,409);assert.deepEqual(response.data,{error:'Заявка изменилась'});
});

function passportFixture({open=false,conflict=false}={}){
 const calls=[],old={id:randomUUID(),title:'Synthetic requirements',summary:'Historical version',status:'stale',items:structuredClone(items),source_fingerprint:fingerprint,revision:1};
 old.items[0].answer_ids=[randomUUID()];
 const snapshot=structuredClone(old);
 return {calls,old,snapshot,deps:{config:async()=>({executor_email:executor.email}),db:async(path,method,body)=>{
  calls.push({path,method,body});
  if(path.startsWith('studkab_requests?'))return [{id:request,payload:{},revision:12,studkab_material_revisions:[{id:cycle,closed_at:open?null:'2026-09-22T00:00:00Z'}]}];
  if(path.startsWith('studkab_requirement_passports?'))return [old];
  if(path==='rpc/studkab_material_revision_state')return {materials:{state:'open',requestRevision:12,cycleId:cycle}};
  if(path==='rpc/studkab_requirement_passport_save')return conflict?{error:'Материалы изменились. Откройте паспорт заново'}:{id:randomUUID(),status:'draft',revision:2,items:body.p_items,source_fingerprint:body.p_source_fingerprint};
  throw Error('Unexpected dependency '+path);
 }}};
}

test('C096 independent API: ensure during open is read-only; save and approve cannot modify a passport',async()=>{
 const f=passportFixture({open:true});
 const result=await requirementAction({action:'passport-ensure',id:request,sourceFingerprint:fingerprint,expectedRevision:12},executor,f.deps);
 assert.equal(result.status,200);assert.equal(result.data.created,false);assert.equal(result.data.materials.state,'open');
 assert.deepEqual(result.data.passports,[f.snapshot]);
 for(const action of ['passport-save','passport-approve'])assert.equal((await requirementAction({action,id:request},executor,f.deps)).status,409);
 assert.equal(f.calls.filter(c=>c.path==='rpc/studkab_requirement_passport_save'||c.path==='rpc/studkab_requirement_passport_approve').length,0);
});

test('C096 independent API: stale and missing material revisions fail before auto/manual passport writes',async()=>{
 for(const action of ['passport-ensure','passport-save','passport-approve'])for(const expectedRevision of [undefined,9]){
  const f=passportFixture();
  const result=await requirementAction({action,id:request,sourceFingerprint:fingerprint,expectedRevision},executor,f.deps);
  assert.equal(result.status,409);assert.equal(f.calls.filter(c=>c.path.startsWith('rpc/')).length,0);
 }
});

test('C096 independent API: auto draft after close resets verification, keeps old version, and SQL conflict stays failure',async()=>{
 const f=passportFixture();
 const result=await requirementAction({action:'passport-ensure',id:request,sourceFingerprint:'c'.repeat(64),expectedRevision:12},executor,f.deps);
 assert.equal(result.status,200);assert.equal(result.data.created,true);assert.equal(result.data.passports[0].status,'draft');
 assert.deepEqual(f.old,f.snapshot);assert.deepEqual(result.data.passports[1],f.snapshot);
 assert.ok(result.data.passports[0].items.every(x=>x.verified===false&&x.answer_ids.length===0));
 assert.equal(f.calls.find(c=>c.path==='rpc/studkab_requirement_passport_save').body.p_expected_revision,12);
 const racing=passportFixture({conflict:true});
 const failed=await requirementAction({action:'passport-ensure',id:request,sourceFingerprint:'c'.repeat(64),expectedRevision:12},executor,racing.deps);
 assert.equal(failed.status,409);assert.equal(failed.data.created,undefined);
});

test('C096 independent API: delayed upload must name the current cycle before any bytes are stored',async()=>{
 const activeCycle=randomUUID(),oldCycle=randomUUID();
 const file={action:'attachment-upload',id:request,category:'data',fileName:'data.txt',contentType:'text/plain',sizeBytes:3,fileHash:'d'.repeat(64),base64:'YWJj'};
 for(const sentCycle of [undefined,oldCycle,activeCycle]){
  let uploads=0,inserted;
  const deps={config:async()=>({executor_email:executor.email}),upload:async()=>{uploads++;return 'abc';},remove:async()=>{},db:async(path,method,body)=>{
   if(path.startsWith('studkab_requests?'))return [{id:request,student_id:student.id,revision:12,studkab_material_revisions:[{id:activeCycle,closed_at:null}]}];
   if(path.startsWith('studkab_requirement_passports?'))return [{id:randomUUID()}];
   if(path==='studkab_request_attachments'&&method==='POST'){inserted=body;return [body];}
   if(path.startsWith('studkab_request_attachments?'))return [];
   throw Error('Unexpected '+path);
  }};
  const result=await attachmentAction({...file,cycleId:sentCycle},student,deps);
  assert.equal(result.status,sentCycle===activeCycle?200:409);
  assert.equal(uploads,sentCycle===activeCycle?1:0);
  if(inserted)assert.equal(inserted.material_revision_id,activeCycle);
 }
});
