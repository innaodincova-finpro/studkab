import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {schema,submissionExtension,student,other,apiDatabase} from './intake-fixture.mjs';
import {analysisPlan,verifyExtraction} from '../supabase/functions/_shared/intake-analysis.mjs';
import {queueRegisteredAnalysis} from '../supabase/functions/studkab-generation/registered-analysis.mjs';
import {runIntake as runIntakePart} from '../supabase/functions/studkab-generation/intake-runner.mjs';
import {registeredStudyAction} from '../supabase/functions/studkab-requests/registered-study.mjs';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
import {registeredAnalysisPlan,verifyKitReview,validReviewPart,REVIEW_VERSION} from '../supabase/functions/_shared/registered-review.mjs';
import {kitAdapt} from './kit-adapter.mjs';
async function runIntake(args){args={...args,provider:kitAdapt(args.provider)};for(let i=0;i<120;i++){const result=await runIntakePart(args);if(result?.status!=='intake_queued')return result;}throw Error('did not finish');}
function reviewResponse(spec){return {covered:spec.blocks.map(b=>b.blockId),gaps:[],returnedReviews:spec.reviewInstructions.filter(i=>i.proposalId).map(i=>({proposalId:i.proposalId,status:'resolved',reason:'Вопрос снят: исходное задание содержит применимое условие; общий вариант методички не изменяет его.',refs:[{blockId:spec.blocks.find(b=>b.fileId).blockId,quote:spec.blocks.find(b=>b.fileId).text}]})),answerReviews:spec.answers.map(a=>({questionId:a.id,status:'sufficient',reason:'Ответ содержит применимое условие по исходному заданию.',refs:[spec.blocks.find(b=>b.source?.questionId===a.id),spec.blocks.find(b=>b.fileId)].map(b=>({blockId:b.blockId,quote:b.text}))}))};}
const read=n=>fs.readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const migration=read('20261002015056_route02_registered_analysis.sql');
const text='Тема: Менеджмент. Тема: Финансы. Объём 25 страниц.',email='executor@example.invalid';
async function fixture({enabled=true,ready=true,kitText=text}={}){
 const db=new PGlite();await db.exec(schema()+submissionExtension()+read('20261001162253_route02_receive_before_analysis.sql')+read('20261001175519_route02_registered_reading.sql'));
 await db.exec(`alter table auth.users add column email text;update auth.users set email='${email}' where id='${other}';grant select(id,email) on auth.users to service_role;update studkab_request_config set executor_email='${email}';`);
 const rpc=async(name,args={})=>{assert.match(name,/^studkab_[a-z_]+$/);return (await db.query('select '+name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r;};
 await db.exec('set role service_role');const api=apiDatabase(db),draft=await rpc('studkab_intake_open',{p_student:student});
 const {file}=await rpc('studkab_intake_reserve',{p_student:student,p_draft:draft.id,p_name:'Assignment.docx',p_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',p_size:100,p_hash:'a'.repeat(64),p_supersedes:null});
 await rpc('studkab_intake_finish',{p_student:student,p_draft:draft.id,p_file:file.id,p_hash:file.file_hash});
 const legacy=await rpc('studkab_intake_analysis_source',{p_draft:draft.id});
 await db.exec('reset role');await db.exec(migration+read('20260921165603_c084_requirement_clarifications.sql')+read('20260926114639_c120_dialog_events.sql')+read('20261002015751_route02_private_questions.sql')+read('20261002020616_route02_reviewed_classification.sql')+read('20261002031300_route02_kit_review.sql')+read('20261002052253_route02_private_dialog.sql')+read('20261002150000_route02_kit_whole.sql')+read('20261003100000_route02_intake_ledger_access.sql')+read('20261003130000_route02_registered_replace.sql')+read('20261003230000_route02_checklist_live.sql')+read('20261004100000_route02_ux01_replace_pending.sql'));await db.exec('revoke all on studkab_gen_reconciliations from service_role');await db.exec('revoke update on studkab_request_attachments from service_role;grant update(category,extracted_text) on studkab_request_attachments to service_role');if(enabled)await db.exec('update studkab_intake_analysis_policy set enabled=true,limit_microusd=10000000;update studkab_gen_budget set limit_microusd=10000000');await db.exec('set role service_role');
 assert.deepEqual(await rpc('studkab_intake_analysis_source',{p_draft:draft.id}),legacy);
 const snap=await rpc('studkab_intake_receive_snapshot',{p_student:student,p_draft:draft.id});
 const receipt=await rpc('studkab_intake_receive',{p_student:student,p_draft:draft.id,p_revision:snap.revision,p_deadline:'2026-10-30',p_description:'',p_contact:'synthetic@example.invalid'});
 const reading=async()=>{
  const c=await rpc('studkab_registered_read_claim',{p_version:'intake-reader-1'});
  const result={schema:1,readerVersion:'intake-reader-1',status:'ready',blocks:[{text:kitText,kind:'paragraph',source:{part:'word/document.xml',paragraph:1}}],warnings:[],extracted_text:kitText,fileId:file.id,fileHash:file.file_hash};
  assert.equal((await rpc('studkab_registered_read_finish',{p_request:receipt.id,p_revision:c.revision,p_file:file.id,p_lease:c.file.read_lease,p_version:'intake-reader-1',p_result:result})).saved,true);
 };
 if(ready)await reading();
 const source=()=>rpc('studkab_registered_analysis_source',{p_request:receipt.id}),state=(actor=other)=>rpc('studkab_registered_analysis_state',{p_request:receipt.id,p_actor:actor});
 const enqueue=()=>queueRegisteredAnalysis({rpc});let calls=0;
 const provider=async({spec})=>{calls++;if(spec.kind==='kit_review')return {complete:true,text:JSON.stringify(reviewResponse(spec))};return {complete:true,text:JSON.stringify({covered:spec.blocks.map(b=>b.blockId),candidates:[{field:'t',value:'Менеджмент',condition:'',refs:[{blockId:spec.blocks[0].blockId,quote:'Менеджмент'}]}],roles:[]})};};
 const mutate=async(sql)=>{await db.exec('reset role');await db.exec(sql);await db.exec('set role service_role');};
 return {db,rpc,api,draft,file,receipt,source,state,enqueue,provider,reading,mutate,get calls(){return calls;}};
}
test('registered study uses saved sources; repeated/lost enqueue never duplicates a paid part or unblocks preparation',async()=>{
 const f=await fixture();try{
  assert.equal((await f.enqueue()).status,'registered_analysis_queued');assert.equal(await f.enqueue(),null);
  assert.equal((await runIntake({rpc:f.rpc,provider:f.provider})).status,'intake_done');assert.equal(f.calls,2);
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
 for(const change of ["delete from studkab_members where user_id='"+student+"'","update studkab_requests set student_id='"+other+"'",'update studkab_requests set deleting_at=now()',"update studkab_requests set payload=jsonb_set(payload,'{dl}','\"2026-11-30\"')",'delete from studkab_request_attachments']){const f=await fixture();try{
  const before=await f.source();await f.enqueue();await f.mutate(change);const current=await f.source();
  // KIT-03: изменение содержания (срок) даёт новую версию комплекта; прочие изменения делают его недоступным.
  if(change.includes("'{dl}'"))assert.notDeepEqual(current,before);else assert.ok(current===null||current.files.length===0);
  assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.equal(f.calls,0);
  assert.equal((await f.db.query('select state from studkab_intake_analysis_jobs')).rows[0].state,'stale');
 }finally{await f.db.close();}}
});
test('request change during provider call rejects saved result and retains paid reservation',async()=>{
 const f=await fixture();try{
  await f.enqueue();const provider=async c=>{const r=await f.provider(c);await f.mutate("update studkab_requests set payload=jsonb_set(payload,'{dl}','\"2026-11-30\"')");return r;};
  assert.equal((await runIntake({rpc:f.rpc,provider})).status,'intake_stale');assert.equal(f.calls,1);
  assert.equal((await f.db.query('select state from studkab_intake_analysis_jobs')).rows[0].state,'stale');
  // KIT-03: изменённый комплект изучается заново как новая версия; устаревший результат не сохраняется.
  assert.equal((await f.state()).state,'awaiting_analysis');assert.equal((await f.enqueue()).status,'registered_analysis_queued');
  // Служебная смена номера редакции без изменения содержания нового платного разбора не создаёт.
  await f.mutate('update studkab_requests set revision=revision+1');assert.equal(await f.enqueue(),null);
  assert.ok(Number((await f.db.query('select reserved_microusd from studkab_gen_budget')).rows[0].reserved_microusd)>0);
 }finally{await f.db.close();}
});
test('unknown paid outcome and lost enqueue/finish responses do not automatically spend again',async()=>{
 for(const fault of ['enqueue','finish','provider']){const f=await fixture();try{
  const rpc=async(name,args)=>{const r=await f.rpc(name,args);if(name===(fault==='enqueue'?'studkab_registered_analysis_start':'studkab_intake_analysis_finish'))throw Error('lost response');return r;};
  await queueRegisteredAnalysis({rpc:fault==='enqueue'?rpc:f.rpc});
  const provider=fault==='provider'?async()=>{throw Error('timeout');}:f.provider;
  await runIntake({rpc:fault==='finish'?rpc:f.rpc,provider});const s=await f.state();if(fault==='finish')await runIntake({rpc:f.rpc,provider:f.provider});const final=await f.state();assert.equal(final.state,fault==='provider'?'unknown':'done');
  assert.equal(await f.enqueue(),null);assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.ok(f.calls<=2);
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
const conflictProvider=async({spec})=>{
 if(spec.kind==='kit_review'){
  const x=reviewResponse(spec);
  if(!spec.answers.length)x.gaps=[{key:'topic',question:'Какая тема согласована преподавателем?',reason:'В документах указаны разные темы.',refs:['Менеджмент','Финансы'].map(quote=>({blockId:spec.blocks.find(b=>b.text.includes(quote)).blockId,quote})),answerId:null,returnedProposalIds:spec.reviewInstructions.filter(i=>i.itemId==='FIELD_GAP_topic').map(i=>i.proposalId)}];
  for(const r of x.returnedReviews)if(x.gaps.some(g=>g.returnedProposalIds.includes(r.proposalId))){r.status='unresolved';r.reason='После повторного чтения сохраняются две разные темы в оригинале.';}
  return {complete:true,text:JSON.stringify(x)};
 }
 return {complete:true,text:JSON.stringify({covered:spec.blocks.map(b=>b.blockId),candidates:['Менеджмент','Финансы'].map(value=>({field:'t',value,condition:'',refs:[{blockId:spec.blocks[0].blockId,quote:value}]})),roles:[]})};
};
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
  const refresh=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});assert.equal(refresh.proposals[0].state,'returned');assert.match(refresh.proposals[0].restudy_reason,/Вопрос снят/);assert.ok(refresh.proposals[0].restudy_analysis_id);
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('re-study that still finds ambiguity creates a new private proposal requiring another explicit approval',async()=>{
 const f=await fixture();try{
  const q=await proposal(f);await decide(f,q,'return','Проверьте обе темы в оригиналах.');await f.enqueue();await runIntake({rpc:f.rpc,provider:conflictProvider});
  const r=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});assert.equal(r.proposals.length,2);assert.equal(r.proposals[1].state,'pending');assert.notEqual(r.proposals[1].id,q.id);assert.match(r.proposals[0].restudy_reason,/сохраняются две разные темы/);assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,0);
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
  const review=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});assert.equal(review.proposals.length,1);assert.match(review.proposals[0].restudy_reason,/Ответ достаточен/);
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('stale material revision rejects publication; pending private question cannot leak through direct browser SQL',async()=>{
 const f=await fixture();try{
  const q=await proposal(f);
  // KIT-03: смена номера редакции без изменения содержания вопрос не устаревает; замена файла — устаревает.
  await f.mutate('update studkab_requests set revision=revision+1');
  const hash='f'.repeat(64),reserved=await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'v2.docx',p_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',p_size:10,p_hash:hash});
  await f.rpc('studkab_registered_replace_finish',{p_student:student,p_request:f.receipt.id,p_file:reserved.file.id,p_hash:hash});
  assert.equal((await decide(f,q,'publish',q.question)).stale,true);
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
  assert.equal((await f.enqueue()).status,'registered_analysis_queued');assert.equal((await f.state()).state,'done');assert.equal(await runIntake({rpc:f.rpc,provider:f.provider}),null);assert.equal(f.calls,2);
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
  await assert.rejects(approve,/INTAKE_ESSENTIAL_GAPS_UNRESOLVED/);
  const q=(await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id})).proposals[0];
  await assert.rejects(approve,/INTAKE_ESSENTIAL_GAPS_UNRESOLVED/);await decide(f,q,'return','Перечитайте тему из задания.');await assert.rejects(approve,/INTAKE_STUDY_REQUIRED/);
 }finally{await f.db.close();}
});

test('essential document gap blocks passport before proposals exist; insufficient answer keeps a fresh question private',async()=>{
 const f=await fixture({kitText:'Менеджмент. Для анализа предоставить ОДДС за 2022–2024 годы.'});try{
  const provider=async c=>{
   const r=await f.provider(c),x=JSON.parse(r.text);
   if(c.spec.kind!=='kit_review'){x.roles=[{role:'assignment',refs:[{blockId:c.spec.blocks[0].blockId,quote:'Менеджмент'}]}];}
   else{
    const original=c.spec.blocks.find(b=>b.fileId),answer=c.spec.blocks.find(b=>b.source?.questionId);
    const refs=[{blockId:original.blockId,quote:'Для анализа предоставить ОДДС за 2022–2024 годы.'}];
    if(answer)refs.push({blockId:answer.blockId,quote:answer.text});
    x.gaps=[{key:'cash_flow',question:'Предоставьте ОДДС за 2022–2024 годы.',reason:'Для денежного анализа необходим документ из задания.',refs,answerId:answer?.source.questionId||null}];
    x.answerReviews=answer?[{questionId:answer.source.questionId,status:'insufficient',reason:'Ответ «Не знаю» не предоставляет исходный документ.',refs}]:[];
   }
   return {...r,text:JSON.stringify(x)};
  };
  await f.enqueue();assert.equal((await runIntake({rpc:f.rpc,provider})).status,'intake_done');
  await f.rpc('studkab_registered_material_classify',{p_request:f.receipt.id,p_actor:other,p_analysis:(await f.state()).analysisId,p_file:f.file.id,p_category:'assignment'});
  const approve=()=>f.db.query("insert into studkab_requirement_passports(request_id,status) values($1,'approved')",[f.receipt.id]);
  await assert.rejects(approve,/INTAKE_ESSENTIAL_GAPS_UNRESOLVED/);
  const q=(await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id})).proposals[0];
  assert.equal(q.item_id,'FIELD_GAP_cash_flow');assert.equal(q.state,'pending');assert.equal((await f.db.query('select count(*) n from studkab_dialog_events')).rows[0].n,0);
  await decide(f,q,'publish',q.question);
  await f.rpc('studkab_clarification_answer',{p_request:f.receipt.id,p_actor:student,p_id:q.id,p_answer:'Не знаю',p_source:'Уточню у преподавателя'});
  await f.enqueue();await runIntake({rpc:f.rpc,provider});
  const refreshed=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});
  assert.equal(refreshed.proposals.length,2);assert.equal(refreshed.proposals[1].state,'pending');assert.match(refreshed.proposals[0].restudy_reason,/Ответ недостаточен/);
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,1);
  await assert.rejects(approve,/INTAKE_ESSENTIAL_GAPS_UNRESOLVED/);
 }finally{await f.db.close();}
});
test('a legacy completed extraction without whole-kit adequacy cannot approve the registered passport',async()=>{
 const f=await fixture();try{
  const legacy={analysisVersion:'intake-analysis-2',status:'candidate',fields:{},roles:[{role:'assignment',refs:[{fileId:f.file.id,quote:'Менеджмент'}]}]};
  await f.db.query("insert into studkab_intake_analysis_jobs(draft_id,manifest,version,plan,state,result) values($1,encode(sha256(convert_to(studkab_registered_analysis_source($2)::text,'UTF8')),'hex'),'intake-analysis-2','[{}]','done',$3)",[f.draft.id,f.receipt.id,legacy]);
  const current=await f.state();await f.rpc('studkab_registered_material_classify',{p_request:f.receipt.id,p_actor:other,p_analysis:current.analysisId,p_file:f.file.id,p_category:'assignment'});
  await assert.rejects(()=>f.db.query("insert into studkab_requirement_passports(request_id,status) values($1,'approved')",[f.receipt.id]),/INTAKE_STUDY_REQUIRED/);
 }finally{await f.db.close();}
});

