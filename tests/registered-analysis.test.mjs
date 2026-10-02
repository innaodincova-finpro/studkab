import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {schema,submissionExtension,student,other,apiDatabase} from './intake-fixture.mjs';
import {analysisPlan,verifyExtraction} from '../supabase/functions/_shared/intake-analysis.mjs';
import {queueRegisteredAnalysis} from '../supabase/functions/studkab-generation/registered-analysis.mjs';
import {runIntake} from '../supabase/functions/studkab-generation/intake-runner.mjs';
import {registeredStudyAction} from '../supabase/functions/studkab-requests/registered-study.mjs';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
const read=n=>fs.readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const migration=read('20261002015056_route02_registered_analysis.sql');
const text='Тема: Менеджмент. Тема: Финансы. Объём 25 страниц.',email='executor@example.invalid';
async function fixture({enabled=true,ready=true}={}){
 const db=new PGlite();await db.exec(schema()+submissionExtension()+read('20261001162253_route02_receive_before_analysis.sql')+read('20261001175519_route02_registered_reading.sql'));
 await db.exec(`alter table auth.users add column email text;update auth.users set email='${email}' where id='${other}';grant select(id,email) on auth.users to service_role;update studkab_request_config set executor_email='${email}';`);
 const rpc=async(name,args={})=>{assert.match(name,/^studkab_[a-z_]+$/);return (await db.query('select '+name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r;};
 await db.exec('set role service_role');const api=apiDatabase(db),draft=await rpc('studkab_intake_open',{p_student:student});
 const {file}=await rpc('studkab_intake_reserve',{p_student:student,p_draft:draft.id,p_name:'Assignment.docx',p_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',p_size:100,p_hash:'a'.repeat(64),p_supersedes:null});
 await rpc('studkab_intake_finish',{p_student:student,p_draft:draft.id,p_file:file.id,p_hash:file.file_hash});
 const legacy=await rpc('studkab_intake_analysis_source',{p_draft:draft.id});
 await db.exec('reset role');await db.exec(migration+read('20260921165603_c084_requirement_clarifications.sql')+read('20260926114639_c120_dialog_events.sql')+read('20261002015751_route02_private_questions.sql')+read('20261002020616_route02_reviewed_classification.sql'));await db.exec('revoke update on studkab_request_attachments from service_role;grant update(category,extracted_text) on studkab_request_attachments to service_role');if(enabled)await db.exec('update studkab_intake_analysis_policy set enabled=true,limit_microusd=10000000;update studkab_gen_budget set limit_microusd=10000000');await db.exec('set role service_role');
 assert.deepEqual(await rpc('studkab_intake_analysis_source',{p_draft:draft.id}),legacy);
 const snap=await rpc('studkab_intake_receive_snapshot',{p_student:student,p_draft:draft.id});
 const receipt=await rpc('studkab_intake_receive',{p_student:student,p_draft:draft.id,p_revision:snap.revision,p_deadline:'2026-10-30',p_description:'',p_contact:'synthetic@example.invalid'});
 const reading=async()=>{
  const c=await rpc('studkab_registered_read_claim',{p_version:'intake-reader-1'});
  const result={schema:1,readerVersion:'intake-reader-1',status:'ready',blocks:[{text,kind:'paragraph',source:{part:'word/document.xml',paragraph:1}}],warnings:[],extracted_text:text,fileId:file.id,fileHash:file.file_hash};
  assert.equal((await rpc('studkab_registered_read_finish',{p_request:receipt.id,p_revision:c.revision,p_file:file.id,p_lease:c.file.read_lease,p_version:'intake-reader-1',p_result:result})).saved,true);
 };
 if(ready)await reading();
 const source=()=>rpc('studkab_registered_analysis_source',{p_request:receipt.id}),state=(actor=other)=>rpc('studkab_registered_analysis_state',{p_request:receipt.id,p_actor:actor});
 const enqueue=()=>queueRegisteredAnalysis({rpc});let calls=0;
 const provider=async({spec})=>{calls++;return {complete:true,text:JSON.stringify({covered:spec.blocks.map(b=>b.blockId),candidates:[{field:'t',value:'Менеджмент',condition:'',refs:[{blockId:spec.blocks[0].blockId,quote:'Менеджмент'}]}],roles:[]})};};
 const mutate=async(sql)=>{await db.exec('reset role');await db.exec(sql);await db.exec('set role service_role');};
 return {db,rpc,api,draft,file,receipt,source,state,enqueue,provider,reading,mutate,get calls(){return calls;}};
}
test('registered study uses saved sources; repeated/lost enqueue never duplicates a paid part or unblocks preparation',async()=>{
 const f=await fixture();try{
  assert.equal((await f.enqueue()).status,'registered_analysis_queued');assert.equal(await f.enqueue(),null);
  assert.equal((await runIntake({rpc:f.rpc,provider:f.provider})).status,'intake_done');assert.equal(f.calls,1);
  const s=await f.state();assert.equal(s.state,'done');assert.equal(s.result.fields.t.values[0].refs[0].fileHash,f.file.file_hash);assert.equal(s.result.fields.t.values[0].refs[0].fileId,f.file.id);
  assert.equal(await f.enqueue(),null);assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);
  const a=(await f.db.query('select category,extracted_text from studkab_request_attachments')).rows[0];assert.equal(a.category,'unclassified');assert.equal(a.extracted_text,null);
  await assert.rejects(()=>f.db.query("insert into studkab_requirement_passports(request_id,status) values($1,'approved')",[f.receipt.id]),/INTAKE_STUDY_REQUIRED/);
 }finally{await f.db.close();}
});
test('unread originals are processing blockers, never missing-fact questions; disabled policy does no work',async()=>{
 for(const options of [{ready:false},{enabled:false}]){const f=await fixture(options);try{assert.equal(await f.enqueue(),null);assert.equal(f.calls,0);assert.equal((await f.state()).state,options.ready===false?'reading_blocked':'disabled');assert.equal((await f.db.query('select count(*) n from studkab_intake_analysis_jobs')).rows[0].n,0);}finally{await f.db.close();}}
});
test('whole plan cost must fit both authorized limits before any paid part is queued',async()=>{
 for(const budget of ['studkab_gen_budget','studkab_intake_analysis_policy']){const f=await fixture();try{
  await f.mutate('update '+budget+' set limit_microusd=1');assert.equal((await f.enqueue()).status,'registered_analysis_budget');assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.equal(f.calls,0);assert.equal((await f.db.query('select reserved_microusd from studkab_gen_budget')).rows[0].reserved_microusd,0);
 }finally{await f.db.close();}}
});
test('revocation, reassignment, deletion, revision or changed attachment prevents paid dispatch',async()=>{
 for(const change of ["delete from studkab_members where user_id='"+student+"'","update studkab_requests set student_id='"+other+"'",'update studkab_requests set deleting_at=now()','update studkab_requests set revision=revision+1','delete from studkab_request_attachments']){const f=await fixture();try{
  await f.enqueue();await f.mutate(change);const current=await f.source();assert.ok(current===null||current.files.length===0);assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.equal(f.calls,0);
  assert.equal((await f.db.query('select state from studkab_intake_analysis_jobs')).rows[0].state,'stale');
 }finally{await f.db.close();}}
});
test('request change during provider call rejects saved result and retains paid reservation',async()=>{
 const f=await fixture();try{
  await f.enqueue();const provider=async c=>{const r=await f.provider(c);await f.mutate('update studkab_requests set revision=revision+1');return r;};
  assert.equal((await runIntake({rpc:f.rpc,provider})).status,'intake_stale');assert.equal((await f.state()).state,'stale');assert.equal(await f.enqueue(),null);assert.equal(f.calls,1);
  assert.ok(Number((await f.db.query('select reserved_microusd from studkab_gen_budget')).rows[0].reserved_microusd)>0);
 }finally{await f.db.close();}
});
test('unknown paid outcome and lost enqueue/finish responses do not automatically spend again',async()=>{
 for(const fault of ['enqueue','finish','provider']){const f=await fixture();try{
  const rpc=async(name,args)=>{const r=await f.rpc(name,args);if(name===(fault==='enqueue'?'studkab_registered_analysis_start':'studkab_intake_analysis_finish'))throw Error('lost response');return r;};
  await queueRegisteredAnalysis({rpc:fault==='enqueue'?rpc:f.rpc});
  const provider=fault==='provider'?async()=>{throw Error('timeout');}:f.provider;
  await runIntake({rpc:fault==='finish'?rpc:f.rpc,provider});const s=await f.state();assert.equal(s.state,fault==='provider'?'unknown':'done');
  assert.equal(await f.enqueue(),null);assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.ok(f.calls<=1);
 }finally{await f.db.close();}}
});
test('private result access checks executor twice; browser database roles cannot read or enqueue',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>f.state(student),/FORBIDDEN/);
  const deps={db:async(path,method,args)=>path.startsWith('rpc/')?f.rpc(path.slice(4),args):(await f.db.query('select * from studkab_question_proposals')).rows,config:async()=>({executor_email:email})};
  assert.equal((await registeredStudyAction({id:f.receipt.id},{id:student,email:'student@example.invalid'},deps)).status,403);
  assert.equal((await registeredStudyAction({id:f.receipt.id},{id:student,email},deps).catch(()=>({status:403}))).status,403);
  const h=handler({...deps,auth:async()=>({id:other,email,email_confirmed_at:'yes'})});
  const r=await h(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer valid'},body:JSON.stringify({action:'registered-study-state',id:f.receipt.id})}));assert.equal(r.status,200);
  for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(()=>f.state(),/permission denied/);assert.equal((await f.enqueue()).status,'registered_analysis_source_unavailable');await assert.rejects(()=>f.db.query('select result from studkab_intake_analysis_jobs'),/permission denied/);}
 }finally{await f.db.close();}
});
test('malformed reader version fail before a provider call',async()=>{
 const f=await fixture();try{
  await f.db.exec("update studkab_intake_files set read_version='other-version'");assert.equal((await f.enqueue()).status,'registered_analysis_preparation_blocked');assert.equal(f.calls,0);assert.equal((await f.state()).state,'preparation_blocked');assert.equal(await f.enqueue(),null);
 }finally{await f.db.close();}
});
const conflictProvider=async({spec})=>({complete:true,text:JSON.stringify({covered:spec.blocks.map(b=>b.blockId),candidates:['Менеджмент','Финансы'].map(value=>({field:'t',value,condition:'',refs:[{blockId:spec.blocks[0].blockId,quote:value}]})),roles:[]})});
async function proposal(f){
 await f.enqueue();await runIntake({rpc:f.rpc,provider:conflictProvider});
 return (await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id})).proposals[0];
}
const decide=(f,q,decision,text,actor=other)=>f.rpc('studkab_registered_question_decide',{p_request:f.receipt.id,p_actor:actor,p_proposal:q.id,p_decision:decision,p_text:text});
test('proposals and rationale stay private; only explicit executor decision publishes the exact edited wording once',async()=>{
 const f=await fixture();try{
  const q=await proposal(f);assert.equal(q.state,'pending');assert.ok(q.evidence.every(v=>v.refs[0].fileHash===f.file.file_hash));
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,0);assert.equal((await f.db.query('select count(*) n from studkab_dialog_events')).rows[0].n,0);
  await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});assert.equal((await f.db.query('select count(*) n from studkab_question_proposals')).rows[0].n,1);
  await assert.rejects(()=>decide(f,q,'publish',q.question,student),/FORBIDDEN/);
  const edited='Какая из двух тем согласована преподавателем?';assert.equal((await decide(f,q,'publish',edited)).published_text,edited);assert.equal((await decide(f,q,'publish',edited)).duplicate,true);assert.equal((await decide(f,q,'publish','Другой вопрос')).conflict,true);
  assert.equal((await f.db.query('select question from studkab_clarifications')).rows[0].question,edited);
  const events=(await f.db.query('select * from studkab_dialog_events')).rows;assert.equal(events.length,1);assert.equal(events[0].recipient_id,student);
  await assert.rejects(()=>f.db.query("update studkab_question_proposals set question='rewritten'"),/IMMUTABLE_QUESTION_PROPOSAL/);
 }finally{await f.db.close();}
});
test('return stores comment privately, invalidates current manifest, then records a fresh reason without publishing',async()=>{
 const f=await fixture();try{
  const q=await proposal(f),before=(await f.state()).manifest;
  assert.equal((await decide(f,q,'return','коротко')).invalid,true);
  const comment='Проверьте тему в задании и применимость общей методички.';
  assert.equal((await decide(f,q,'return',comment)).state,'returned');assert.equal((await decide(f,q,'return',comment)).duplicate,true);
  assert.equal((await f.state()).state,'awaiting_analysis');assert.equal((await f.source()).reviewInstructions[0].comment,comment);
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,0);assert.equal((await f.db.query('select count(*) n from studkab_dialog_events')).rows[0].n,0);
  await f.enqueue();await runIntake({rpc:f.rpc,provider:f.provider});assert.notEqual((await f.state()).manifest,before);
  const refresh=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});assert.equal(refresh.proposals[0].state,'returned');assert.match(refresh.proposals[0].restudy_reason,/не обнаружил/);assert.ok(refresh.proposals[0].restudy_analysis_id);
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('re-study that still finds ambiguity creates a new private proposal requiring another explicit approval',async()=>{
 const f=await fixture();try{
  const q=await proposal(f);await decide(f,q,'return','Проверьте обе темы в оригиналах.');await f.enqueue();await runIntake({rpc:f.rpc,provider:conflictProvider});
  const r=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});assert.equal(r.proposals.length,2);assert.equal(r.proposals[1].state,'pending');assert.notEqual(r.proposals[1].id,q.id);assert.match(r.proposals[0].restudy_reason,/сохранилась/);assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('only student answers; saved answer changes the analysis manifest and becomes a separate attributed source',async()=>{
 const f=await fixture();try{
  const q=await proposal(f);await decide(f,q,'publish',q.question);
  const answer=(actor)=>f.rpc('studkab_clarification_answer',{p_request:f.receipt.id,p_actor:actor,p_id:q.id,p_answer:'Менеджмент',p_source:'Пояснение преподавателя'});
  await assert.rejects(()=>answer(other),/FORBIDDEN/);await answer(student);
  const s=await f.source();assert.equal(s.studentAnswers[0].author,student);assert.equal((await f.state()).state,'awaiting_analysis');
  const p=analysisPlan(s);assert.ok(p.flatMap(part=>part.blocks).some(b=>b.source.questionId===q.id&&b.source.author===student));
  assert.equal((await f.db.query("select count(*) n from studkab_dialog_events where kind='answer'")).rows[0].n,1);
  await f.enqueue();await runIntake({rpc:f.rpc,provider:conflictProvider});
  const review=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});assert.equal(review.proposals.length,1);assert.match(review.proposals[0].restudy_reason,/Ответ студента включён/);
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('stale material revision rejects publication; pending private question cannot leak through direct browser SQL',async()=>{
 const f=await fixture();try{
  const q=await proposal(f);await f.mutate('update studkab_requests set revision=revision+1');assert.equal((await decide(f,q,'publish',q.question)).stale,true);
  for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(()=>f.db.query('select * from studkab_question_proposals'),/permission denied/);await assert.rejects(()=>decide(f,q,'publish',q.question),/permission denied/);}
 }finally{await f.db.close();}
});
test('review comment is guidance, never an allowed fact citation; legacy plans are byte-compatible',()=>{
 const file={id:student,file_name:'Test.docx',file_hash:'a'.repeat(64),read_status:'ready',read_version:'intake-reader-1',read_result:{readerVersion:'intake-reader-1',status:'ready',blocks:[{text,source:{paragraph:1}}]}};
 const a=analysisPlan({files:[file]}),b=analysisPlan({files:[file],reviewInstructions:[{comment:'Секретная выдуманная тема'}]});
 assert.ok(!a[0].prompt.includes('reviewInstructions'));assert.ok(b[0].prompt.includes('Секретная выдуманная тема'));assert.ok(!b[0].blocks.some(block=>block.text.includes('Секретная выдуманная тема')));
 assert.throws(()=>verifyExtraction(JSON.stringify({covered:b[0].blocks.map(x=>x.blockId),candidates:[{field:'t',value:'Секретная выдуманная тема',condition:'',refs:[{blockId:b[0].blocks[0].blockId,quote:'Секретная выдуманная тема'}]}],roles:[]}),b[0]),/INVALID_SOURCE/);
});
test('executor confirms only grounded file role, preserving originals and requiring a separate passport approval',async()=>{
 const f=await fixture();try{
  await f.enqueue();await runIntake({rpc:f.rpc,provider:async c=>{const result=await f.provider(c),parsed=JSON.parse(result.text);parsed.roles=[{role:'assignment',refs:[{blockId:c.spec.blocks[0].blockId,quote:'Менеджмент'}]}];return {...result,text:JSON.stringify(parsed)};}});
  const state=await f.state(),before=(await f.db.query('select * from studkab_request_attachments')).rows[0];
  const classify=(category='assignment',actor=other)=>f.rpc('studkab_registered_material_classify',{p_request:f.receipt.id,p_actor:actor,p_analysis:state.analysisId,p_file:f.file.id,p_category:category});
  await assert.rejects(()=>classify('assignment',student),/FORBIDDEN/);assert.equal((await classify('sources')).unsupported,true);
  assert.equal((await classify()).saved,true);assert.equal((await classify()).duplicate,true);
  const after=(await f.db.query('select * from studkab_request_attachments')).rows[0];assert.equal(after.file_hash,before.file_hash);assert.equal(after.storage_path,before.storage_path);assert.equal(after.category,'assignment');assert.equal(after.extracted_text,text);
  assert.equal((await f.state()).manifest,state.manifest);assert.equal((await f.state()).files[0].category,'assignment');
  await assert.rejects(()=>f.db.query("update studkab_request_attachments set category='sources'"),/Immutable attachment/);
  assert.equal((await f.db.query("select count(*) n from studkab_requirement_passports where status='approved'")).rows[0].n,0);
 }finally{await f.db.close();}
});
test('reading-binding metadata reuses exactly matching completed study with no second reservation',async()=>{
 const f=await fixture();try{
  await f.enqueue();await runIntake({rpc:f.rpc,provider:f.provider});const original=await f.state();
  await f.mutate("update studkab_intake_files set registered_read_request=null,registered_read_revision=null");
  assert.equal((await f.enqueue()).status,'registered_analysis_queued');assert.equal((await f.state()).state,'done');assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.equal(f.calls,1);
  const jobs=(await f.db.query('select * from studkab_intake_analysis_jobs order by created_at,id')).rows;assert.equal(jobs.length,2);const reused=jobs.find(j=>j.id!==original.analysisId);assert.equal(Number(reused.reserved_microusd),0);assert.equal(reused.raw_outputs[0].reused_analysis_id,original.analysisId);
 }finally{await f.db.close();}
});
test('reading-binding metadata cannot buy the same partially paid or uncertain plan again',async()=>{
 const f=await fixture();try{
  await f.enqueue();const claim=await f.rpc('studkab_intake_analysis_claim',{});
  assert.ok(await f.rpc('studkab_intake_analysis_dispatch',{p_job:claim.job_id,p_claim:claim.claim,p_cost:claim.part.max_cost_microusd}));
  await f.mutate("update studkab_intake_files set registered_read_request=null,registered_read_revision=null");
  assert.equal((await f.enqueue()).status,'registered_analysis_reconciliation');assert.equal((await f.state()).state,'unknown');
  assert.equal(await f.enqueue(),null);assert.equal((await f.db.query('select count(*) n from studkab_intake_analysis_jobs')).rows[0].n,1);assert.equal(f.calls,0);
 }finally{await f.db.close();}
});
test('classification cannot bypass a pending private proposal or a returned study awaiting re-analysis',async()=>{
 const f=await fixture();try{
  await f.enqueue();await runIntake({rpc:f.rpc,provider:async c=>{const output=await conflictProvider(c),x=JSON.parse(output.text);x.roles=[{role:'assignment',refs:[{blockId:c.spec.blocks[0].blockId,quote:'Менеджмент'}]}];return {...output,text:JSON.stringify(x)};}});
  await f.rpc('studkab_registered_material_classify',{p_request:f.receipt.id,p_actor:other,p_analysis:(await f.state()).analysisId,p_file:f.file.id,p_category:'assignment'});
  const approve=()=>f.db.query("insert into studkab_requirement_passports(request_id,status) values($1,'approved')",[f.receipt.id]);
  await assert.rejects(approve,/INTAKE_QUESTIONS_REVIEW_REQUIRED/);
  const q=(await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id})).proposals[0];
  await assert.rejects(approve,/INTAKE_QUESTIONS_REVIEW_REQUIRED/);await decide(f,q,'return','Перечитайте тему из задания.');await assert.rejects(approve,/INTAKE_STUDY_REQUIRED/);
 }finally{await f.db.close();}
});
