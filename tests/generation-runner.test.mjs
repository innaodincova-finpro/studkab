import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../supabase/functions/studkab-generation/handler.mjs';
const claim={job_id:'job',ordinal:0,claim:'claim'};
function setup({fail,configured=true,result={complete:true,text:'saved'}}={}){
 const calls=[];let paid=0;
 const h=handler({authorize:async req=>req.headers.get('Authorization')==='Bearer test-service-only',config:async()=>({cron_token:'test-only'}),ready:()=>configured,
 rpc:async(name,args)=>{calls.push({name,args});if(name===fail)throw Error('network');
 if(name.endsWith('_claim'))return claim;if(name.endsWith('_dispatch'))return 'request';return 'done';},
 provider:async()=>{paid++;return result;}});
 const request=(token='test-only')=>h(new Request('https://internal',{method:'POST',headers:{'X-Studkab-Runner':token,Authorization:'Bearer test-service-only'}}));
 return {calls,request,paid:()=>paid};
}
test('unauthorized request cannot claim or send',async()=>{const s=setup();assert.equal((await s.request('wrong')).status,401);assert.equal(s.calls.length,0);});
test('missing configuration does not consume claim or budget',async()=>{const s=setup({configured:false});assert.equal((await s.request()).status,503);assert.equal(s.calls.length,0);});
test('dispatch reply lost: provider never called and no retry',async()=>{const s=setup({fail:'studkab_gen_dispatch'});const r=await(await s.request()).json();assert.equal(r.status,'dispatch_unconfirmed');assert.equal(s.paid(),0);assert.equal(s.calls.length,2);});
test('successful response saved against same claim and request',async()=>{const s=setup();await s.request();assert.equal(s.paid(),1);assert.equal(s.calls[2].args.p_request,'request');assert.equal(s.calls[2].args.p_text,'saved');});
test('incomplete response is not stored as finished',async()=>{const s=setup({result:{text:'partial',complete:false}});await s.request();assert.equal(s.calls[2].args.p_text,null);});
test('save reply lost: no second paid call',async()=>{const s=setup({fail:'studkab_gen_settle'});const r=await(await s.request()).json();assert.equal(r.status,'save_unconfirmed');assert.equal(s.paid(),1);assert.equal(s.calls.length,3);});
test('missing authorizer fails closed before reading server configuration',async()=>{
 let accessed=false;
 const h=handler({config:async()=>{accessed=true;},ready:()=>true});
 assert.equal((await h(new Request('https://internal',{method:'POST'}))).status,401);
 assert.equal(accessed,false);
});
test('ordinary user bearer cannot read configuration or claim work',async()=>{
 let accessed=false;
 const h=handler({authorize:async r=>r.headers.get('Authorization')==='Bearer service-only',
 config:async()=>{accessed=true;},ready:()=>true});
 const r=await h(new Request('https://internal',{method:'POST',headers:{Authorization:'Bearer user-token'}}));
 assert.equal(r.status,401);assert.equal(accessed,false);
});
test('authorization service error fails closed',async()=>{
 const h=handler({authorize:async()=>{throw Error('private detail');}});
 const r=await h(new Request('https://internal',{method:'POST'}));
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'AUTH_UNAVAILABLE'});
});
test('oversized UTF-8 result is unknown rather than an invalid database save',async()=>{
 const s=setup({result:{complete:true,text:'Я'.repeat(50001)}});await s.request();
 assert.equal(s.calls[2].args.p_text,null);assert.equal(s.paid(),1);
});
test('UTF-8 result at the database byte limit is saved',async()=>{
 const s=setup({result:{complete:true,text:'Я'.repeat(50000)}});await s.request();
 assert.equal(s.calls[2].args.p_text.length,50000);
});
test('budget refusal never invokes provider',async()=>{
 let paid=0;const calls=[];
 const h=handler({authorize:async()=>true,config:async()=>({cron_token:'test'}),ready:()=>true,
 rpc:async name=>{calls.push(name);return name.endsWith('_claim')?claim:null;},
 provider:async()=>{paid++;}});
 const r=await h(new Request('https://internal',{method:'POST',headers:{'X-Studkab-Runner':'test'}}));
 assert.equal((await r.json()).status,'budget');assert.equal(paid,0);assert.equal(calls.length,2);
});