test('KIT-02: whole-kit method keeps a paid legacy extraction untouched and reserves only its own two parts',async()=>{
 const f=await fixture();try{
  const plan=registeredAnalysisPlan(await f.source()),prefix=plan.slice(0,-1).map(({extraction_parts,...p})=>p);
  const raw=await f.provider({spec:prefix[0]}),parsed=verifyExtraction(raw.text,prefix[0]),cost=prefix[0].max_cost_microusd;
  const inserted=await f.db.query("insert into studkab_intake_analysis_jobs(draft_id,manifest,version,plan,state,ordinal,part_results,result,reserved_microusd) values($1,$2,'intake-analysis-2',$3,'done',1,$4,$5,$6) returning id",[f.draft.id,'c'.repeat(64),prefix,[parsed],{analysisVersion:'intake-analysis-2',status:'candidate'},cost]);
  await f.mutate('update studkab_gen_budget set reserved_microusd='+cost);
  const before=f.calls;assert.equal((await f.enqueue()).status,'registered_analysis_queued');
  assert.equal((await runIntake({rpc:f.rpc,provider:f.provider})).status,'intake_done');assert.equal(f.calls,before+2);
  const current=await f.state(),job=(await f.db.query('select * from studkab_intake_analysis_jobs where id=$1',[current.analysisId])).rows[0];
  assert.deepEqual(job.plan.map(p=>p.kind),['kit_extraction','kit_review']);assert.equal(Number(job.reserved_microusd),job.plan[0].max_cost_microusd+job.plan[1].max_cost_microusd);
  const legacy=(await f.db.query('select state,reserved_microusd from studkab_intake_analysis_jobs where id=$1',[inserted.rows[0].id])).rows[0];assert.equal(legacy.state,'done');assert.equal(Number(legacy.reserved_microusd),cost);
  assert.equal(current.result.fields.t.values[0].value,'Менеджмент');
 }finally{await f.db.close();}
});
test('KIT-02: an uncertain legacy extraction keeps its reserve; the new method is limited by the remaining policy',async()=>{
 const f=await fixture();try{
  const plan=registeredAnalysisPlan(await f.source()),prefix=plan.slice(0,-1).map(({extraction_parts,...p})=>p);
  await f.db.query("insert into studkab_intake_analysis_jobs(draft_id,manifest,version,plan,state,reserved_microusd) values($1,$2,'intake-analysis-2',$3,'unknown',1000)",[f.draft.id,'c'.repeat(64),prefix]);
  await f.mutate('update studkab_gen_budget set reserved_microusd=1000;update studkab_intake_analysis_policy set limit_microusd=1001');
  assert.equal((await f.enqueue()).status,'registered_analysis_budget');assert.equal(f.calls,0);
  const legacy=(await f.db.query("select state,reserved_microusd from studkab_intake_analysis_jobs where state='unknown'")).rows[0];assert.equal(Number(legacy.reserved_microusd),1000);
 }finally{await f.db.close();}
});

