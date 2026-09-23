import test from 'node:test';
import assert from 'node:assert/strict';
import {requirementAction,defaultPassport} from '../supabase/functions/studkab-requests/requirements.mjs';
const id='11111111-1111-4111-8111-111111111111',passportId='22222222-2222-4222-8222-222222222222';
const user={id:'33333333-3333-4333-8333-333333333333',email:'executor@example.test'};
const fingerprint='a'.repeat(64);
function fixture({transferred=true,race=false}={}){
 const calls=[],passport=defaultPassport({});passport.items=passport.items.map(x=>({...x,text:'Подтверждённое условие',source:'Задание',verified:true}));
 passport.material_manifest={basis:'Задание',requirements:[{id:'M1',label:'Исходные данные',required:true,attachment_ids:[],answer_ids:[],payload_fields:['org'],not_applicable_reason:''}]};
 return {calls,passport,deps:{config:async()=>({executor_email:user.email}),db:async(path,method,body)=>{
  calls.push({path,method,body});
  if(path.startsWith('studkab_requests?')){assert.match(path,/studkab_request_reassignments\(operation_id\)/);return [{id,payload:{org:'Synthetic'},revision:3,studkab_material_revisions:[],studkab_request_reassignments:transferred?[{operation_id:'44444444-4444-4444-8444-444444444444'}]:[]}];}
  if(path.startsWith('studkab_requirement_passports?'))return [{...passport,id:passportId,status:'stale',source_fingerprint:fingerprint}];
  if(path==='rpc/studkab_material_manifest_check')return {valid:true};
  if(path.startsWith('studkab_request_attachments?'))return [];
  if(path.startsWith('rpc/studkab_requirement_passport_'))return race?{error:'Заявка изменилась'}:{...passport,id:passportId,status:path.endsWith('approve')?'approved':'draft'};
  throw Error('Unexpected '+path);
 }}};
}
test('C100 transferred request without material cycles rejects missing and stale expectedRevision before passport writes',async()=>{
 for(const action of ['passport-save','passport-approve','passport-ensure'])for(const expectedRevision of [undefined,2]){
  const f=fixture();const result=await requirementAction({action,id,passportId,passport:f.passport,sourceFingerprint:fingerprint,expectedRevision},user,f.deps);
  assert.equal(result.status,409);assert.equal(f.calls.filter(c=>c.path.startsWith('rpc/')).length,0);
 }
});
test('C100 current revision reaches atomic SQL; concurrent transfer conflict stays a failure',async()=>{
 for(const action of ['passport-save','passport-approve','passport-ensure'])for(const race of [false,true]){
  const f=fixture({race}),result=await requirementAction({action,id,passportId,passport:f.passport,sourceFingerprint:fingerprint,expectedRevision:3},user,f.deps);
  assert.equal(result.status,race?409:200);assert.equal(f.calls.find(c=>c.path.startsWith('rpc/studkab_requirement_passport_')).body.p_expected_revision,3);
 }
});
test('C100 read-only passport-get and initial legacy save retain compatibility',async()=>{
 const f=fixture();assert.equal((await requirementAction({action:'passport-get',id},user,f.deps)).status,200);
 const initial=fixture({transferred:false});assert.equal((await requirementAction({action:'passport-save',id,passport:initial.passport,sourceFingerprint:fingerprint},user,initial.deps)).status,200);
});
