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
test('scheduler accepts only configured project bearer; arbitrary user JWT is rejected',()=>{
 const check=token=>machineAuthorization(new Request('https://internal',{headers:{Authorization:'Bearer '+token}}),{serviceKey:'service-test',anonKey:'project-test'});
 assert.equal(check('project-test'),true);assert.equal(check('service-test'),true);assert.equal(check('user-jwt'),false);
 assert.equal(machineAuthorization(new Request('https://internal'),{}),false);
});
test('public scheduler bearer without secret cron cannot access probe or claim',async()=>{
 let touched=false;
 const h=handler({authorize:r=>machineAuthorization(r,{anonKey:'public-test'}),config:async()=>({cron_token:'secret-test'}),
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