test('whole-kit applicability judgment does not repeat a conditional rule that does not apply',async()=>{
 const f=await fixture({kitText:'Менеджмент. Для диплома: объём 80 страниц. Эта работа — курсовая.'});try{
  const provider=async c=>{const r=await f.provider(c),x=JSON.parse(r.text);if(c.spec.kind!=='kit_review'){
   x.candidates.push({field:'length',value:'объём 80 страниц',condition:'Для диплома',refs:[{blockId:c.spec.blocks[0].blockId,quote:'объём 80 страниц'}]});
   x.roles=[{role:'assignment',refs:[{blockId:c.spec.blocks[0].blockId,quote:'Менеджмент'}]}];
  }return {...r,text:JSON.stringify(x)};};
  await f.enqueue();await runIntake({rpc:f.rpc,provider});assert.equal((await f.state()).result.fields.length.status,'needs_review');
  const refresh=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});assert.equal(refresh.proposals.length,0);
  await f.rpc('studkab_registered_material_classify',{p_request:f.receipt.id,p_actor:other,p_analysis:(await f.state()).analysisId,p_file:f.file.id,p_category:'assignment'});
  await f.db.query("insert into studkab_requirement_passports(request_id,status) values($1,'approved')",[f.receipt.id]);
 }finally{await f.db.close();}
});

