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
async function baseFixture({enabled=true,ready=true,kitText=text}={}){
 const db=new PGlite();await db.exec(schema()+submissionExtension()+read('20261001162253_route02_receive_before_analysis.sql')+read('20261001175519_route02_registered_reading.sql'));
 await db.exec(`alter table auth.users add column email text;update auth.users set email='${email}' where id='${other}';grant select(id,email) on auth.users to service_role;update studkab_request_config set executor_email='${email}';`);
 const rpc=async(name,args={})=>{assert.match(name,/^studkab_[a-z_]+$/);return (await db.query('select '+name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r;};
 await db.exec('set role service_role');const api=apiDatabase(db),draft=await rpc('studkab_intake_open',{p_student:student});
 const {file}=await rpc('studkab_intake_reserve',{p_student:student,p_draft:draft.id,p_name:'Assignment.docx',p_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',p_size:100,p_hash:'a'.repeat(64),p_supersedes:null});
 await rpc('studkab_intake_finish',{p_student:student,p_draft:draft.id,p_file:file.id,p_hash:file.file_hash});
 const legacy=await rpc('studkab_intake_analysis_source',{p_draft:draft.id});
 await db.exec('reset role');await db.exec(migration+read('20260921165603_c084_requirement_clarifications.sql')+read('20260926114639_c120_dialog_events.sql')+read('20261002015751_route02_private_questions.sql')+read('20261002020616_route02_reviewed_classification.sql')+read('20261002031300_route02_kit_review.sql'));await db.exec('revoke update on studkab_request_attachments from service_role;grant update(category,extracted_text) on studkab_request_attachments to service_role');if(enabled)await db.exec('update studkab_intake_analysis_policy set enabled=true,limit_microusd=10000000;update studkab_gen_budget set limit_microusd=10000000');await db.exec('set role service_role');
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

async function fixture(){const f=await baseFixture();await f.mutate(fs.readFileSync(new URL('../telegram-setup.sql',import.meta.url),'utf8')+read('20261002052253_route02_private_dialog.sql')+read('20261002150000_route02_kit_whole.sql')+read('20261003100000_route02_intake_ledger_access.sql')+read('20261003130000_route02_registered_replace.sql')+read('20261003230000_route02_checklist_live.sql')+';revoke all on studkab_gen_reconciliations from service_role;');await f.mutate("insert into studkab_telegram_setup(setup_hash,owner_hash,expires_at,installed,owner_chat_id) values('"+'a'.repeat(64)+"','"+'b'.repeat(64)+"',now()+interval '1 day',true,100)");return f;}
const manifest=async f=>(await f.rpc('studkab_private_dialog_read',{p_request:f.receipt.id,p_actor:other})).manifest;
const send=(f,key,body,manifest,actor=other)=>f.rpc('studkab_private_dialog_send',{p_request:f.receipt.id,p_actor:actor,p_key:key,p_body:body,p_manifest:manifest,p_channel:'web'});
const action=(f,mode,extra={},chat=100)=>f.rpc('studkab_telegram_registered_action',{p_chat:chat,p_action:mode,p_request:null,p_proposal:null,p_text:null,p_key:null,p_reply:null,...extra});
test('private guidance persists once, invalidates the source and produces one source-bound private reply',async()=>{
 const f=await fixture();try{
  await f.enqueue();await runIntake({rpc:f.rpc,provider:f.provider});const before=await f.state();
  const body='Проверьте применимость вариантов темы по заданию.';
  assert.equal((await send(f,'web:one',body,before.manifest)).ok,true);
  assert.equal((await send(f,'web:one',body,before.manifest)).duplicate,true);
  assert.equal((await send(f,'web:one','Изменённый текст',before.manifest)).conflict,true);
  assert.equal((await f.state()).state,'awaiting_analysis');const src=await f.source();assert.equal(src.reviewInstructions[0].comment,body);
  const plan=registeredAnalysisPlan(src);assert.ok(plan.at(-1).prompt.includes(body));assert.ok(!plan.at(-1).blocks.some(b=>b.text.includes(body)));
  assert.equal((await send(f,'web:two',body,before.manifest)).stale,true);
  await f.enqueue();await runIntake({rpc:f.rpc,provider:f.provider});
  const current=await manifest(f);
  const first=await f.rpc('studkab_private_dialog_read',{p_request:f.receipt.id,p_actor:other});
  const again=await f.rpc('studkab_private_dialog_read',{p_request:f.receipt.id,p_actor:other});
  assert.equal(first.dialog.length,2);assert.equal(again.dialog.length,2);assert.equal(first.dialog[1].kind,'assistant');assert.equal(first.dialog[1].evidence.version,REVIEW_VERSION);
  assert.equal(await manifest(f),current);assert.equal((await f.db.query('select count(*) n from studkab_dialog_events')).rows[0].n,0);
  for(const actor of [student])await assert.rejects(()=>send(f,'bad',body,current,actor),/FORBIDDEN/);
  for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(()=>f.db.query('select * from studkab_private_dialog'),/permission denied/);await assert.rejects(()=>f.rpc('studkab_private_dialog_read',{p_request:f.receipt.id,p_actor:other}),/permission denied/);}
 }finally{await f.db.close();}
});
test('Telegram and web share exact immutable decisions; foreign chats and stale proposal cannot publish',async()=>{
 const f=await fixture();try{
  await f.enqueue();await runIntake({rpc:f.rpc,provider:async c=>{const r=await f.provider(c),x=JSON.parse(r.text);if(c.spec.kind==='kit_review')x.gaps=[{key:'topic',question:'Какая тема применима?',reason:'Оригинал содержит два варианта.',refs:[{blockId:c.spec.blocks[0].blockId,quote:'Тема: Менеджмент. Тема: Финансы.'}]}];return {...r,text:JSON.stringify(x)};}});
  const study=await action(f,'study',{p_request:f.receipt.id});const q=study.proposals[0];assert.equal(study.requestId,f.receipt.id);
  await assert.rejects(()=>action(f,'publish',{p_proposal:q.id},101),/FORBIDDEN/);
  const edited='Уточните тему, согласованную с преподавателем.';
  const result=await f.rpc('studkab_registered_question_decide',{p_request:f.receipt.id,p_actor:other,p_proposal:q.id,p_decision:'publish',p_text:edited});assert.equal(result.published_text,edited);
  assert.equal((await f.rpc('studkab_registered_question_decide',{p_request:f.receipt.id,p_actor:other,p_proposal:q.id,p_decision:'publish',p_text:edited})).duplicate,true);
  const originalRetry=await action(f,'publish',{p_proposal:q.id});assert.equal(originalRetry.conflict,true);assert.equal(originalRetry.ok,false);
  assert.equal((await f.db.query('select published_text from studkab_question_proposals where id=$1',[q.id])).rows[0].published_text,edited);
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,1);
  assert.equal((await f.db.query("select count(*) n from studkab_dialog_events where kind='question'")).rows[0].n,1);
 }finally{await f.db.close();}
});
test('Telegram reply context binds chat, message, request and source; retries do not send another message',async()=>{
 const f=await fixture();try{
  const s=await f.rpc('studkab_private_dialog_read',{p_request:f.receipt.id,p_actor:other});
  const ctx=await f.rpc('studkab_telegram_dialog_context_save',{p_chat:100,p_message:55,p_request:f.receipt.id,p_manifest:s.manifest,p_mode:'comment',p_proposal:null});assert.equal(ctx.saved,true);
  const data={p_reply:55,p_key:'telegram:1',p_text:'Проверьте обе темы в оригинальном задании.'};
  assert.equal((await action(f,'reply',data)).ok,true);assert.equal((await action(f,'reply',data)).duplicate,true);
  assert.equal((await action(f,'reply',{...data,p_key:'telegram:2'})).stale,true);
  assert.equal((await action(f,'reply',{...data,p_reply:56})).stale,true);
  await assert.rejects(()=>action(f,'reply',data,101),/FORBIDDEN/);
  await f.mutate("update studkab_telegram_dialog_context set expires_at=now()-interval '1 second'");assert.equal((await action(f,'reply',data)).stale,true);
  assert.equal((await f.db.query('select count(*) n from studkab_private_dialog')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('bounded private guidance refuses overflow without deleting history or invoking a provider',async()=>{
 const f=await fixture();try{for(let i=0;i<20;i++)assert.equal((await send(f,'web:'+i,'Комментарий '+i,await manifest(f))).ok,true);
  assert.equal((await send(f,'web:overflow','Другой комментарий',await manifest(f))).limited,true);
  assert.equal((await f.db.query('select count(*) n from studkab_private_dialog')).rows[0].n,20);assert.equal(f.calls,0);
  await assert.rejects(()=>f.db.query("update studkab_private_dialog set body='Изменено'"),/permission denied/);
 }finally{await f.db.close();}
});

import {handler as botHandler,webhookSecret,WEBHOOK} from '../supabase/functions/studkab-telegram/handler.mjs';
test('real SQL-backed bot flow: private reply, repeated update, edit/publish and return share web history',async()=>{
 for(const mode of ['edit','return']){const f=await fixture();try{
  await f.enqueue();const provider=async c=>{const r=await f.provider(c),x=JSON.parse(r.text);if(c.spec.kind==='kit_review')x.gaps=[{key:'topic',question:'Какая тема применима?',reason:'Есть две темы в задании.',refs:[{blockId:c.spec.blocks[0].blockId,quote:'Менеджмент'}],returnedProposalIds:c.spec.reviewInstructions.filter(x=>x.proposalId).map(x=>x.proposalId)}];return {...r,text:JSON.stringify(x)};};await runIntake({rpc:f.rpc,provider});
  const calls=[];let sequence=200;
  const db={get:async()=>({installed:true,owner_chat_id:100}),action:args=>f.rpc('studkab_telegram_registered_action',args),context:args=>f.rpc('studkab_telegram_dialog_context_save',args)};
  const app=botHandler({token:'test-only-token',db,telegram:async(method,payload)=>{calls.push({method,payload});return {message_id:sequence++};}});
  const secret=await webhookSecret('test-only-token');
  const invoke=body=>app(new Request(WEBHOOK,{method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:JSON.stringify(body)}));
  const msg=(text,extra={})=>({chat:{id:100,type:'private'},from:{id:100,is_bot:false},text,...extra});
  assert.equal((await invoke({update_id:1,message:msg('/study '+f.receipt.id)})).status,200);
  const ctx=(await f.db.query("select * from studkab_telegram_dialog_context where mode='comment'")).rows[0];assert.ok(ctx);
  const update={update_id:2,message:msg('Проверьте применимость обеих тем.',{reply_to_message:{message_id:Number(ctx.message_id),from:{is_bot:true,username:'Studkab_Requests_bot'}}})};
  assert.equal((await invoke(update)).status,200);assert.equal((await invoke(update)).status,200);assert.equal((await f.db.query("select count(*) n from studkab_private_dialog where kind='executor'")).rows[0].n,1);
  await f.enqueue();await runIntake({rpc:f.rpc,provider});const state=await f.rpc('studkab_private_dialog_read',{p_request:f.receipt.id,p_actor:other});const q=state.proposals.find(q=>q.analysis_id===state.analysisId);
  const cb={id:'callback-1',from:{id:100,is_bot:false},message:{chat:{id:100,type:'private'}},data:mode+':'+q.id};
  assert.equal((await invoke({update_id:3,callback_query:cb})).status,200);
  const reply=(await f.db.query('select * from studkab_telegram_dialog_context where mode=$1',[mode])).rows[0];assert.ok(reply);
  const wording=mode==='edit'?'Уточните согласованную тему преподавателя.':'Перечитайте обе темы и применимость методички.';
  const answer={update_id:4,message:msg(wording,{reply_to_message:{message_id:Number(reply.message_id),from:{is_bot:true,username:'Studkab_Requests_bot'}}})};
  assert.equal((await invoke(answer)).status,200);assert.equal((await invoke(answer)).status,200);
  const saved=(await f.db.query('select * from studkab_question_proposals where id=$1',[q.id])).rows[0];assert.equal(saved.state,mode==='edit'?'published':'returned');assert.equal(mode==='edit'?saved.published_text:saved.return_comment,wording);
  assert.equal((await f.db.query('select count(*) n from studkab_clarifications')).rows[0].n,mode==='edit'?1:0);
  const count=calls.length;assert.equal((await invoke({update_id:5,callback_query:{...cb,from:{id:101,is_bot:false}}})).status,200);assert.equal(calls.length,count);
  await invoke({update_id:6,message:msg(undefined,{voice:{file_id:'never-downloaded',duration:20}})});assert.ok(calls.at(-1).payload.text.includes('Голос ещё не включён'));assert.ok(!calls.some(c=>c.method==='getFile'));
 }finally{await f.db.close();}}
});