import {machineAuthorization} from '../supabase/functions/studkab-generation/auth.mjs';
import {readFileSync} from 'node:fs';

test('runner relies on gateway JWT verification instead of an embedded or environment-copied project JWT',()=>{
 const source=readFileSync(new URL('../supabase/functions/studkab-generation/index.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/Deno\.env\.get\('SUPABASE_ANON_KEY'\)/);
 assert.doesNotMatch(source,/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
});
test('scheduler requires a bearer already validated by the Supabase gateway',()=>{
 const check=token=>machineAuthorization(new Request('https://internal',{headers:{Authorization:'Bearer '+token}}));
 assert.equal(check('project-test'),true);assert.equal(check('user-jwt'),true);assert.equal(check(''),false);
 assert.equal(machineAuthorization(new Request('https://internal'),{}),false);
});
test('public scheduler bearer without secret cron cannot access probe or claim',async()=>{
 let touched=false;
 const h=handler({authorize:r=>machineAuthorization(r),config:async()=>({cron_token:'secret-test'}),
 ready:()=>true,rpc:()=>{touched=true;}});
 const r=await h(new Request('https://internal',{method:'POST',headers:{Authorization:'Bearer public-test','X-Studkab-Probe':'1'}}));
 assert.equal(r.status,401);assert.equal(touched,false);
});
test('authorized readiness probe reports booleans without claiming or sending',async()=>{
 let touched=false;
 const h=handler({authorize:async()=>true,config:async()=>({cron_token:'secret-test'}),ready:()=>false,
 readiness:()=>({enabled:false,providerConfigured:false,secret:'must-not-return'}),rpc:()=>{touched=true;}});
 const r=await h(new Request('https://internal',{method:'POST',headers:{'X-Studkab-Runner':'secret-test','X-Studkab-Probe':'1'}}));
 assert.deepEqual(await r.json(),{enabled:false,providerConfigured:false});assert.equal(touched,false);
});

import {withContext} from '../supabase/functions/studkab-generation/context.mjs';
test('part context includes only preceding completed results without truncation',()=>{
 const c={ordinal:2,input:{system:'facts'},spec:{prompt:'continue'}};
 const result=withContext(c,[{ordinal:1,state:'done',result:'second'},{ordinal:0,state:'done',result:'first'},{ordinal:3,state:'done',result:'future'},{ordinal:1,state:'unknown',result:'uncertain'}]);
 assert.ok(result.spec.prompt.indexOf('first')<result.spec.prompt.indexOf('second'));
 assert.ok(!result.spec.prompt.includes('future'));assert.ok(!result.spec.prompt.includes('uncertain'));
 assert.equal(c.spec.prompt,'continue');
});
test('part context never copies completed text from another section',()=>{
 const c={ordinal:3,input:{system:'facts'},spec:{section_id:'chapter-2',prompt:'continue'}};
 const result=withContext(c,[
  {ordinal:0,state:'done',result:'other chapter',spec:{section_id:'chapter-1'}},
  {ordinal:1,state:'done',result:'same chapter',spec:{section_id:'chapter-2'}}
 ]);
 assert.match(result.spec.prompt,/same chapter/);
 assert.doesNotMatch(result.spec.prompt,/other chapter/);
});
test('oversized context stops before dispatch and provider',async()=>{
 let sent=0,blocked=0,reason;
 const h=handler({authorize:async()=>true,config:async()=>({cron_token:'test'}),ready:()=>true,
 rpc:async name=>{if(name!=='studkab_gen_claim')throw Error('MUST_NOT_DISPATCH');return claim;},
  prepare:async()=>{throw Error('CONTEXT_TOO_BIG');},failClaim:async(c,code)=>{blocked++;reason=code;},provider:async()=>{sent++;}});
 const r=await h(new Request('https://internal',{method:'POST',headers:{'X-Studkab-Runner':'test'}}));
 assert.equal(r.status,409);assert.equal((await r.json()).code,'CONTEXT_TOO_BIG');assert.equal(sent,0);assert.equal(blocked,1);assert.equal(reason,'CONTEXT_TOO_BIG');
});

test('test runner refuses underfunded immutable parts before dispatch',async()=>{
 const {checkReserve}=await import('../supabase/functions/studkab-generation/reserve.mjs');
 const base={input:{system:'facts'},spec:{prompt:'write',max_output_tokens:4000}};
 for(const value of [undefined,0,7000,'250000',NaN])assert.throws(()=>checkReserve({...base,spec:{...base.spec,max_cost_microusd:value}}));
 const c={...base,spec:{...base.spec,max_cost_microusd:10000}};assert.equal(checkReserve(c),c);
});

test('invalid or unknown first review blocks before a second provider dispatch',async()=>{
 const hash='b'.repeat(64),word='Анализ выручки показывает рост и объясняет причины изменений.';
 const packet={word:{fileHash:hash,text:word},passport:{items:[{id:'ANALYSIS',text:'Анализ выручки',source_attachment_id:'source'}]},materials:[{id:'source',text:'Задание требует анализ выручки и выводы'}]};
 const codes=['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12','C13','S01','S02','S03'];
 const raw=JSON.stringify({wordHash:hash,findings:[],coverage:{checked:[],notChecked:codes},requirements:[{id:'ANALYSIS',status:'pass',sourceId:'source',sourceQuote:'анализ выручки и выводы',wordQuote:word,wordLocator:'абзац 1',explanation:'Проверен анализ выручки'}]});
 const c={job_id:'job',ordinal:1,input:{system:'Проверка',review_protocol:2,review_packet:packet,review_target:{fileHash:hash}},spec:{id:'quality_review',section_id:'quality_review',prompt:'Второй проход'}};
 const part={ordinal:0,state:'done',spec:{id:'quality_evidence',section_id:'quality_review'},result:raw};
 assert.ok(withContext(c,[part]).spec.prompt.includes(raw));
 for(const rows of [[],[{...part,state:'unknown'}],[{...part,result:'invalid'}],[{...part,result:raw.replace(word,'Вымышленный текст')}],
  [{...part,spec:{...part.spec,section_id:'another'}}]]){
  let dispatched=false,paid=false,blocked;
  const h=handler({authorize:async()=>true,config:async()=>({cron_token:'test-only'}),ready:()=>true,
   rpc:async name=>{if(name==='studkab_gen_claim')return c;dispatched=true;},provider:async()=>{paid=true;},
   prepare:async current=>withContext(current,rows),failClaim:async(current,code)=>{blocked=code;}});
  const response=await h(new Request('https://internal',{method:'POST',headers:{'X-Studkab-Runner':'test-only'}}));
  assert.equal(response.status,409);assert.equal(blocked,'REVIEW_FIRST_INVALID');assert.equal(dispatched,false);assert.equal(paid,false);
 }
});
test('unpaid registered reading requires both machine authorization and cron token, works with paid provider disabled',async()=>{
 let reads=0,paid=0;
 const h=handler({authorize:async r=>r.headers.get('Authorization')==='Bearer synthetic-service',config:async()=>({cron_token:'synthetic-cron'}),ready:()=>false,
 processIntake:async()=>{reads++;return {status:'registered_read_ready'};},provider:async()=>{paid++;},rpc:async()=>{throw Error('generation must not start');}});
 const call=(bearer,token)=>h(new Request('https://internal',{method:'POST',headers:{Authorization:bearer,'X-Studkab-Runner':token}}));
 assert.equal((await call('Bearer user','synthetic-cron')).status,401);assert.equal((await call('Bearer synthetic-service','wrong')).status,401);assert.equal(reads,0);
 assert.equal((await(await call('Bearer synthetic-service','synthetic-cron')).json()).status,'registered_read_ready');assert.equal(reads,1);assert.equal(paid,0);
});