test('C acceptance: unknown answer, explicit follow-up, adequate reply and source-bound admission',async()=>{
 const kit='Менеджмент. Для этой курсовой выберите одну тему: Менеджмент или Финансы. Укажите выбор преподавателя.';
 const f=await fixture({kitText:kit});try{
  const provider=async c=>{
   const r=await f.provider(c),x=JSON.parse(r.text);
   if(c.spec.kind!=='kit_review')x.roles=[{role:'assignment',refs:[{blockId:c.spec.blocks[0].blockId,quote:'Менеджмент'}]}];
   else {
    const original=c.spec.blocks.find(b=>b.fileId),e={blockId:original.blockId,quote:kit};
    const answers=c.spec.answers.map(a=>({id:a.id,b:c.spec.blocks.find(b=>b.source?.questionId===a.id)}));
    const adequate=answers.some(a=>a.b.text.includes('Выбрана тема Финансы'));
    x.gaps=adequate?[]:[{key:'chosen_topic',question:'Какую тему выбрал преподаватель?',reason:'Задание разрешает варианты, а применимый выбор не подтверждён.',refs:[e,...answers.map(a=>({blockId:a.b.blockId,quote:a.b.text}))],answerId:answers.at(-1)?.id||null}];
    x.answerReviews=answers.map(a=>({questionId:a.id,status:adequate?'sufficient':'unknown',reason:adequate?'Поздний ответ содержит выбор из разрешённых оригиналом вариантов; прежняя неопределённость снята.':'Ответ не устанавливает выбор преподавателя.',refs:[e,{blockId:a.b.blockId,quote:a.b.text},...answers.filter(z=>z.id!==a.id).map(z=>({blockId:z.b.blockId,quote:z.b.text}))]}));
   }
   return {...r,text:JSON.stringify(x)};
  };
  const study=async()=>{assert.equal((await f.enqueue()).status,'registered_analysis_queued');assert.equal((await runIntake({rpc:f.rpc,provider})).status,'intake_done');return f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});};
  const gate=()=>f.db.query("insert into studkab_requirement_passports(request_id,status) values($1,'approved')",[f.receipt.id]);
  const initial=await study(),q1=initial.proposals[0];
  assert.equal(q1.state,'pending');assert.equal((await f.db.query('select count(*) n from studkab_dialog_events')).rows[0].n,0);
  await assert.rejects(gate,/INTAKE_ESSENTIAL_GAPS_UNRESOLVED/);
  await decide(f,q1,'publish',q1.question);
  await f.rpc('studkab_clarification_answer',{p_request:f.receipt.id,p_actor:student,p_id:q1.id,p_answer:'Не знаю',p_source:'Преподаватель пока не уточнил'});
  const second=await study(),q2=second.proposals.find(q=>q.state==='pending');
  assert.notEqual(q2.id,q1.id);assert.equal((await f.state()).result.kitReview.answerReviews[0].status,'unknown');
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,1);
  await assert.rejects(gate,/INTAKE_ESSENTIAL_GAPS_UNRESOLVED/);
  await decide(f,q2,'publish',q2.question);
  await f.rpc('studkab_clarification_answer',{p_request:f.receipt.id,p_actor:student,p_id:q2.id,p_answer:'Выбрана тема Финансы',p_source:'Выбор преподавателя из вариантов задания'});
  await study();const s=await f.state();assert.equal(s.result.kitReview.gaps.length,0);assert.equal(s.result.kitReview.answerReviews.length,2);assert.ok(s.result.kitReview.answerReviews.every(a=>a.status==='sufficient'));
  assert.equal((await f.db.query("select count(*) n from studkab_requirement_passports where status='approved'")).rows[0].n,0);
  await f.rpc('studkab_registered_material_classify',{p_request:f.receipt.id,p_actor:other,p_analysis:s.analysisId,p_file:f.file.id,p_category:'assignment'});
  await gate();assert.equal((await f.db.query("select count(*) n from studkab_dialog_events where kind='question'")).rows[0].n,2);assert.equal((await f.db.query("select count(*) n from studkab_dialog_events where kind='answer'")).rows[0].n,2);
  assert.equal((await f.db.query('select file_hash from studkab_request_attachments')).rows[0].file_hash,f.file.file_hash);
 }finally{await f.db.close();}
});

