import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantFinances} from '../supabase/functions/_shared/assistant-finances.mjs';
import {assistantAction} from '../supabase/functions/studkab-requests/assistant-service.mjs';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
const actor='11111111-1111-4111-8111-111111111111';
const user={id:actor,email:'owner@example.test',email_confirmed_at:'2026-01-01',is_anonymous:false};
const date=Date.parse('2026-10-09T14:55:00Z');
const budget=async(name,args)=>{assert.equal(name,'studkab_assistant_budget');assert.equal(args.p_actor,actor);return {budgetAvailable:false,remainingMicrousd:0};};
const balance=(total='12.345678')=>({schema:1,provider:'deepseek',balance:{status:'verified',isAvailable:true,observedAt:new Date(date).toISOString(),balances:[{currency:'USD',total,granted:'0',toppedUp:total}]}});
function reader(env={},fetchProvider=async()=>{throw Error('unexpected network');},now=()=>date){return createAssistantFinances({get:k=>env[k],rpc:budget,fetchProvider,now});}
const openai={OPENAI_ADMIN_API_KEY:'synthetic-admin',STUDKAB_ASSISTANT_OPENAI_PROJECT_ID:'proj_offline'};
const claude={ANTHROPIC_ADMIN_API_KEY:'synthetic-admin',STUDKAB_ASSISTANT_CLAUDE_WORKSPACE_ID:'wrkspc_offline'};
const bucket=rows=>({data:[{start_time:1791417600,end_time:1791504000,starting_at:'2026-10-08T00:00:00Z',ending_at:'2026-10-09T00:00:00Z',results:rows}],has_more:false,next_page:null});
test('missing credentials stay unknown independently of exhausted application budget',async()=>{
 const result=await reader()(actor);
 assert.equal(result.application.status,'blocked');assert.equal(result.application.availableMicrousd,0);
 for(const p of result.providers){assert.equal(p.balance.status,'unknown');assert.equal(p.costs.status,'unknown');assert.equal(p.balance.balances,undefined);assert.equal(p.costs.amount,undefined);}
});
test('DeepSeek balance is read with no generation flags and no material payload',async()=>{
 const calls=[];const env={STUDKAB_PROXY_TOKEN:'synthetic-proxy'};
 const result=await reader(env,async(url,options)=>{calls.push({url,options});return Response.json({...balance(),secret:'must not escape'});})(actor);
 assert.equal(calls.length,1);assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),{action:'finances'});
 const b=result.providers[0].balance;assert.equal(b.status,'verified');assert.equal(b.balances[0].total,'12.345678');
 assert.equal(result.application.availableMicrousd,0);assert.equal(JSON.stringify(result).includes('must not escape'),false);assert.equal(JSON.stringify(result).includes('synthetic-proxy'),false);
});
test('CNY and USD remain independent, malformed currencies and amounts never become zero',async()=>{
 const values=[{...balance(),balance:{...balance().balance,balances:[{currency:'CNY',total:'20',granted:'3',toppedUp:'17'},{currency:'USD',total:'4',granted:'0',toppedUp:'4'}]}},
 {...balance(),balance:{...balance().balance,balances:[{currency:'EUR',total:'20',granted:'0',toppedUp:'20'}]}},
 {...balance(),balance:{...balance().balance,balances:[{currency:'USD',total:0,granted:'0',toppedUp:'0'}]}}];
 for(let i=0;i<values.length;i++){const r=await reader({STUDKAB_PROXY_TOKEN:'synthetic'},async()=>Response.json(values[i]))(actor);assert.equal(r.providers[0].balance.status,i?'unknown':'verified');if(i)assert.equal(r.providers[0].balance.balances,undefined);}
});
test('OpenAI report is GET and restricted to configured project, not a wallet',async()=>{
 let sent;
 const r=await reader(openai,async(url,opts)=>{sent={url:new URL(url),opts};return Response.json(bucket([{project_id:'proj_offline',amount:{currency:'usd',value:0.125}},{project_id:'proj_offline',amount:{currency:'usd',value:0.000000005}}]));})(actor);
 const p=r.providers.find(p=>p.provider==='chatgpt');assert.equal(p.balance.status,'unknown');assert.equal(p.costs.amount,'0.125000005');assert.equal(p.costs.scope,'configured_project');
 assert.equal(sent.opts.method,'GET');assert.equal(sent.opts.body,undefined);assert.equal(sent.url.pathname,'/v1/organization/costs');assert.equal(sent.url.searchParams.get('project_ids'),'proj_offline');assert.equal(sent.url.searchParams.get('group_by'),'project_id');
 assert.equal(JSON.stringify(r).includes('synthetic-admin'),false);
});
test('ordinary API key and unscoped admin key never request organization expenses',async()=>{
 for(const env of [{OPENAI_API_KEY:'synthetic-runtime'}, {OPENAI_ADMIN_API_KEY:'synthetic-admin'}]){
  let calls=0;const r=await reader(env,async()=>{calls++;throw Error();})(actor);assert.equal(calls,0);assert.equal(r.providers[2].costs.status,'unknown');
 }
});
test('Claude cost units are cents, only selected workspace reaches response',async()=>{
 const r=await reader(claude,async(url,opts)=>{
  assert.equal(opts.method,'GET');assert.equal(new URL(url).searchParams.get('group_by[]'),'workspace_id');
  return Response.json(bucket([{workspace_id:'wrkspc_offline',currency:'USD',amount:'123.78912'},{workspace_id:'wrkspc_other',currency:'USD',amount:'9999'}]));
 })(actor);
 assert.equal(r.providers[1].costs.amount,'1.2378912');assert.equal(r.providers[1].costs.coverage,'excludes_priority_tier');assert.equal(JSON.stringify(r).includes('wrkspc_other'),false);
});
test('foreign OpenAI scope, bad units and untrusted errors fail closed',async()=>{
 const cases=[bucket([{project_id:'proj_other',amount:{currency:'usd',value:10}}]),bucket([{project_id:'proj_offline',amount:{currency:'eur',value:10}}]),bucket([{project_id:'proj_offline',amount:{currency:'usd',value:'NaN'}}])];
 for(const body of cases){const r=await reader(openai,async()=>Response.json(body))(actor);assert.equal(r.providers[2].costs.status,'unknown');assert.equal(r.providers[2].costs.amount,undefined);}
 const r=await reader(openai,async()=>{throw Error('synthetic-admin private response');})(actor);assert.equal(JSON.stringify(r).includes('private response'),false);
});
test('authorization denial, rate and invalid oversized supplier response preserve unknown',async()=>{
 for(const status of [401,403,429,500]){const r=await reader(openai,async()=>new Response('synthetic-admin',{status}))(actor);assert.equal(r.providers[2].costs.status,'unknown');assert.equal(JSON.stringify(r).includes('synthetic-admin'),false);}
 const r=await reader(openai,async()=>new Response('x'.repeat(1000001)))(actor);assert.equal(r.providers[2].costs.reason,'invalid_response');
});
test('pagination is bounded and repeated cursors/buckets never underreport as complete',async()=>{
 let calls=0;const r=await reader(openai,async()=>{calls++;return Response.json({...bucket([]),has_more:true,next_page:'same'});})(actor);
 assert.equal(calls,2);assert.equal(r.providers[2].costs.status,'unknown');assert.equal(r.providers[2].costs.amount,undefined);
});
test('concurrent checks coalesce and cache survives failed refresh only with explicit stale age',async()=>{
 let clock=date,calls=0,fail=false;
 const f=reader({STUDKAB_PROXY_TOKEN:'synthetic'},async()=>{calls++;if(fail)throw Error('offline');return Response.json(balance());},()=>clock);
 const [a,b]=await Promise.all([f(actor),f(actor)]);assert.equal(calls,1);assert.deepEqual(a.providers,b.providers);
 await f(actor);assert.equal(calls,1);
 clock+=60001;fail=true;const old=await f(actor);assert.equal(old.providers[0].balance.status,'stale');assert.equal(old.providers[0].balance.observedAt,new Date(date).toISOString());
 clock=date+600001;const expired=await f(actor);assert.equal(expired.providers[0].balance.status,'unknown');assert.equal(expired.providers[0].balance.balances,undefined);
});
test('credential rotation invalidates cache and cached supplier data cannot replace unavailable app policy',async()=>{
 let key='old',calls=0;
 const f=createAssistantFinances({get:k=>k==='STUDKAB_PROXY_TOKEN'?key:undefined,rpc:async()=>{throw Error();},now:()=>date,fetchProvider:async()=>{calls++;return Response.json(balance());}});
 await f(actor);key='new';const r=await f(actor);assert.equal(calls,2);assert.equal(r.application.status,'unknown');assert.equal(r.application.availableMicrousd,undefined);
});
test('service authenticates executor before any finance adapter and ignores untrusted finance options',async()=>{
 let called=0;const options={config:async()=>({executor_email:user.email}),finances:async id=>{assert.equal(id,actor);called++;return {schema:1};}};
 const denied=await assistantAction({action:'assistant-finances'},{...user,email:'student@example.test'},options);assert.equal(denied.status,403);assert.equal(called,0);
 const invalid=await assistantAction({action:'assistant-finances'},{...user,id:'invalid'},options);assert.equal(invalid.status,400);assert.equal(called,0);
 const r=await assistantAction({action:'assistant-finances',key:'untrusted',url:'https://untrusted.test',topUp:true},user,options);assert.deepEqual(r.data,{schema:1});assert.equal(called,1);
});
test('actual handler routes read-only finance and prevents students and oversized calls',async()=>{
 let calls=0;
 const h=handler({auth:async()=>user,config:async()=>({executor_email:user.email}),assistant:{finances:async()=>{calls++;return {schema:1};}}});
 const req=body=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(body)});
 assert.equal((await h(req({action:'assistant-finances'}))).status,200);assert.equal(calls,1);
 assert.equal((await h(req({action:'assistant-finances',padding:'x'.repeat(17000)}))).status,413);assert.equal(calls,1);
 const noAuth=await h(new Request('https://example.test',{method:'POST',body:'{"action":"assistant-finances"}'}));assert.equal(noAuth.status,401);assert.equal(calls,1);
});
