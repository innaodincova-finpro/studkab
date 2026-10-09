import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {setupAssistantBudgetFixture} from './assistant-budget-fixture.mjs';
import {assistantAction} from '../supabase/functions/studkab-requests/assistant-service.mjs';
import {sourceAssistantPlan} from '../supabase/functions/studkab-requests/assistant-source-plan.mjs';
import {runAssistant} from '../supabase/functions/studkab-generation/assistant-runner.mjs';
const actor=randomUUID(),student=randomUUID(),other=randomUUID(),user={id:actor,email:'executor@offline.test'};let db;
before(async()=>{db=new PGlite();await setupAssistantBudgetFixture(db,{actor,student,other});await db.exec("reset role; update studkab_gen_budget set limit_microusd=10000000,reserved_microusd=0; set role service_role");});after(async()=>db?.close());
const rpc=async(n,args)=>(await db.query('select public.'+n+'('+Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')+') value',Object.values(args))).rows[0].value;
test('real R3 source plan, concrete paid quote, confirmed queue, shared reserve, proxy correlation, Word return and recovery',async()=>{
 const id=randomUUID();await db.query('insert into studkab_requests(id,student_id,payload) values($1,$2,$3)',[id,student,{route:'r3',n:'Student',u:'University',k:'Практическая',d:'Право',rq:'Вопросы для ответа:\n1. Объясните правило\n2. Решите задачу'}]);
 const input={id,provider:'deepseek',operation:randomUUID()};let writes=0,fetches=0,failStorage=true;
 const deps={rpc,config:async()=>({executor_email:user.email}),loadRequestFile:async()=>{},readFile:async()=>{},sourcePlan:i=>sourceAssistantPlan(i,{readFile:async()=>{}}),capability:async()=>({available:true})};
 const pre=await assistantAction({...input,action:'assistant-preflight'},user,deps);
 assert.equal(pre.status,undefined,JSON.stringify(pre.data));assert.ok(pre.data.quoteId);assert.ok(pre.data.priceMicrousd>0);assert.equal(pre.data.requiresConfirmation,true);
 const repeat=await assistantAction({...input,action:'assistant-preflight'},user,deps);assert.equal(repeat.data.quoteId,pre.data.quoteId);assert.equal(repeat.data.priceMicrousd,pre.data.priceMicrousd);
 assert.equal((await rpc('studkab_assistant_state',{p_request:id,p_actor:actor})).job.state,'prepared');
 assert.equal((await assistantAction({...input,action:'assistant-start'},user,deps)).data.error,'PAID_CONFIRMATION_REQUIRED');
 const start=await assistantAction({...input,action:'assistant-start',quoteId:pre.data.quoteId,confirmedMicrousd:pre.data.priceMicrousd,confirmed:true},user,deps);assert.equal(start.data.queued,true);
 const runner={actor,rpc,proxyToken:'offline',loadRequestFile:async()=>{},readFile:async()=>{},saveResult:async()=>{writes++;if(failStorage)throw Error('offline storage unavailable')},fetchProxy:async(url,opts)=>{fetches++;const q=JSON.parse(opts.body);const p=JSON.parse(q.user);return Response.json({complete:true,client_request_id:q.client_request_id,detail:{reason:'stop'},text:JSON.stringify({sections:p.expectedSections.map(id=>({id,name:'Ответ',text:'Полный ответ по заданию'}))})})}};
 const result=await runAssistant(runner);assert.equal(result.status,'assistant_return_pending');assert.equal(fetches,1);
 failStorage=false;const recovery=await runAssistant({...runner,recoveryOnly:true,proxyToken:undefined});assert.equal(recovery.status,'assistant_returned');assert.equal(fetches,1);assert.equal(writes,2);
 const state=await rpc('studkab_assistant_state',{p_request:id,p_actor:actor});assert.equal(state.job.state,'returned');assert.ok(state.work.result.hash);
 const b=(await db.query('select reserved_microusd from studkab_gen_budget where id')).rows[0];assert.equal(Number(b.reserved_microusd),pre.data.priceMicrousd);
});

for(const provider of ['claude','chatgpt'])test(provider+' exact quote, confirmed API queue, immutable tariff and one Word return with unpaid recovery',async()=>{
 const id=randomUUID();await db.query('insert into studkab_requests(id,student_id,payload) values($1,$2,$3)',[id,student,{route:'r3',n:'Student',u:'University',k:'Практическая',d:'Право',rq:'Вопросы для ответа:\n1. Объясните правило'}]);
 const input={id,provider,operation:randomUUID()},config={provider,key:'offline',model:'offline-model',inputMicrousdPerMillion:100000,outputMicrousdPerMillion:200000,maxOutputTokens:1000,maxInputBytes:180000,priceVersion:'offline-only',validUntil:'2027-01-01T00:00:00Z'};
 const deps={rpc,config:async()=>({executor_email:user.email}),loadRequestFile:async()=>{},readFile:async()=>{},sourcePlan:i=>sourceAssistantPlan(i,{readFile:async()=>{}}),capability:async()=>({available:true}),providerConfig:()=>config};
 const pre=await assistantAction({...input,action:'assistant-preflight'},user,deps);assert.equal(pre.status,undefined,JSON.stringify(pre.data));
 const confirmed={...input,action:'assistant-start',quoteId:pre.data.quoteId,confirmedMicrousd:pre.data.priceMicrousd,confirmed:true};
 config.priceVersion='changed';assert.equal((await assistantAction(confirmed,user,deps)).data.error,'QUOTE_PRICE_CHANGED');
 assert.equal((await rpc('studkab_assistant_state',{p_request:id,p_actor:actor})).job.state,'prepared');config.priceVersion='offline-only';
 assert.equal((await assistantAction(confirmed,user,deps)).data.queued,true);assert.equal((await assistantAction(confirmed,user,deps)).data.duplicate,true);
 let calls=0,failStorage=true;const runner={actor,rpc,providers:[provider],providerConfigs:{[provider]:config},loadRequestFile:async()=>{},readFile:async()=>{},saveResult:async()=>{if(failStorage)throw Error('offline storage');},fetchProvider:async(u,o)=>{calls++;const body=JSON.parse(o.body),prompt=JSON.parse(provider==='chatgpt'?body.input:body.messages[0].content),text=JSON.stringify({sections:prompt.expectedSections.map(id=>({id,name:'Ответ',text:'Полное решение'}))});return Response.json(provider==='chatgpt'?{id:'resp_offline',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}]}:{id:'msg_offline',type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text}]});}};
 const stored=await rpc('studkab_assistant_state',{p_request:id,p_actor:actor});
 const held=await rpc('studkab_assistant_claim_next',{p_actor:actor,p_providers:[provider]});
 await assert.rejects(rpc('studkab_assistant_reserve_dispatch',{p_job:held.jobId,p_actor:actor,p_claim:held.claim,p_estimated:pre.data.priceMicrousd,p_model:'substitute',p_pricing_fingerprint:'0'.repeat(64)}),/PAID_CONFIRMATION_REQUIRED/);
 await rpc('studkab_assistant_fail_claim',{p_job:held.jobId,p_actor:actor,p_claim:held.claim});
 await rpc('studkab_assistant_confirm_queue',{p_job:stored.job.id,p_actor:actor,p_quote:pre.data.quoteId,p_confirmed_microusd:pre.data.priceMicrousd});
 // Fail-claim returns prepared, so queue explicitly through the internal fixture route.
 await rpc('studkab_assistant_queue',{p_job:stored.job.id,p_actor:actor});
 assert.equal((await runAssistant(runner)).status,'assistant_return_pending');assert.equal(calls,1);failStorage=false;
 assert.equal((await runAssistant({...runner,recoveryOnly:true,providerConfigs:{}})).status,'assistant_returned');assert.equal(calls,1);
 const state=await rpc('studkab_assistant_state',{p_request:id,p_actor:actor});assert.equal(state.job.state,'returned');assert.ok(state.work.result.hash);
 const attempt=(await db.query('select provider,model,pricing_fingerprint,state,reservation_microusd from studkab_assistant_attempts where job_id=$1',[state.job.id])).rows[0];assert.equal(attempt.provider,provider);assert.equal(attempt.model,config.model);assert.equal(attempt.state,'done');assert.equal(attempt.reservation_microusd,pre.data.priceMicrousd);assert.match(attempt.pricing_fingerprint,/^[a-f0-9]{64}$/);
 const lostId=randomUUID();await db.query('insert into studkab_requests(id,student_id,payload) values($1,$2,$3)',[lostId,student,{route:'r3',n:'Student',u:'University',k:'Практическая',d:'Право',rq:'Вопросы для ответа:\n1. Объясните правило'}]);
 const lostInput={id:lostId,provider,operation:randomUUID()},lostQuote=await assistantAction({...lostInput,action:'assistant-preflight'},user,deps);
 assert.equal((await assistantAction({...lostInput,action:'assistant-start',quoteId:lostQuote.data.quoteId,confirmedMicrousd:lostQuote.data.priceMicrousd,confirmed:true},user,deps)).data.queued,true);
 const lostRunner={...runner,fetchProvider:async()=>{calls++;throw Error('offline lost response');}};
 assert.equal((await runAssistant(lostRunner)).status,'assistant_unknown');assert.equal(calls,2);assert.equal(await runAssistant(lostRunner),null);assert.equal(calls,2);
 const lostState=await rpc('studkab_assistant_state',{p_request:lostId,p_actor:actor});assert.equal(lostState.job.state,'unknown');assert.equal((await db.query('select state from studkab_assistant_attempts where job_id=$1',[lostState.job.id])).rows[0].state,'unknown');

});
