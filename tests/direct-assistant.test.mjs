import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collectAssistantBundle} from '../supabase/functions/_shared/assistant-bundle.mjs';
import {directAssistantConfig,prepareDirectAssistant,dispatchDirectAssistant,probeDirectAssistant} from '../supabase/functions/_shared/direct-assistant.mjs';
const job=randomUUID(),claim=randomUUID(),dispatchId=randomUUID();
export const policy={model:'offline-model',inputMicrousdPerMillion:100000,outputMicrousdPerMillion:200000,maxOutputTokens:1000,maxInputBytes:180000,priceApproved:true,priceVersion:'offline-only',validUntil:'2027-01-01T00:00:00Z'};
export function cfg(provider,patch={}){return {...policy,provider,key:'synthetic-not-a-key',...patch};}
async function bundle(provider){return collectAssistantBundle({provider,request:{id:randomUUID(),revision:1,ready_at:'now',payload:{route:'r3',n:'Offline Student',u:'Offline University',k:'Практическая',d:'Право',rq:'Полное задание'}},attachments:[],attachmentsComplete:true,context:{answers:[],passports:[],materialRevisions:[]}},{loadRequestFile:async()=>{}});}
export function result(provider,sections=[{id:'answer',name:'Ответ',text:'Полное решение'}]){const text=JSON.stringify({sections});return provider==='chatgpt'?{id:'resp_offline',status:'completed',error:null,incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}]}:{id:'msg_offline',type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text}]};}
test('configuration has no default model or tariff and never enables itself',()=>{
 for(const provider of ['claude','chatgpt']){
  const prefix=provider==='claude'?'STUDKAB_ASSISTANT_CLAUDE':'STUDKAB_ASSISTANT_OPENAI';const env={STUDKAB_GENERATION_ENABLED:'true',[prefix+'_ENABLED']:'true',[prefix+'_CONFIG']:JSON.stringify(policy),[provider==='claude'?'ANTHROPIC_API_KEY':'OPENAI_API_KEY']:'synthetic'};
  assert.ok(directAssistantConfig(provider,k=>env[k]));
  for(const change of [e=>delete e[prefix+'_ENABLED'],e=>e[prefix+'_CONFIG']='{}',e=>e[prefix+'_CONFIG']=JSON.stringify({...policy,priceApproved:false}),e=>e[prefix+'_CONFIG']=JSON.stringify({...policy,validUntil:'2020-01-01'}),e=>e[prefix+'_CONFIG']=JSON.stringify({...policy,inputMicrousdPerMillion:0}),e=>e[prefix+'_CONFIG']=JSON.stringify({...policy,model:'https://foreign'})]){const e={...env};change(e);assert.equal(directAssistantConfig(provider,k=>e[k]),null);}
 }
});
for(const provider of ['claude','chatgpt']){
 test(provider+' model probe sends no files or inference and requires exact model identity',async()=>{let observed;assert.equal((await probeDirectAssistant(cfg(provider),async(u,o)=>{observed=[u,o];return Response.json({id:'offline-model'});})).verified,true);assert.equal(observed[1].method,'GET');assert.equal(observed[1].body,undefined);assert.match(observed[0],/\/models\/offline-model$/);assert.equal((await probeDirectAssistant(cfg(provider),async()=>Response.json({id:'other'}))).verified,false);});
 test(provider+' prompt, tariff and model are frozen before one reserved dispatch',async()=>{
  const b=await bundle(provider),config=cfg(provider),p=await prepareDirectAssistant(b,['answer'],{config,readFile:async()=>{}});let paid=0,reserved=false;
  const out=await dispatchDirectAssistant(b,job,claim,['answer'],{config,readFile:async()=>{},reserveAndDispatch:async r=>{assert.equal(r.pricingFingerprint,p.pricingFingerprint);assert.equal(r.estimatedMicrousd,p.estimatedMicrousd);reserved=true;return {ok:true,dispatchId,reservedMicrousd:r.estimatedMicrousd};},fetchProvider:async(u,o)=>{assert.equal(reserved,true);paid++;assert.equal(o.redirect,'error');assert.match(u,provider==='claude'?/^https:\/\/api.anthropic.com\/v1\/messages$/:/^https:\/\/api.openai.com\/v1\/responses$/);assert.equal(JSON.parse(o.body).model,config.model);assert.equal(JSON.parse(o.body).service_tier,provider==='claude'?'standard_only':'default');return Response.json(result(provider));}});
  assert.equal(paid,1);assert.equal(out.dispatchId,dispatchId);assert.equal(out.provider,provider);const changed=await prepareDirectAssistant(b,['answer'],{config:cfg(provider,{priceVersion:'changed'}),readFile:async()=>{}});assert.notEqual(changed.pricingFingerprint,p.pricingFingerprint);
 });
 test(provider+' reserve refusal, exceeded per-call cap and lost response never retry',async()=>{
  const b=await bundle(provider),deps={config:cfg(provider),readFile:async()=>{},reserveAndDispatch:async()=>({ok:false})};let calls=0;
  await assert.rejects(dispatchDirectAssistant(b,job,claim,['answer'],{...deps,fetchProvider:async()=>calls++}),/BUDGET_NOT_CONFIRMED/);assert.equal(calls,0);
  await assert.rejects(prepareDirectAssistant(b,['answer'],{...deps,config:cfg(provider,{inputMicrousdPerMillion:1000000000})}),/RESERVE_LIMIT/);
  await assert.rejects(dispatchDirectAssistant(b,job,claim,['answer'],{...deps,reserveAndDispatch:async r=>({ok:true,dispatchId,reservedMicrousd:r.estimatedMicrousd}),fetchProvider:async()=>{calls++;throw Error('lost');}}),/lost/);assert.equal(calls,1);
 });
 test(provider+' refuses truncation, refusal, missing or wrong sections and oversized response',async()=>{
  const b=await bundle(provider),bad=[result(provider,[]),result(provider,[{id:'wrong',name:'Ответ',text:'Текст'}]),{...result(provider),...(provider==='claude'?{stop_reason:'max_tokens'}:{status:'incomplete'})},{...result(provider),...(provider==='claude'?{content:[{type:'text',text:'bad json'}]}:{output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'no'}]}]})}];
  for(const value of bad)await assert.rejects(dispatchDirectAssistant(b,job,claim,['answer'],{config:cfg(provider),readFile:async()=>{},reserveAndDispatch:async r=>({ok:true,dispatchId,reservedMicrousd:r.estimatedMicrousd}),fetchProvider:async()=>Response.json(value)}),/UNCONFIRMED_RESULT|INCOMPLETE_DOCUMENT/);
  await assert.rejects(dispatchDirectAssistant(b,job,claim,['answer'],{config:cfg(provider),readFile:async()=>{},reserveAndDispatch:async r=>({ok:true,dispatchId,reservedMicrousd:r.estimatedMicrousd}),fetchProvider:async()=>new Response('x'.repeat(2000001))}),/RESPONSE_TOO_BIG/);
 });
}