test('KIT-02: брак формата даёт один оплачиваемый повтор той же части; второй брак останавливает разбор',async()=>{
 for(const failures of [1,2]){const f=await fixture();try{
  let bad=failures;const provider=async c=>{if(c.spec.kind==='kit_extraction'&&bad>0){bad--;return {complete:true,text:'Вот разбор комплекта: всё хорошо.'};}return f.provider(c);};
  assert.equal((await f.enqueue()).status,'registered_analysis_queued');
  const first=await runIntakePart({rpc:f.rpc,provider:kitAdapt(provider)});assert.equal(first.status,'intake_retry');assert.equal(first.check,'INVALID_EXTRACTION');
  let job=(await f.db.query('select * from studkab_intake_analysis_jobs')).rows[0];assert.equal(job.state,'queued');assert.equal(job.ordinal,0);assert.equal(job.raw_outputs[0].error,'invalid:INVALID_EXTRACTION');assert.equal(job.raw_outputs[0].text,'Вот разбор комплекта: всё хорошо.');
  const reserve=Number(job.reserved_microusd);assert.equal(reserve,job.plan[0].max_cost_microusd);
  const second=await runIntake({rpc:f.rpc,provider});
  job=(await f.db.query('select * from studkab_intake_analysis_jobs')).rows[0];
  if(failures===1){assert.equal(second.status,'intake_done');assert.equal(job.state,'done');assert.equal(Number(job.reserved_microusd),2*job.plan[0].max_cost_microusd+job.plan[1].max_cost_microusd);}
  else {assert.equal(second.status,'intake_invalid');assert.equal(job.state,'invalid');assert.equal(Number(job.reserved_microusd),2*reserve);assert.equal(await runIntakePart({rpc:f.rpc,provider:kitAdapt(provider)}),null);}
  const budget=(await f.db.query('select reserved_microusd from studkab_gen_budget')).rows[0];assert.equal(Number(budget.reserved_microusd),Number(job.reserved_microusd));
 }finally{await f.db.close();}}
});

