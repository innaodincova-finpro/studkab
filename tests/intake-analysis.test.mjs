import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {analysisPlan,verifyExtraction,distribute} from '../supabase/functions/_shared/intake-analysis.mjs';
import {runIntake} from '../supabase/functions/studkab-generation/intake-runner.mjs';
import {handler as runnerHandler} from '../supabase/functions/studkab-generation/handler.mjs';
import {intakeAction} from '../supabase/functions/studkab-requests/intake.mjs';
import {schema,student,other,apiDatabase} from './intake-fixture.mjs';
const text='Тема: Управление персоналом. Вуз: Учебный университет. Предмет: Менеджмент. Не использовать ИИ. Срок: 30.10.2026. Студент: Иванов Иван.';
const file={id:'33333333-3333-4333-8333-333333333333',file_name:'Задание.docx',file_hash:'a'.repeat(64),read_status:'ready',read_version:'intake-reader-1',read_result:{status:'ready',readerVersion:'intake-reader-1',blocks:[{kind:'paragraph',text,source:{part:'word/document.xml',paragraph:1}}]}};
const response=part=>({covered:part.blocks.map(b=>b.blockId),candidates:[{field:'t',value:'Управление персоналом',condition:'',refs:[{blockId:part.blocks[0].blockId,quote:'Управление персоналом'}]},{field:'requirement',value:'Не использовать ИИ.',condition:'',refs:[{blockId:part.blocks[0].blockId,quote:'Не использовать ИИ.'}]}],roles:['assignment','requirements'].map(role=>({role,refs:[{blockId:part.blocks[0].blockId,quote:'Не использовать ИИ.'}]}))});
test('free requirements and multiple roles preserve exact immutable source provenance; missing fields remain missing',()=>{
 const [part]=analysisPlan({files:[file],notes:''}),x=verifyExtraction(JSON.stringify(response(part)),part),r=distribute([x]);
 assert.equal(r.fields.t.values[0].value,'Управление персоналом');assert.equal(r.fields.t.values[0].refs[0].fileHash,file.file_hash);assert.equal(r.fields.t.values[0].refs[0].source.paragraph,1);
 assert.equal(r.requirements[0].value,'Не использовать ИИ.');assert.deepEqual(r.roles.map(r=>r.role),['assignment','requirements']);assert.ok(r.missing.includes('dl'));assert.equal(r.fields.dl.values.length,0);assert.equal(r.status,'candidate');
});
test('invented value, quote, address, skipped block, duplicate coverage and oversized documents fail closed',()=>{
 const [part]=analysisPlan({files:[file]});
 for(const mutate of [x=>x.candidates[0].value='Вымысел',x=>x.candidates[0].refs[0].quote='Вымысел',x=>x.candidates[0].refs[0].blockId='another',x=>x.covered=[],x=>x.covered.push(x.covered[0])]){const x=response(part);mutate(x);assert.throws(()=>verifyExtraction(JSON.stringify(x),part));}
 assert.throws(()=>analysisPlan({files:[{...file,read_status:'blocked'}]}),/INCOMPLETE/);
 assert.throws(()=>analysisPlan({files:[{...file,read_result:{...file.read_result,blocks:[{text:'x'.repeat(30000)}]}}]}),/LIMIT/);
});
test('chunks retain every block; different topics are a conflict and repeated exact facts combine sources',()=>{
 const blocks=Array.from({length:6},(_,i)=>({kind:'paragraph',text:'x'.repeat(7000)+i,source:{paragraph:i+1}}));
 const plan=analysisPlan({files:[{...file,read_result:{...file.read_result,blocks}}]});assert.ok(plan.length>1);assert.equal(plan.flatMap(p=>p.blocks).length,6);
 const [part]=analysisPlan({files:[file]}),x=verifyExtraction(JSON.stringify(response(part)),part);
 const r=distribute([x,x,{candidates:[{field:'t',value:'Другая тема',condition:'',refs:[]}],roles:[]}]);assert.equal(r.fields.t.status,'conflict');assert.equal(r.fields.t.values.length,2);assert.equal(r.fields.t.values[0].refs.length,2);
});
async function fixture({enable=true}={}){
 const db=new PGlite();await db.exec(schema());if(enable)await db.exec('update studkab_intake_analysis_policy set enabled=true,limit_microusd=10000000;update studkab_gen_budget set limit_microusd=10000000');await db.exec('set role service_role');
 const sql=apiDatabase(db),rpc=(name,args)=>sql('rpc/'+name,'POST',args),draft=await rpc('studkab_intake_open',{p_student:student});
 const {file:f}=await rpc('studkab_intake_reserve',{p_student:student,p_draft:draft.id,p_name:file.file_name,p_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',p_size:100,p_hash:file.file_hash,p_supersedes:null});
 await rpc('studkab_intake_finish',{p_student:student,p_draft:draft.id,p_file:f.id,p_hash:f.file_hash});
 await db.query("update studkab_intake_files set read_status='ready',read_version='intake-reader-1',read_result=$2 where id=$1",[f.id,{...file.read_result,fileId:f.id,fileHash:f.file_hash}]);
 const start=()=>intakeAction({action:'intake-analyze',id:draft.id},{id:student},{db:sql,isMember:async()=>true});
 const state=(id=student)=>rpc('studkab_intake_analysis_state',{p_student:id,p_draft:draft.id});
 let paid=0;
 const provider=async(c)=>{paid++;return {complete:true,text:JSON.stringify(response(c.spec))};};
 return {db,sql,rpc,draft,f,start,state,provider,get paid(){return paid;}};
}
test('one persisted analysis restores after browser close/lost finish response; repeated starts never pay twice',async()=>{
 const f=await fixture();try{
  const a=await f.start(),b=await f.start();assert.equal(a.data.analysis.id,b.data.analysis.id);
  let lost=true;const rpc=async(name,args)=>{const r=await f.rpc(name,args);if(name.endsWith('_finish')&&lost){lost=false;throw Error('lost');}return r;};
  assert.equal((await runIntake({rpc,provider:f.provider})).status,'intake_save_unconfirmed');
  const s=await f.state();assert.equal(s.state,'done');assert.equal(s.result.fields.t.values[0].refs[0].fileId,f.f.id);
  await f.start();assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.equal(f.paid,1);
  assert.equal((await f.state(other)).missing,true);
  const budget=(await f.db.query('select reserved_microusd from studkab_gen_budget')).rows[0].reserved_microusd;assert.ok(Number(budget)>0);
 }finally{await f.db.close();}
});
test('operator-only numerical budget defaults disabled and rejects insufficient reserve before provider',async()=>{
 const f=await fixture({enable:false});try{
  assert.equal((await f.start()).data.analysis.state,'disabled');assert.equal(f.paid,0);
  await assert.rejects(()=>f.db.exec('update studkab_intake_analysis_policy set enabled=true'),/permission denied/);
  await f.db.exec('reset role;update studkab_intake_analysis_policy set enabled=true,limit_microusd=1;update studkab_gen_budget set limit_microusd=1;set role service_role');
  await f.start();assert.equal((await runIntake({rpc:f.rpc,provider:f.provider})).status,'intake_budget_or_stale');assert.equal(f.paid,0);assert.equal((await f.state()).state,'budget');
  await f.db.exec('reset role;set role authenticated');await assert.rejects(()=>f.state(),/permission denied/);
 }finally{await f.db.close();}
});
test('lost dispatch reply and unknown paid outcome retain reserve; expired sent lease never repeats payment',async()=>{
 const f=await fixture();try{
  await f.start();const rpc=async(name,args)=>{const r=await f.rpc(name,args);if(name.endsWith('_dispatch'))throw Error('lost');return r;};
  assert.equal((await runIntake({rpc,provider:f.provider})).status,'intake_dispatch_unconfirmed');assert.equal(f.paid,0);
  const before=(await f.db.query('select reserved_microusd from studkab_gen_budget')).rows[0].reserved_microusd;
  await f.db.exec("update studkab_intake_analysis_jobs set lease_until=now()-interval '1 second'");
  assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.equal((await f.state()).state,'unknown');await f.start();assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.equal(f.paid,0);
  assert.equal((await f.db.query('select reserved_microusd from studkab_gen_budget')).rows[0].reserved_microusd,before);
 }finally{await f.db.close();}
});
test('expired pre-send claim is recoverable; simultaneous claim cannot select same job; changed notes invalidate candidates',async()=>{
 const f=await fixture();try{
  await f.start();const c=await f.rpc('studkab_intake_analysis_claim',{});assert.ok(c.claim);assert.equal(await f.rpc('studkab_intake_analysis_claim',{}),null);
  await f.db.exec("update studkab_intake_analysis_jobs set lease_until=now()-interval '1 second'");await runIntake({rpc:f.rpc,provider:f.provider});assert.equal(f.paid,1);
  await f.rpc('studkab_intake_notes',{p_student:student,p_draft:f.draft.id,p_revision:(await f.rpc('studkab_intake_open',{p_student:student})).revision,p_notes:'Новый срок уточняется'});const state=await f.state();assert.equal(state.state,'stale');assert.equal(state.result,undefined);
 }finally{await f.db.close();}
});
test('invalid semantic answer is saved as invalid, never approved or automatically paid again',async()=>{
 const f=await fixture();try{await f.start();let paid=0;const provider=async()=>{paid++;return {complete:true,text:'{"covered":[],"candidates":[],"roles":[]}'}};
 assert.equal((await runIntake({rpc:f.rpc,provider})).status,'intake_invalid');assert.equal((await f.state()).state,'invalid');await f.start();assert.equal(await runIntake({rpc:f.rpc,provider}),null);assert.equal(paid,1);
 }finally{await f.db.close();}
});
test('ordinary browser cannot invoke background processing; authenticated machine shares runner without claiming generation',async()=>{
 let calls=0;const h=runnerHandler({authorize:async r=>r.headers.get('Authorization')==='Bearer machine',config:async()=>({cron_token:'secret'}),ready:()=>false,processIntake:async()=>{calls++;return {status:'intake_done'};}});
 const req=(auth,secret)=>new Request('https://example.test',{method:'POST',headers:{Authorization:auth,'X-Studkab-Runner':secret}});
 assert.equal((await h(req('Bearer user','secret'))).status,401);assert.equal((await h(req('Bearer machine','wrong'))).status,401);assert.equal(calls,0);assert.equal((await(await h(req('Bearer machine','secret'))).json()).status,'intake_done');assert.equal(calls,1);
});

test('provider transport uncertainty saves unknown once and material replacement during the paid call rejects stale facts',async()=>{
 for(const changed of [false,true]){const f=await fixture();try{
  await f.start();let paid=0;
  const provider=async c=>{paid++;if(!changed)throw Error('provider response lost');
   const revision=(await f.rpc('studkab_intake_open',{p_student:student})).revision;
   await f.rpc('studkab_intake_notes',{p_student:student,p_draft:f.draft.id,p_revision:revision,p_notes:'Срок согласовывается'});return {complete:true,text:JSON.stringify(response(c.spec))};};
  const r=await runIntake({rpc:f.rpc,provider});assert.equal(r.status,changed?'intake_stale':'intake_unknown');assert.equal(await runIntake({rpc:f.rpc,provider}),null);assert.equal(paid,1);assert.equal((await f.state()).result,changed?undefined:null);
 }finally{await f.db.close();}}
});

test('saved parts resume after process restart and final distribution contains all chunks',async()=>{
 const f=await fixture();try{
  const blocks=Array.from({length:7},(_,i)=>({kind:'paragraph',text:text+' '+String(i)+' '+'x'.repeat(6500),source:{paragraph:i+1}}));
  await f.db.query('update studkab_intake_files set read_result=$2 where id=$1',[f.f.id,{...file.read_result,blocks,fileId:f.f.id,fileHash:f.f.file_hash}]);
  await f.start();assert.equal((await runIntake({rpc:f.rpc,provider:f.provider})).status,'intake_queued');assert.equal((await f.state()).completed,1);
  const state=await f.state();for(let i=1;i<state.parts;i++)await runIntake({rpc:f.rpc,provider:f.provider});
  const end=await f.state();assert.equal(end.state,'done');assert.equal(end.result.fields.t.values[0].refs.length,state.parts);assert.equal(f.paid,state.parts);
 }finally{await f.db.close();}
});
