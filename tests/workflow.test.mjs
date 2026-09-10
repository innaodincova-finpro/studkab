import test from 'node:test';
import assert from 'node:assert/strict';
import {handler,validateCommand} from '../supabase/functions/studkab-workflow/handler.mjs';
const requestId='11111111-1111-4111-8111-111111111111';
const commandId='22222222-2222-4222-8222-222222222222';
const student={id:'student',email_confirmed_at:'yes'};
const executor={id:'executor',email_confirmed_at:'yes'};
const req=(action,payload={},headers={authorization:'Bearer user'})=>new Request('https://test/',{method:'POST',headers,body:JSON.stringify({action,requestId,commandId,payload})});

test('workflow command schema rejects forged and oversized input',()=>{
 for(const value of [null,[],{}, {action:'unknown',requestId,commandId},{action:'prepare_upload',requestId:'bad',commandId},{action:'prepare_upload',requestId,commandId:'bad'},{action:'prepare_upload',requestId,commandId,payload:[]}])assert.throws(()=>validateCommand(value));
 assert.throws(()=>validateCommand({action:'prepare_upload',requestId,commandId,payload:{text:'x'.repeat(4000001)}}),/большая/);
});

test('student, executor and service commands have separate authorization',async()=>{
 let who=student,calls=[];
 const app=handler({auth:async()=>who,isExecutor:async id=>id==='executor',serviceKey:'secret',execute:async(rpc,body)=>{calls.push({rpc,body});return {saved:true};}});
 assert.equal((await app(req('prepare_upload'))).status,200);
 assert.equal(calls[0].rpc,'studkab_prepare_upload');assert.equal(calls[0].body.actor,'student');
 assert.equal((await app(req('approve_passport'))).status,403);assert.equal(calls.length,1);
 who=executor;assert.equal((await app(req('approve_passport'))).status,200);assert.equal(calls[1].rpc,'studkab_approve_passport');
 assert.equal((await app(req('initialize_request',{}, {'x-studkab-service-key':'wrong'}))).status,403);
 assert.equal((await app(req('initialize_request',{}, {'x-studkab-service-key':'secret'}))).status,200);
 assert.equal(calls[2].body.actor,null);
 who=student;assert.equal((await app(req('get_snapshot'))).status,200);assert.equal(calls[3].rpc,'studkab_get_workflow_snapshot');
});

test('anonymous and unconfirmed users cannot run user commands',async()=>{
 let who=null,calls=0;
 const app=handler({auth:async()=>who,isExecutor:async()=>true,execute:async()=>{calls++;}});
 assert.equal((await app(req('prepare_upload'))).status,401);
 who={id:'student',email_confirmed_at:null};assert.equal((await app(req('prepare_upload'))).status,401);
 who={...student,is_anonymous:true};assert.equal((await app(req('prepare_upload'))).status,401);
 assert.equal(calls,0);
});

test('database conflicts and kill switch become safe client errors',async()=>{
 let error='revision_conflict';
 const app=handler({auth:async()=>executor,isExecutor:async()=>true,execute:async()=>{throw Error(error);}});
 assert.equal((await app(req('transition_request'))).status,409);
 error='workflow_disabled';assert.equal((await app(req('transition_request'))).status,503);
 error='not_owner';assert.equal((await app(req('get_snapshot'))).status,403);
 error='request_not_found';assert.equal((await app(req('transition_request'))).status,404);
 error='secret database detail';const response=await app(req('transition_request'));assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret/);
});

test('all declared workflow actions route to fixed RPC names',async()=>{
 const actions=['prepare_upload','answer_clarification','download_document','get_snapshot','transition_request','submit_passport','approve_passport','ask_clarification','create_document_version','record_checks','approve_document','deliver_document'];
 const seen=[];
 const app=handler({auth:async()=>executor,isExecutor:async()=>true,execute:async rpc=>{seen.push(rpc);return {};}});
 for(const action of actions){
  const payload=action==='record_checks'?{checks:[{evaluatorType:'human'}]}:action==='create_document_version'?{content:{},contentSha256:'44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'}:{};
  assert.equal((await app(req(action,payload))).status,200);
 }
 assert.equal(new Set(seen).size,actions.length);
});

test('student file completion uses the verifier instead of a client-controlled acceptance RPC',async()=>{
 let verified=false,executed=false;
 const app=handler({auth:async()=>student,isExecutor:async()=>false,execute:async()=>{executed=true;},verifyUpload:async(input,user)=>{verified=input.action==='complete_upload'&&user.id==='student';return {state:'accepted'};}});
 const response=await app(req('complete_upload',{fileId:'33333333-3333-4333-8333-333333333333'}));
 assert.equal(response.status,200);assert.equal(verified,true);assert.equal(executed,false);
});

test('automatic document checks use the fixed server checker and executor role',async()=>{
 let checked=false,executed=false;
 const app=handler({auth:async()=>executor,isExecutor:async()=>true,execute:async()=>{executed=true;},runAutomaticChecks:async(input,user)=>{checked=input.action==='run_automatic_checks'&&user.id==='executor';return {recorded:5};}});
 const response=await app(req('run_automatic_checks',{documentId:'33333333-3333-4333-8333-333333333333'}));
 assert.equal(response.status,200);assert.equal(checked,true);assert.equal(executed,false);
});

test('executor cannot forge automatic results or a document content hash through the public command',async()=>{
 let calls=0;
 const app=handler({auth:async()=>executor,isExecutor:async()=>true,execute:async()=>{calls++;return {};}});
 let response=await app(req('record_checks',{checks:[{evaluatorType:'automatic'}]}));assert.equal(response.status,400);
 response=await app(req('create_document_version',{content:{structure:{}},contentSha256:'0'.repeat(64)}));assert.equal(response.status,400);
 assert.equal(calls,0);
});
