import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handler,prepare} from '../supabase/functions/studkab-generation-api/handler.mjs';
const uid='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222';
const valid={action:'start',request:'rq-test',system:'Материалы',parts:[{id:'intro',prompt:'Введение'}]};
function setup({user={id:uid,email:'owner@example.test',email_confirmed_at:'yes'},enabled=true,cost=250000,budget=1000000,missing=false}={}){
 const calls=[];
 const h=handler({auth:async()=>user,config:async()=>({executor_email:'owner@example.test'}),settings:()=>({enabled,cost}),
 db:async(path,args)=>{calls.push({path,args});if(path.startsWith('studkab_gen_budget'))return [{limit_microusd:budget,reserved_microusd:0}];
 if(path.startsWith('rpc/'))return job;if(path.startsWith('studkab_gen_jobs'))return missing?[]:[{id:job,status:'running'}];
 return [{ordinal:0,state:'done',result:'Сохранено',spec:{id:'intro',prompt:'private'},claim:'private-token'}];}});
 return {calls,request:body=>h(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer user'},body:JSON.stringify(body)}))};
}
test('anonymous and unconfirmed users are denied',async()=>{for(const user of [null,{id:uid,email_confirmed_at:null},{id:uid,email_confirmed_at:'yes',is_anonymous:true}]){const s=setup({user});assert.equal((await s.request(valid)).status,401);assert.equal(s.calls.length,0);}});
test('student cannot start or read executor jobs',async()=>{const s=setup({user:{id:uid,email:'student@example.test',email_confirmed_at:'yes'}});assert.equal((await s.request(valid)).status,403);assert.equal(s.calls.length,0);});
test('zero budget blocks start before database mutation',async()=>{const s=setup({budget:0});assert.equal((await s.request(valid)).status,409);assert.ok(s.calls.every(c=>!c.path.startsWith('rpc/')));});
test('disabled integration does not read budget or create job',async()=>{const s=setup({enabled:false});assert.equal((await s.request(valid)).status,503);assert.equal(s.calls.length,0);});
test('server owner and reserve override client fields',async()=>{const s=setup();const body={...valid,owner:'other',parts:[{...valid.parts[0],max_cost_microusd:1}]};assert.equal((await s.request(body)).status,200);const args=s.calls.at(-1).args;assert.equal(args.p_owner,uid);assert.equal(args.p_plan[0].max_cost_microusd,250000);});
test('same request produces identical immutable RPC input',async()=>{const s=setup();await s.request(valid);await s.request(valid);const starts=s.calls.filter(c=>c.path.startsWith('rpc/'));assert.deepEqual(starts[0].args,starts[1].args);});
test('status always filters by authenticated owner and omits secrets',async()=>{const s=setup();const r=await s.request({action:'status',job,owner:'other'});const value=await r.json();assert.ok(s.calls[0].path.includes('owner_id=eq.'+uid));assert.deepEqual(value.parts,[{ordinal:0,id:'intro',section:'intro',state:'done',text:'Сохранено'}]);});
test('missing or foreign job returns no part data',async()=>{const s=setup({missing:true});assert.equal((await s.request({action:'status',job})).status,404);assert.equal(s.calls.length,1);});
test('query injection cannot reach database',async()=>{const s=setup();assert.equal((await s.request({action:'status',job:'x&owner_id=neq.x'})).status,400);assert.equal(s.calls.length,0);});
test('plan rejects duplicates, invalid sizes and missing trusted costs',()=>{assert.throws(()=>prepare({...valid,parts:[valid.parts[0],valid.parts[0]]},250000));assert.throws(()=>prepare(valid,0));assert.throws(()=>prepare({...valid,system:'x'.repeat(100001)},250000));});

test('large section is split into deterministic separately saved parts',()=>{
 const p=prepare({...valid,parts:[{id:'ch2',prompt:'Практическая глава',target_chars:27000}]},250000);
 assert.equal(p.plan.length,6);assert.equal(p.plan[5].part_index,5);assert.equal(p.plan[0].section_id,'ch2');
 assert.ok(p.plan.every(x=>x.max_cost_microusd===250000));assert.equal(new Set(p.plan.map(x=>x.id)).size,6);
});
test('total part count and target values are bounded',()=>{
 assert.throws(()=>prepare({...valid,parts:[{id:'one',prompt:'test',target_chars:-1}]},250000));
 assert.throws(()=>prepare({...valid,parts:Array.from({length:100},(_,i)=>({id:'p'+i,prompt:'test',target_chars:9000}))},250000));
});

test('availability requires enough remaining budget for a whole part',async()=>{
 for(const [budget,expected] of [[249999,false],[250000,true]]){
  const s=setup({budget});const r=await s.request({action:'capabilities'});
  assert.equal((await r.json()).budgetAvailable,expected);
 }
});
test('reserve below runner minimum cannot advertise or start work',async()=>{
 const s=setup({cost:249999});const r=await s.request({action:'capabilities'});
 assert.equal((await r.json()).enabled,false);
 assert.equal((await s.request(valid)).status,400);
 assert.ok(s.calls.every(c=>!c.path.startsWith('rpc/')));
});