test('KIT-02: платная отправка работает при закрытой для service_role таблице сверок и по-прежнему ловит расхождение журнала',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>f.db.query('select * from studkab_gen_reconciliations'),/permission denied/);
  for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(()=>f.db.query('select public.studkab_intake_ledger_matches(0)'),/permission denied/);}
  await f.db.exec('reset role;set role service_role');
  assert.equal((await f.enqueue()).status,'registered_analysis_queued');
  // Расхождение общего журнала останавливает отправку до вызова модели.
  await f.mutate('update studkab_gen_budget set reserved_microusd=reserved_microusd+1');
  assert.equal((await runIntakePart({rpc:f.rpc,provider:kitAdapt(f.provider)})).status,'intake_dispatch_unconfirmed');assert.equal(f.calls,0);
  await f.mutate("update studkab_gen_budget set reserved_microusd=reserved_microusd-1;update studkab_intake_analysis_jobs set lease_until=now()-interval '1 second' where state='claimed'");
  assert.equal((await runIntake({rpc:f.rpc,provider:f.provider})).status,'intake_done');assert.equal(f.calls,2);
 }finally{await f.db.close();}
});

const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
async function readFile(f,fileId,hash,text){
 const c=await f.rpc('studkab_registered_read_claim',{p_version:'intake-reader-1'});assert.equal(c.file.id,fileId);
 const result={schema:1,readerVersion:'intake-reader-1',status:'ready',blocks:[{text,kind:'paragraph',source:{part:'word/document.xml',paragraph:1}}],warnings:[],extracted_text:text,fileId,fileHash:hash};
 assert.equal((await f.rpc('studkab_registered_read_finish',{p_request:f.receipt.id,p_revision:c.revision,p_file:fileId,p_lease:c.file.read_lease,p_version:'intake-reader-1',p_result:result})).saved,true);
}
test('KIT-03: замена файла в принятой заявке — новый файл читается, комплект изучается заново, прежний остаётся в истории',async()=>{
 const f=await fixture();try{
  assert.equal((await f.enqueue()).status,'registered_analysis_queued');assert.equal((await runIntake({rpc:f.rpc,provider:f.provider})).status,'intake_done');
  const before=await f.state();assert.equal(before.state,'done');
  const hash='b'.repeat(64);
  const reserved=await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'Assignment-v2.docx',p_type:DOCX,p_size:120,p_hash:hash});
  assert.equal(reserved.file.supersedes,f.file.id);assert.equal(reserved.file.state,'pending');
  // Повтор резерва того же файла возвращает ту же запись.
  assert.equal((await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'Assignment-v2.docx',p_type:DOCX,p_size:120,p_hash:hash})).file.id,reserved.file.id);
  // Чужой студент не может заменить файл.
  assert.equal((await f.rpc('studkab_registered_replace_reserve',{p_student:other,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'x.docx',p_type:DOCX,p_size:10,p_hash:'c'.repeat(64)})).missing,true);
  const finished=await f.rpc('studkab_registered_replace_finish',{p_student:student,p_request:f.receipt.id,p_file:reserved.file.id,p_hash:hash});
  assert.equal(finished.attachment.supersedes,f.file.id);assert.equal(finished.duplicate,false);
  assert.equal((await f.rpc('studkab_registered_replace_finish',{p_student:student,p_request:f.receipt.id,p_file:reserved.file.id,p_hash:hash})).duplicate,true);
  // Прежний файл уже заменён: второй замены той же редакции нет.
  assert.equal((await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'v3.docx',p_type:DOCX,p_size:10,p_hash:'d'.repeat(64)})).conflict,true);
  const rows=(await f.db.query('select id,supersedes from studkab_request_attachments order by created_at')).rows;assert.equal(rows.length,2);
  // Новый файл ещё не прочитан: разбор не запускается и не тратит деньги.
  assert.equal(await f.enqueue(),null);assert.equal((await f.state()).state,'reading_blocked');
  await readFile(f,reserved.file.id,hash,'Тема: Менеджмент. Объём 40 страниц. Исходные данные не приложены.');
  const src=await f.source();assert.deepEqual(src.files.map(x=>x.id),[reserved.file.id]);
  const calls=f.calls;assert.equal((await f.enqueue()).status,'registered_analysis_queued');
  assert.equal((await runIntake({rpc:f.rpc,provider:f.provider})).status,'intake_done');assert.equal(f.calls,calls+2);
  const after=await f.state();assert.equal(after.state,'done');assert.notEqual(after.manifest,before.manifest);assert.notEqual(after.analysisId,before.analysisId);
 }finally{await f.db.close();}
});
test('KIT-03: после начала подготовки замена закрыта; открытое дополнение снова её разрешает',async()=>{
 const f=await fixture();try{
  await f.mutate("insert into studkab_gen_jobs(request_id) values('"+f.receipt.id+"')");
  const locked=await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'v2.docx',p_type:DOCX,p_size:10,p_hash:'e'.repeat(64)});
  assert.equal(locked.locked,true);
  await f.mutate("delete from studkab_gen_jobs;insert into studkab_material_revisions(id,request_id,closed_at) values(gen_random_uuid(),'"+f.receipt.id+"',now())");
  assert.equal((await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'v2.docx',p_type:DOCX,p_size:10,p_hash:'e'.repeat(64)})).locked,true);
  const cycle='11111111-2222-4333-8444-555555555555';
  await f.mutate("insert into studkab_material_revisions(id,request_id,closed_at) values('"+cycle+"','"+f.receipt.id+"',null)");
  const reserved=await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'v2.docx',p_type:DOCX,p_size:10,p_hash:'e'.repeat(64)});
  const done=await f.rpc('studkab_registered_replace_finish',{p_student:student,p_request:f.receipt.id,p_file:reserved.file.id,p_hash:'e'.repeat(64)});
  assert.equal((await f.db.query('select material_revision_id from studkab_request_attachments where id=$1',[done.attachment.id])).rows[0].material_revision_id,cycle);
  // Прямая вставка чужого файла в обход функции отклоняется прежней защитой.
  await assert.rejects(()=>f.db.query("insert into studkab_request_attachments(id,request_id,student_id,intake_file_id,category,supersedes,file_name,content_type,size_bytes,file_hash,storage_path) select gen_random_uuid(),request_id,student_id,intake_file_id,'unclassified',id,file_name,content_type,size_bytes,file_hash,storage_path from studkab_request_attachments where id=$1",[done.attachment.id]));
 }finally{await f.db.close();}
});

