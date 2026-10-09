import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setupAssistantFixture} from './assistant-durable-fixture.mjs';
const read=n=>readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const actor=randomUUID(),student=randomUUID(),other=randomUUID(),hash='a'.repeat(64),resultHash='b'.repeat(64);
let db;
before(async()=>{db=new PGlite();await setupAssistantFixture(db,{actor,student,other});});
after(async()=>db?.close());
const rpc=async(n,a=[])=>(await db.query('select public.'+n+'('+a.map((_,i)=>'$'+(i+1)).join(',')+') value',a)).rows[0].value;
async function kit(sections=['answer']){
 const id=randomUUID();await db.query('insert into studkab_requests(id,student_id,payload) values($1,$2,$3)',[id,student,{route:'r3',n:'Offline Student',rq:'Offline assignment'}]);
 const snap=await rpc('studkab_assistant_snapshot',[id,actor]);const operation=randomUUID(),snapshot={schema:1,files:[],details:{topic:'Offline'}};
 const args=[id,actor,'claude',operation,1,hash,snap.basis,snapshot,sections];
 const job=await rpc('studkab_assistant_accept',args);return {id,job:job.jobId,args};
}
async function completed(k){await rpc('studkab_assistant_queue',[k.job,actor]);const c=await rpc('studkab_assistant_claim',[k.job,actor]);await rpc('studkab_assistant_dispatch',[k.job,actor,c.claim]);await rpc('studkab_assistant_complete',[k.job,actor,c.claim,{status:'completed',jobId:k.job,requestId:k.id,provider:'claude',revision:1,fingerprint:hash,sections:[{id:'answer',text:'Offline result'}]}]);}
async function returned(k){await completed(k);const permit=await rpc('studkab_assistant_begin_return',[k.job,actor,1,hash]);const args=[k.job,actor,permit.claim,1,hash,'Work.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1200,resultHash,'r3-results/'+k.id+'/'+resultHash];await rpc('studkab_assistant_commit_return',args);return args;}

test('snapshot denies wrong actor and carries complete metadata/answers/current requirements',async()=>{
 const k=await kit();await assert.rejects(()=>rpc('studkab_assistant_snapshot',[k.id,other]),/FORBIDDEN/);
 const s=await rpc('studkab_assistant_snapshot',[k.id,actor]);assert.equal(s.attachmentsComplete,true);assert.deepEqual(s.context.answers,[]);assert.equal(s.request.revision,1);
});
test('acceptance is prepared and repeated operations or new clicks reuse the same receipt',async()=>{
 const k=await kit();let duplicate=await rpc('studkab_assistant_accept',k.args);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.state,'prepared');
 const again=[...k.args];again[3]=randomUUID();duplicate=await rpc('studkab_assistant_accept',again);assert.equal(duplicate.jobId,k.job);
 const wrong=[...k.args];wrong[2]='deepseek';await assert.rejects(()=>rpc('studkab_assistant_accept',wrong),/OPERATION_CONFLICT/);
 const second=[...wrong];second[3]=randomUUID();await assert.rejects(()=>rpc('studkab_assistant_accept',second),/ACTIVE_JOB_EXISTS/);
});
test('missing approved section plan allows capture but blocks actual queueing',async()=>{
 const k=await kit([]);await assert.rejects(()=>rpc('studkab_assistant_queue',[k.job,actor]),/PLAN_REQUIRED/);
 assert.equal((await rpc('studkab_assistant_state',[k.id,actor])).job.state,'prepared');
});
test('kit mutation between read and acceptance or return blocks stale receipt',async()=>{
 const k=await kit();await db.query('update studkab_requests set revision=2 where id=$1',[k.id]);
 await assert.rejects(()=>rpc('studkab_assistant_queue',[k.job,actor]),/JOB_NOT_READY/);
 const m=await kit();await completed(m);const claim=await rpc('studkab_assistant_begin_return',[m.job,actor,1,hash]);
 await db.query('insert into studkab_clarifications(id,request_id,created_at,answer) values($1,$2,now(),$3)',[randomUUID(),m.id,'New answer']);
 await assert.rejects(()=>rpc('studkab_assistant_commit_return',[m.job,actor,claim.claim,1,hash,'Work.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1200,resultHash,'r3-results/'+m.id+'/'+resultHash]),/MATERIALS_CHANGED/);
});
test('lease claim does not mean dispatch, expired dispatch cannot be automatically repeated',async()=>{
 const k=await kit();await rpc('studkab_assistant_queue',[k.job,actor]);const c=await rpc('studkab_assistant_claim',[k.job,actor]);
 assert.equal((await rpc('studkab_assistant_state',[k.id,actor])).job.startedAt,null);
 assert.equal((await rpc('studkab_assistant_claim',[k.job,actor])).allowed,false);
 await rpc('studkab_assistant_dispatch',[k.job,actor,c.claim]);await db.query("update studkab_assistant_jobs set lease_until=now()-interval '1 second' where id=$1",[k.job]);
 assert.equal((await rpc('studkab_assistant_claim',[k.job,actor])).unknown,true);
 assert.equal((await rpc('studkab_assistant_claim',[k.job,actor])).allowed,false);
});
test('return duplicate/lost reply/late failure never overwrite committed receipt or deliver',async()=>{
 const k=await kit();const args=await returned(k);assert.equal((await rpc('studkab_assistant_commit_return',args)).duplicate,true);
 await rpc('studkab_assistant_fail_return',[k.job,actor,args[2]]);
 const state=await rpc('studkab_assistant_state',[k.id,actor]);assert.equal(state.job.state,'returned');assert.equal(state.work.delivered,null);assert.equal(state.work.result.hash,resultHash);
 assert.equal((await rpc('studkab_assistant_begin_return',[k.job,actor,1,hash])).duplicate,true);
 const conflict=[...args];conflict[8]=hash;await assert.rejects(()=>rpc('studkab_assistant_commit_return',conflict),/RECEIPT_CONFLICT/);
});
test('storage/return failure releases only the return claim and reuses completed inference',async()=>{
 const k=await kit();await completed(k);const a=await rpc('studkab_assistant_begin_return',[k.job,actor,1,hash]);await rpc('studkab_assistant_fail_return',[k.job,actor,a.claim]);
 const b=await rpc('studkab_assistant_begin_return',[k.job,actor,1,hash]);assert.notEqual(a.claim,b.claim);assert.equal(b.allowed,true);
});
test('server review is bound to actual returned file and gates only automatic delivery',async()=>{
 const k=await kit();await returned(k);await assert.rejects(()=>rpc('studkab_r3_deliver',[k.id,resultHash]),/ASSISTANT_REVIEW_REQUIRED/);
 await assert.rejects(()=>rpc('studkab_assistant_review',[k.job,actor,hash]),/REVIEW_BINDING_CHANGED/);
 await rpc('studkab_assistant_review',[k.job,actor,resultHash]);assert.equal((await rpc('studkab_r3_deliver',[k.id,resultHash])).duplicate,false);
 assert.equal((await rpc('studkab_r3_deliver',[k.id,resultHash])).duplicate,true);
 const m=await kit();await rpc('studkab_r3_take',[m.id]);await rpc('studkab_r3_result_set',[m.id,'Manual.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1200,hash,'r3-results/'+m.id+'/'+hash]);
 assert.equal((await rpc('studkab_r3_deliver',[m.id,hash])).duplicate,false);
});
test('student state omits working file, snapshots, worker response, hash and operation ID',async()=>{
 const k=await kit();await returned(k);const s=await rpc('studkab_assistant_state',[k.id,student]);assert.equal(s.work.result,null);assert.equal(s.job.resultHash,null);assert.equal(s.job.operationId,null);assert.equal(s.job.provider,null);assert.equal(Object.hasOwn(s.job,'snapshot'),false);
 await assert.rejects(()=>rpc('studkab_assistant_state',[k.id,other]),/FORBIDDEN/);
});
test('snapshot/response/receipt are immutable and public roles have no table/RPC grants',async()=>{
 const k=await kit();await assert.rejects(()=>db.query("update studkab_assistant_jobs set snapshot='{}' where id=$1",[k.job]),/IMMUTABLE_ASSISTANT_SNAPSHOT/);
 await db.exec('reset role');
 const [permissions]=(await db.query("select has_table_privilege('authenticated','studkab_assistant_jobs','select') as table_read,has_function_privilege('anon','studkab_assistant_snapshot(uuid,uuid)','execute') as rpc_read")).rows;
 assert.equal(permissions.table_read,false);assert.equal(permissions.rpc_read,false);
 const events=(await db.query('select kind from studkab_assistant_events where job_id=$1',[k.job])).rows;assert.deepEqual(events.map(x=>x.kind),['accepted']);
 await db.exec('set role service_role');
});
test('new semantic operation has a persisted alias receipt after an acceptance reply is lost',async()=>{
 const k=await kit();const again=[...k.args];const operation=randomUUID();again[3]=operation;await rpc('studkab_assistant_accept',again);
 const receipt=await rpc('studkab_assistant_state',[k.id,actor,operation]);assert.equal(receipt.accepted,true);assert.equal(receipt.job.id,k.job);assert.equal(receipt.job.operationId,operation);
 const missing=await rpc('studkab_assistant_state',[k.id,actor,randomUUID()]);assert.equal(missing.accepted,false);assert.equal(missing.job,null);
});
test('same hash never borrows a different automatic job review and explicit manual replacement clears binding',async()=>{
 const k=await kit();await returned(k);await rpc('studkab_assistant_review',[k.job,actor,resultHash]);
 await db.query("update studkab_r3_work set returned_at=now()+interval '1 second' where request_id=$1",[k.id]);
 const source=await rpc('studkab_assistant_snapshot',[k.id,actor]);const next=[...k.args];next[3]=randomUUID();next[6]=source.basis;
 const job=await rpc('studkab_assistant_accept',next);const cycle={id:k.id,job:job.jobId};await returned(cycle);
 await assert.rejects(()=>rpc('studkab_r3_deliver',[k.id,resultHash]),/ASSISTANT_REVIEW_REQUIRED/);
 await rpc('studkab_r3_result_set',[k.id,'Manual.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1200,resultHash,'r3-results/'+k.id+'/'+resultHash]);
 assert.equal((await rpc('studkab_r3_deliver',[k.id,resultHash])).duplicate,false);
});
test('both roles see stale binding after a new answer; old delivered file is not a current rework result',async()=>{
 const k=await kit();await returned(k);await rpc('studkab_assistant_review',[k.job,actor,resultHash]);await rpc('studkab_r3_deliver',[k.id,resultHash]);
 await db.query('insert into studkab_clarifications(id,request_id,created_at,answer) values($1,$2,now(),$3)',[randomUUID(),k.id,'Changed answer']);
 assert.equal((await rpc('studkab_assistant_state',[k.id,actor])).job.bindingCurrent,false);
 assert.equal((await rpc('studkab_assistant_state',[k.id,student])).job.bindingCurrent,false);
 await db.query("update studkab_r3_work set returned_at=now()+interval '1 second' where request_id=$1",[k.id]);
 assert.equal((await rpc('studkab_assistant_state',[k.id,student])).work.delivered,null);
});
test('immutable inference response must match owned job identity, source and section plan',async()=>{
 const k=await kit();await rpc('studkab_assistant_queue',[k.job,actor]);const c=await rpc('studkab_assistant_claim',[k.job,actor]);await rpc('studkab_assistant_dispatch',[k.job,actor,c.claim]);
 const response={status:'completed',jobId:k.job,requestId:k.id,provider:'claude',revision:1,fingerprint:hash,sections:[{id:'answer',text:'Verified section'}]};
 await assert.rejects(()=>rpc('studkab_assistant_complete',[k.job,actor,c.claim,{...response,provider:'deepseek'}]),/RESULT_BINDING_CHANGED/);
 await assert.rejects(()=>rpc('studkab_assistant_complete',[k.job,actor,c.claim,{...response,sections:[{id:'invented',text:'Wrong section'}]}]),/INCOMPLETE_DOCUMENT/);
 await rpc('studkab_assistant_complete',[k.job,actor,c.claim,response]);
 await assert.rejects(()=>db.query("update studkab_assistant_jobs set response='{}' where id=$1",[k.job]),/IMMUTABLE_ASSISTANT_RESPONSE/);
});
