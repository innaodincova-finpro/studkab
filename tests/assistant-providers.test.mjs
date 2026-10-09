import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantProviders} from '../supabase/functions/_shared/assistant-providers.mjs';
const policy={model:'offline-model',inputMicrousdPerMillion:100000,outputMicrousdPerMillion:200000,maxOutputTokens:1000,maxInputBytes:180000,priceApproved:true,priceVersion:'offline-only',validUntil:'2027-01-01T00:00:00Z'};
test('missing config, disabled flags and exhausted budget never probe or expose keys',async()=>{
 let calls=0;const empty=createAssistantProviders({get:()=>undefined,rpc:async()=>({budgetAvailable:true}),fetchProvider:async()=>calls++});assert.deepEqual(await empty.ready('actor'),{providers:[],providerConfigs:{}});assert.equal(calls,0);
 const env={STUDKAB_GENERATION_ENABLED:'true',STUDKAB_ASSISTANT_OPENAI_ENABLED:'true',STUDKAB_ASSISTANT_OPENAI_CONFIG:JSON.stringify(policy),OPENAI_API_KEY:'synthetic'};
 const exhausted=createAssistantProviders({get:k=>env[k],rpc:async()=>({budgetAvailable:false}),fetchProvider:async()=>calls++});assert.equal((await exhausted.capability('actor','chatgpt')).available,false);assert.equal(calls,0);
 const configured=createAssistantProviders({get:k=>env[k],rpc:async()=>({budgetAvailable:true}),fetchProvider:async()=>Response.json({id:'offline-model'})});assert.deepEqual(await configured.capability('actor','chatgpt'),{available:true,reason:'ready'});assert.equal(JSON.stringify(await configured.capability('actor','chatgpt')).includes('synthetic'),false);assert.equal((await configured.capability('actor','claude')).available,false);
});