// KIT-06: пошаговая проверка checklist-3 в разборе настоящих заявок.
function checklistProvider(mode={}){
 const seen=[];
 const fn=async({spec,input})=>{
  seen.push({kind:spec.kind,system:input?.system,prompt:spec.prompt});
  const id=t=>spec.blocks.find(b=>b.text.includes(t)).blockId;
  if(spec.kind==='kit_extraction')return {complete:true,text:JSON.stringify({fields:[{field:'topic',value:'Менеджмент',ids:[id('Менеджмент')]}],requirements:[],roles:[]})};
  if(spec.kind==='checklist_inventory')return {complete:true,text:JSON.stringify({needs:[{need:'Тема, согласованная преподавателем',required_ids:[id('Менеджмент')],found_ids:[],status:'absent',question:'Какая тема согласована преподавателем?'}],params:[{kind:'volume',value:'25 страниц',ids:[id('Объём')]}]})};
  const p=JSON.parse(spec.prompt),returned=p.returned||[],answers=p.answers||[];
  const answerBlock=spec.blocks.find(b=>b.source?.questionId)?.blockId;
  const x={checks:[{n:0,status:answers.length&&mode.answer==='sufficient'?'found':'absent',ids:answers.length&&mode.answer==='sufficient'?[answerBlock]:[],returnedProposalId:returned[0]?.proposalId||null}],
   answerReviews:answers.map(a=>({questionId:a.id,status:mode.answer||'sufficient',reason:mode.answer==='insufficient'?'Ответ не называет тему из документов.':'Ответ называет тему, указанную в задании.',ids:[answerBlock],question:mode.answer==='insufficient'?'Назовите тему точно так, как она указана в задании.':''})),
   returnedReviews:returned.map(r=>({proposalId:r.proposalId,status:mode.returned||'resolved',reason:'Вопрос снят: в задании указана одна тема, вторая относится к примеру в методичке.',ids:[id('Менеджмент')]}))};
  return {complete:true,text:JSON.stringify(x)};
 };
 fn.seen=seen;return fn;
}
const enqueueList=f=>queueRegisteredAnalysis({rpc:f.rpc,method:'checklist-3'});
test('KIT-06: checklist-3 — three parts of one method, deferred conclusion, private proposal; resolved return removes the false question',async()=>{
 const f=await fixture();try{
  assert.equal((await enqueueList(f)).status,'registered_analysis_queued');
  const job=(await f.db.query('select plan from studkab_intake_analysis_jobs order by created_at desc limit 1')).rows[0].plan;
  assert.deepEqual(job.map(p=>[p.method,p.kind,!!p.deferred]),[['checklist-3','kit_extraction',false],['checklist-3','checklist_inventory',false],['checklist-3','kit_review',true]]);
  assert.equal(job[2].prompt,undefined);
  const provider=checklistProvider();
  assert.equal((await runIntake({rpc:f.rpc,provider})).status,'intake_done');
  assert.deepEqual(provider.seen.map(s=>s.kind),['kit_extraction','checklist_inventory','kit_review']);
  assert.match(provider.seen[2].prompt,/Тема, согласованная преподавателем/);
  const r=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});
  assert.equal(r.proposals.length,1);assert.equal(r.proposals[0].state,'pending');assert.equal(r.proposals[0].question,'Какая тема согласована преподавателем?');
  const q=r.proposals[0];
  assert.equal((await decide(f,q,'return','Вопрос лишний: в задании указана одна тема, вторая — пример из методички.')).state,'returned');
  assert.equal((await enqueueList(f)).status,'registered_analysis_queued');
  const again=checklistProvider();assert.equal((await runIntake({rpc:f.rpc,provider:again})).status,'intake_done');
  const sent=JSON.parse(again.seen[2].prompt);assert.equal(sent.returned[0].question,'Какая тема согласована преподавателем?');assert.match(sent.returned[0].comment,/Вопрос лишний/);
  const after=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});
  assert.equal(after.proposals.length,1);assert.match(after.proposals[0].restudy_reason,/Вопрос снят/);
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('KIT-06: checklist-3 — unresolved return keeps a new private question; insufficient answer gives a follow-up, sufficient answer closes it',async()=>{
 const f=await fixture();try{
  await enqueueList(f);await runIntake({rpc:f.rpc,provider:checklistProvider()});
  let q=(await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id})).proposals[0];
  await decide(f,q,'return','Проверьте ещё раз обе темы в оригиналах.');await enqueueList(f);
  await runIntake({rpc:f.rpc,provider:checklistProvider({returned:'unresolved'})});
  let r=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});
  assert.equal(r.proposals.length,2);assert.equal(r.proposals[1].state,'pending');assert.match(r.proposals[0].restudy_reason,/остаётся существенным/);
  q=r.proposals[1];await decide(f,q,'publish',q.question);
  await f.rpc('studkab_clarification_answer',{p_request:f.receipt.id,p_actor:student,p_id:q.id,p_answer:'Не знаю',p_source:'Сам'});
  await enqueueList(f);await runIntake({rpc:f.rpc,provider:checklistProvider({answer:'insufficient',returned:'unresolved'})});
  r=await f.rpc('studkab_registered_questions_refresh',{p_request:f.receipt.id});
  assert.ok(r.proposals.some(p=>p.state==='pending'&&p.question==='Назовите тему точно так, как она указана в задании.'));
  assert.ok(r.proposals.some(p=>/Ответ недостаточен/.test(p.restudy_reason||'')));
 }finally{await f.db.close();}
});
test('KIT-06: a saved plan cannot be altered; a tampered checklist part fails the check before any paid call',async()=>{
 const f=await fixture();try{
  await enqueueList(f);
  await assert.rejects(()=>f.mutate("update studkab_intake_analysis_jobs set plan=jsonb_set(plan,'{1,prompt}',to_jsonb('x'::text))"),/IMMUTABLE_INTAKE_ANALYSIS/);
  const {checklistPlan,validChecklistPart}=await import('../supabase/functions/_shared/checklist-review.mjs');
  const plan=checklistPlan(await f.source(),[]);
  assert.deepEqual(plan.map((p,i)=>validChecklistPart(p,i,3)),[true,true,true]);
  assert.equal(validChecklistPart({...plan[1],prompt:plan[1].prompt.replace('Менеджмент','Финансы')},1,3),false);
  assert.equal(validChecklistPart({...plan[2],max_cost_microusd:plan[2].max_cost_microusd+1},2,3),false);
  assert.equal(validChecklistPart({...plan[2],prompt:'{}'},2,3),false);
 }finally{await f.db.close();}
});

