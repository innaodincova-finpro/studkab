import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collectAssistantBundle} from '../supabase/functions/_shared/assistant-bundle.mjs';
import {runAssistant} from '../supabase/functions/studkab-generation/assistant-runner.mjs';
import {deepseekCapability} from '../supabase/functions/studkab-requests/assistant-service.mjs';
const actor=randomUUID(),jobId=randomUUID(),claim=randomUUID(),id=randomUUID(),dispatchId=randomUUID();
async function setup(){
 const payload={route:'r3',n:'Student',u:'University',k:'Практическая',d:'Право',rq:'Задания:\n1. Ответ'};
 const bundle=await collectAssistantBundle({request:{id,revision:1,payload,ready_at:'now'},provider:'deepseek',attachments:[],attachmentsComplete:true,context:{payload,passports:[],answers:[],materialRevisions:[]}},{loadRequestFile:async()=>{}});
 const claimed={allowed:true,jobId,claim,snapshot:bundle,basis:{attachments:[]},expectedSections:['answer']};
 const calls=[];let response;let recovery=false;
 const rpc=async(name,args)=>{
  calls.push(name);
  if(name==='studkab_assistant_claim_next')return recovery?{allowed:false,recovery:true,jobId}:claimed;
  if(name==='studkab_assistant_reserve_dispatch')return {ok:true,dispatchId,reservedMicrousd:args.p_estimated};
  if(name==='studkab_assistant_complete'){response=args.p_response;return {ok:true};}
  if(name==='studkab_assistant_return_snapshot')return {snapshot:bundle,response};
  if(name==='studkab_assistant_begin_return')return {allowed:true,claim,expectedSections:['answer']};
  return {ok:true};
 };
 return {calls,deps:{actor,rpc,proxyToken:'test-only',readFile:async()=>{},loadRequestFile:async()=>{},saveResult:async()=>{},fetchProxy:async(url,opts)=>{const b=JSON.parse(opts.body);assert.equal(b.client_request_id,dispatchId);return Response.json({complete:true,client_request_id:dispatchId,detail:{reason:'stop'},text:JSON.stringify({sections:[{id:'answer',name:'Ответ',text:'Полный ответ'}]})})}},recover:()=>{recovery=true}};
}
test('runner binds actual reserve, complete response and atomic Word return; recovery is unpaid',async()=>{
 const s=await setup();assert.equal((await runAssistant(s.deps)).status,'assistant_returned');
 assert.ok(s.calls.indexOf('studkab_assistant_reserve_dispatch')<s.calls.indexOf('studkab_assistant_complete'));
 s.recover();s.deps.fetchProxy=async()=>{throw Error('Must not infer again')};assert.equal((await runAssistant(s.deps)).status,'assistant_returned');
});
test('lost provider response is unknown, retained reservation never retries or returns a file',async()=>{
 const s=await setup();s.deps.fetchProxy=async()=>{throw Error('Lost reply')};assert.equal((await runAssistant(s.deps)).status,'assistant_unknown');
 assert.ok(s.calls.includes('studkab_assistant_unknown'));assert.ok(!s.calls.includes('studkab_assistant_complete'));
});
test('budget refusal and uncertain reserve never call model; numerical capability reflects budget',async()=>{
 const s=await setup(),old=s.deps.rpc;s.deps.rpc=(n,a)=>n==='studkab_assistant_reserve_dispatch'?{ok:false,reason:'budget'}:old(n,a);
 s.deps.fetchProxy=async()=>{throw Error('Must not pay')};assert.equal((await runAssistant(s.deps)).status,'assistant_blocked');
 let probes=0;assert.deepEqual(await deepseekCapability(actor,{rpc:async()=>({budgetAvailable:false}),enabled:true,configured:true,probe:async()=>{probes++;return {verified:true}}}),{available:false,reason:'budget_exhausted'});assert.equal(probes,0);
 assert.deepEqual(await deepseekCapability(actor,{rpc:async()=>({budgetAvailable:true}),enabled:true,configured:true,probe:async()=>({verified:true})}),{available:true,reason:'ready'});
});
