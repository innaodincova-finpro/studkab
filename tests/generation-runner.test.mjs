import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../supabase/functions/studkab-generation/handler.mjs';
const claim={job_id:'job',ordinal:0,claim:'claim'};
function setup({fail,configured=true,result={complete:true,text:'saved'}}={}){
 const calls=[];let paid=0;
 const h=handler({config:async()=>({cron_token:'test-only'}),ready:()=>configured,
 rpc:async(name,args)=>{calls.push({name,args});if(name===fail)throw Error('network');
 if(name.endsWith('_claim'))return claim;if(name.endsWith('_dispatch'))return 'request';return 'done';},
 provider:async()=>{paid++;return result;}});
 const request=(token='test-only')=>h(new Request('https://internal',{method:'POST',headers:{'X-Studkab-Runner':token}}));
 return {calls,request,paid:()=>paid};
}
test('unauthorized request cannot claim or send',async()=>{const s=setup();assert.equal((await s.request('wrong')).status,401);assert.equal(s.calls.length,0);});
test('missing configuration does not consume claim or budget',async()=>{const s=setup({configured:false});assert.equal((await s.request()).status,503);assert.equal(s.calls.length,0);});
test('dispatch reply lost: provider never called and no retry',async()=>{const s=setup({fail:'studkab_gen_dispatch'});const r=await(await s.request()).json();assert.equal(r.status,'dispatch_unconfirmed');assert.equal(s.paid(),0);assert.equal(s.calls.length,2);});
test('successful response saved against same claim and request',async()=>{const s=setup();await s.request();assert.equal(s.paid(),1);assert.equal(s.calls[2].args.p_request,'request');assert.equal(s.calls[2].args.p_text,'saved');});
test('incomplete response is not stored as finished',async()=>{const s=setup({result:{text:'partial',complete:false}});await s.request();assert.equal(s.calls[2].args.p_text,null);});
test('save reply lost: no second paid call',async()=>{const s=setup({fail:'studkab_gen_settle'});const r=await(await s.request()).json();assert.equal(r.status,'save_unconfirmed');assert.equal(s.paid(),1);assert.equal(s.calls.length,3);});