test('UX-01: замена называет точную причину отказа: тот же файл, дубликат или уже заменённая редакция',async()=>{
 const f=await fixture();try{
  // Тот же файл на своём месте — замена не нужна.
  assert.deepEqual(await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'Assignment.docx',p_type:DOCX,p_size:100,p_hash:'a'.repeat(64)}),{same:true});
  const hash='b'.repeat(64);
  const reserved=await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'v2.docx',p_type:DOCX,p_size:120,p_hash:hash});
  await f.rpc('studkab_registered_replace_finish',{p_student:student,p_request:f.receipt.id,p_file:reserved.file.id,p_hash:hash});
  // Старая строка списка: редакция уже заменена.
  const stale=await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:f.file.id,p_name:'v3.docx',p_type:DOCX,p_size:10,p_hash:'d'.repeat(64)});
  assert.equal(stale.conflict,true);assert.equal(stale.kind,'replaced');
  // Новая редакция, выбранная ещё раз, — тот же файл.
  assert.deepEqual(await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:reserved.file.id,p_name:'v2.docx',p_type:DOCX,p_size:120,p_hash:hash}),{same:true});
  // Прежняя редакция, загруженная вместо новой, — уже есть в истории заявки.
  const dup=await f.rpc('studkab_registered_replace_reserve',{p_student:student,p_request:f.receipt.id,p_attachment:reserved.file.id,p_name:'Assignment.docx',p_type:DOCX,p_size:100,p_hash:'a'.repeat(64)});
  assert.equal(dup.conflict,true);assert.equal(dup.kind,'duplicate');
  const rows=(await f.db.query('select id from studkab_request_attachments')).rows;assert.equal(rows.length,2);
 }finally{await f.db.close();}
});
test('UX-01: плановый вызов видит ожидающее чтение и разрешённое изучение, но не выключенный разбор',async()=>{
 const f=await fixture({ready:false});try{
  const pending=async()=>(await f.db.query('select public.studkab_intake_work_pending() p')).rows[0].p;
  assert.equal(await pending(),true);
  await f.reading();
  // Чтение завершено, разбор разрешён и не начат — вызов нужен.
  assert.equal(await pending(),true);
  assert.equal((await f.enqueue()).status,'registered_analysis_queued');assert.equal(await pending(),true);
  assert.equal((await runIntake({rpc:f.rpc,provider:f.provider})).status,'intake_done');
  // Всё изучено — вызывать нечего.
  assert.equal(await pending(),false);
  await f.mutate('update studkab_intake_analysis_policy set enabled=false');assert.equal(await pending(),false);
  // Права: вызов только для service_role.
  await f.db.exec('reset role');await f.db.exec('set role authenticated');await assert.rejects(()=>f.db.query('select public.studkab_intake_work_pending()'),/permission denied/);await f.db.exec('reset role');
 }finally{await f.db.close();}
});
