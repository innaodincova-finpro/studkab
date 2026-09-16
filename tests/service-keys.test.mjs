import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameSecret} from '../supabase/functions/_shared/secret-equal.mjs';
import {cronAllowed} from '../supabase/functions/studkab-push/access.mjs';
import {handler as requestsHandler} from '../supabase/functions/studkab-requests/handler.mjs';
import {handler as generationHandler} from '../supabase/functions/studkab-generation/handler.mjs';

const key='k'.repeat(40);
test('C-054: сравнение ключей принимает только точное совпадение',()=>{
 assert.equal(sameSecret(key,key),true);
 for(const wrong of ['',key.slice(0,39),key+'k','K'+key.slice(1),key.slice(0,39)+'x','ключ',null,undefined,42])
  assert.equal(sameSecret(wrong,key),false,String(wrong));
 assert.equal(sameSecret('',''),false,'пустой ключ в настройках не открывает доступ');
 assert.equal(sameSecret('x',undefined),false);
});
test('C-054: неверный ключ уведомлений не создаёт ключи подписи',async()=>{
 let reads=0;const read=async()=>{reads++;return key;};
 assert.equal(await cronAllowed(null,read),false);assert.equal(reads,0);
 assert.equal(await cronAllowed('',read),false);assert.equal(reads,0);
 assert.equal(await cronAllowed(key.slice(0,39)+'x',read),false);
 assert.equal(await cronAllowed(key,read),true);
 assert.equal(await cronAllowed(key,async()=>null),false);
});
test('C-054: служебный ключ заявок — только точное совпадение',async()=>{
 let claimed=0;
 const h=requestsHandler({config:async()=>({cron_token:key}),db:async(p)=>{if(p==='rpc/claim_studkab_requests'){claimed++;return [];}return null;},send:async()=>{},auth:async()=>null});
 for(const wrong of [key.slice(0,39),key+'k','x'.repeat(40)]){
  const r=await h(new Request('https://x.test',{method:'POST',headers:{'x-job-key':wrong}}));
  assert.equal(r.status,403);
 }
 assert.equal(claimed,0);
 const ok=await h(new Request('https://x.test',{method:'POST',headers:{'x-job-key':key}}));
 assert.equal(ok.status,200);assert.equal(claimed,1);
 const empty=requestsHandler({config:async()=>({cron_token:''}),db:async()=>{throw Error('no');},send:async()=>{},auth:async()=>null});
 assert.equal((await empty(new Request('https://x.test',{method:'POST',headers:{'x-job-key':'z'}}))).status,403);
});
test('C-054: служебный ключ подготовки — только точное совпадение',async()=>{
 const h=generationHandler({authorize:async()=>true,config:async()=>({cron_token:key}),rpc:async()=>{throw Error('must not claim');},readiness:()=>({enabled:true,providerConfigured:true})});
 for(const wrong of [key.slice(0,39),key+'k'])
  assert.equal((await h(new Request('https://x.test',{method:'POST',headers:{'X-Studkab-Runner':wrong}}))).status,401);
 const probe=await h(new Request('https://x.test',{method:'POST',headers:{'X-Studkab-Runner':key,'X-Studkab-Probe':'1'}}));
 assert.equal(probe.status,200);
});
