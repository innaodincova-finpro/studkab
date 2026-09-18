import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handler,prepare,failure,diagnostic,workKind} from '../supabase/functions/studkab-generation-api/handler.mjs';
import {reserveMicrousd} from '../supabase/functions/_shared/deepseek-cost.mjs';
const uid='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333',passportId='44444444-4444-4444-8444-444444444444',materialFingerprint='a'.repeat(64);
const valid={action:'start',request:requestId,system:'Материалы',materialFingerprint,parts:[{id:'intro',prompt:'Введение'}]};
test('DeepSeek reserve uses peak prices, UTF-8 bound and 25 percent margin',()=>{
 assert.equal(reserveMicrousd('s','p',4000),7537);
 assert.ok(reserveMicrousd('Я','текст',4000)>reserveMicrousd('Y','text',4000));
});
function setup({user={id:uid,email:'owner@example.test',email_confirmed_at:'yes'},enabled=true,cost=250000,budget=1000000,missing=false,passport=true,workType='Курсовая работа',total=500000}={}){
 const calls=[];
 const h=handler({auth:async()=>user,config:async()=>({executor_email:'owner@example.test'}),settings:()=>({enabled,cost}),
 db:async(path,args)=>{calls.push({path,args});if(path.startsWith('studkab_gen_budget'))return [{limit_microusd:budget,reserved_microusd:0}];
 if(path.startsWith('studkab_gen_policy'))return [{temporary_total_microusd:total}];
 if(path.startsWith('studkab_requests'))return [{id:requestId,payload:{k:workType}}];
 if(path.startsWith('studkab_gen_limits'))return [{max_cost_microusd:250000}];
 if(path.startsWith('studkab_requirement_passports'))return passport?[{id:passportId,revision:1,source_fingerprint:materialFingerprint}]:[];
 if(path.startsWith('rpc/'))return job;if(path.startsWith('studkab_gen_jobs'))return missing?[]:[{id:job,status:'running'}];
 if(path.startsWith('studkab_gen_attempts'))return [];
 return [{ordinal:0,state:'done',result:'Сохранено',spec:{id:'intro',prompt:'private'},claim:'private-token'}];}});
 return {calls,request:body=>h(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer user'},body:JSON.stringify(body)}))};
}
test('anonymous and unconfirmed users are denied',async()=>{for(const user of [null,{id:uid,email_confirmed_at:null},{id:uid,email_confirmed_at:'yes',is_anonymous:true}]){const s=setup({user});assert.equal((await s.request(valid)).status,401);assert.equal(s.calls.length,0);}});
test('student cannot start or read executor jobs',async()=>{const s=setup({user:{id:uid,email:'student@example.test',email_confirmed_at:'yes'}});assert.equal((await s.request(valid)).status,403);assert.equal(s.calls.length,0);});
test('zero budget blocks start before database mutation',async()=>{const s=setup({budget:0});assert.equal((await s.request(valid)).status,409);assert.ok(s.calls.every(c=>!c.path.startsWith('rpc/')));});
test('disabled integration does not read budget or create job',async()=>{const s=setup({enabled:false});assert.equal((await s.request(valid)).status,503);assert.equal(s.calls.length,0);});
test('server owner and reserve override client fields',async()=>{const s=setup();const body={...valid,owner:'other',parts:[{...valid.parts[0],max_cost_microusd:1}]};assert.equal((await s.request(body)).status,200);const args=s.calls.at(-1).args;assert.equal(args.p_owner,uid);assert.equal(args.p_plan[0].max_cost_microusd,250000);});
test('same request produces identical immutable RPC input',async()=>{const s=setup();await s.request(valid);await s.request(valid);const starts=s.calls.filter(c=>c.path.startsWith('rpc/'));assert.deepEqual(starts[0].args,starts[1].args);});
test('status always filters by authenticated owner and omits secrets',async()=>{const s=setup();const r=await s.request({action:'status',job,owner:'other'});const value=await r.json();assert.ok(s.calls[0].path.includes('owner_id=eq.'+uid));assert.deepEqual(value.diagnostics,[]);assert.deepEqual(value.parts,[{ordinal:0,id:'intro',section:'intro',state:'done',text:'Сохранено',failure:null}]);});
test('missing or foreign job returns no part data',async()=>{const s=setup({missing:true});assert.equal((await s.request({action:'status',job})).status,404);assert.equal(s.calls.length,1);});
test('query injection cannot reach database',async()=>{const s=setup();assert.equal((await s.request({action:'status',job:'x&owner_id=neq.x'})).status,400);assert.equal(s.calls.length,0);});
test('plan rejects duplicates, invalid sizes and missing trusted costs',()=>{assert.throws(()=>prepare({...valid,parts:[valid.parts[0],valid.parts[0]]},250000));assert.throws(()=>prepare(valid,0));assert.throws(()=>prepare({...valid,system:'x'.repeat(100001)},250000));});

test('large section is split into deterministic separately saved parts',()=>{
 const p=prepare({...valid,parts:[{id:'ch2',prompt:'Практическая глава',target_chars:27000}]},250000);
 assert.equal(p.plan.length,8);assert.equal(p.plan[3].part_index,3);assert.equal(p.plan[0].section_id,'ch2');
 assert.ok(p.plan.every(x=>x.max_cost_microusd===250000));assert.equal(new Set(p.plan.map(x=>x.id)).size,8);
});
test('total part count and target values are bounded',()=>{
 assert.throws(()=>prepare({...valid,parts:[{id:'one',prompt:'test',target_chars:-1}]},250000));
 assert.throws(()=>prepare({...valid,parts:Array.from({length:100},(_,i)=>({id:'p'+i,prompt:'test',target_chars:9000}))},250000));
});

test('availability reports any positive server-controlled remaining ceiling',async()=>{
 for(const [budget,expected] of [[0,false],[1,true]]){
  const s=setup({budget});const r=await s.request({action:'capabilities'});
  assert.equal((await r.json()).budgetAvailable,expected);
 }
});
test('lost job history filters by executor and request without selecting snapshots',async()=>{
 const s=setup();assert.equal((await s.request({action:'history',request:requestId})).status,200);
 const path=s.calls[0].path;assert.ok(path.includes('owner_id=eq.'+uid));
 assert.ok(path.includes('request_id=eq.'+requestId));assert.ok(path.includes('limit=20'));
 assert.equal(path.includes('snapshot'),false);
 const bad=setup();assert.equal((await bad.request({action:'history',request:'x&owner_id=neq.x'})).status,400);assert.equal(bad.calls.length,0);
});

test('generation recognizes only work types with an explicit paid limit',()=>{
 // Classification is deterministic and unknown labels never inherit a paid limit.
 assert.equal(workKind('Выпускная квалификационная работа'),'thesis');
 assert.equal(workKind('Курсовая работа'),'coursework');
 assert.equal(workKind('Контрольная работа'),'control');
 assert.equal(workKind('Реферат'),null);
});
test('missing approved passport blocks before job creation',async()=>{
 const s=setup({passport:false});const r=await s.request(valid);
 assert.equal(r.status,409);assert.equal((await r.json()).error,'PASSPORT_REQUIRED');
 assert.ok(s.calls.every(c=>!c.path.startsWith('rpc/')));
});
test('unknown work type blocks before reading a paid limit or creating a job',async()=>{
 const s=setup({workType:'Реферат'});const r=await s.request(valid);
 assert.equal(r.status,409);assert.equal((await r.json()).error,'WORK_TYPE_REQUIRED');
 assert.ok(s.calls.every(c=>!c.path.startsWith('studkab_gen_limits')&&!c.path.startsWith('rpc/')));
});
test('temporary total ceiling blocks start even when operator budget is larger',async()=>{
 const s=setup({budget:1000000,total:0});const r=await s.request(valid);
 assert.equal(r.status,409);assert.equal((await r.json()).error,'BUDGET_BLOCKED');
 assert.ok(s.calls.every(c=>!c.path.startsWith('rpc/')));
});
test('estimate reports an over-limit amount without creating a job',async()=>{
 const body={...valid,action:'estimate',parts:[{id:'huge',prompt:'chapter',target_chars:50000}]};
 const estimate=setup();const er=await estimate.request(body),ev=await er.json();
 assert.equal(er.status,200);assert.equal(ev.canStart,false);assert.ok(ev.estimatedCostMicrousd>ev.maxCostMicrousd);
 assert.ok(estimate.calls.every(c=>!c.path.startsWith('rpc/')));
 const start=setup();const sr=await start.request({...body,action:'start'});
 assert.equal(sr.status,409);assert.equal((await sr.json()).error,'BUDGET_BLOCKED');
 assert.ok(start.calls.every(c=>!c.path.startsWith('rpc/')));
});
test('estimated cost is server-calculated and returned with the immutable work ceiling',async()=>{
 const s=setup();const r=await s.request({...valid,maxCostMicrousd:1});const value=await r.json();
 assert.equal(r.status,200);assert.equal(value.maxCostMicrousd,250000);
 assert.ok(value.estimatedCostMicrousd>0&&value.estimatedCostMicrousd<value.maxCostMicrousd);
 const args=s.calls.at(-1).args;assert.ok(args.p_plan.every(p=>p.max_cost_microusd===250000&&p.max_output_tokens===4000));
});

test('new part target is bounded without reducing total requested volume',()=>{
 const p=prepare({...valid,parts:[{id:'ch2',prompt:'chapter',target_chars:27000}]},250000);
 assert.equal(p.plan.length,8);assert.ok(p.plan.every(x=>x.prompt.includes('3375 знаков')));
 assert.equal(prepare({...valid,parts:[{id:'x',prompt:'part',target_chars:3600}]},250000).plan.length,1);
 assert.equal(prepare({...valid,parts:[{id:'x',prompt:'part',target_chars:3601}]},250000).plan.length,2);
});
test('estimate accumulates generated context inside each section only',()=>{
 const one=prepare({...valid,parts:[{id:'a',prompt:'part',target_chars:4000}]},250000);
 const two=prepare({...valid,parts:[{id:'a',prompt:'part',target_chars:2000},{id:'b',prompt:'part',target_chars:2000}]},250000);
 const expected=reserveMicrousd(valid.system,'part'+two.plan[0].prompt,4000,0)+
  reserveMicrousd(valid.system,'part'+two.plan[1].prompt,4000,0);
 assert.equal(two.estimatedTotal,expected);
 assert.ok(one.estimatedTotal>two.estimatedTotal);
});
test('failure diagnostics expose only bounded safe fields',()=>{
 assert.deepEqual(failure({detail:{finish_reason:'length',completion_tokens:2500,prompt_tokens:12253,secret:'key',text:'private'},reason:'RESULT_UNKNOWN'}),{code:'OUTPUT_LIMIT',prompt_tokens:12253,completion_tokens:2500});
 assert.deepEqual(failure({detail:{finish_reason:'<script>',prompt_tokens:-1,completion_tokens:'secret'}}),{code:'RESULT_UNKNOWN'});
 assert.deepEqual(failure({reason:'LEASE_EXPIRED_AFTER_DISPATCH'}),{code:'LEASE_EXPIRED_AFTER_DISPATCH'});
});

import {withContext} from '../supabase/functions/studkab-generation/context.mjs';
import {expandParts} from '../supabase/functions/studkab-generation-api/plan.mjs';
test('R4: 3600-character chunks keep the representative coursework plan below USD 0.25',()=>{
 const input={request:requestId,materialFingerprint,system:'s'.repeat(19178),parts:[
  ['ch1',10800],['ch2',10800],['ch3',7200],['intro',3600],['concl',3600]
 ].map(([id,target_chars])=>({id,prompt:'p'.repeat(1400),target_chars}))};
 const result=prepare(input,250000);
 assert.equal(result.plan.length,10);
 assert.ok(result.estimatedTotal<=250000,`estimate ${result.estimatedTotal} exceeds the coursework limit`);
 assert.equal(result.plan.filter(p=>p.section_id==='ch1').length,3);
 assert.equal(result.plan.filter(p=>p.section_id==='intro').length,1);
});
test('R4/R7: bibliography cannot enter the paid generation plan',()=>{
 const input={request:requestId,materialFingerprint,system:'system',parts:[
  {id:'ch1',prompt:'Draft chapter',target_chars:3600},
  {id:'refs',prompt:'Generate references',target_chars:1800}
 ]};
 const result=prepare(input,250000);
 assert.deepEqual(result.plan.map(part=>part.section_id),['ch1']);
 assert.deepEqual(Object.keys(result.snapshot.prompts),['ch1']);
 assert.throws(()=>prepare({...input,parts:[input.parts[1]]},250000),/INVALID_INPUT/);
});
test('compact plans reconstruct exact original prompts',()=>{
 const input={request:requestId,materialFingerprint,system:'system',parts:[{id:'chapter',prompt:'Материалы '.repeat(6000),target_chars:30000}]};
 const original=expandParts(input.parts,250000);
 const {snapshot,plan}=prepare(input,250000);
 assert.ok(new TextEncoder().encode(JSON.stringify({input:snapshot,plan})).length<900000);
 for(let i=0;i<plan.length;i++)assert.equal(withContext({input:snapshot,spec:plan[i],ordinal:i},[]).spec.prompt,original[i].prompt);
 assert.throws(()=>withContext({input:{system:'s'},spec:plan[0],ordinal:0},[]),/CONTEXT_INVALID/);
});
test('C-051: malformed request number never reaches a database filter',async()=>{
 for(const action of ['start','estimate']){
  const s=setup();
  assert.equal((await s.request({...valid,action,request:'x&payload=not.is.null'})).status,400);
  assert.equal(s.calls.length,0);
 }
});
test('C-051: cancel is bound to the authenticated executor and needs no budget',async()=>{
 const s=setup({enabled:false,budget:0});
 const r=await s.request({action:'cancel',job,owner:'other'});
 assert.equal(r.status,200);
 const call=s.calls.find(c=>c.path==='rpc/studkab_gen_cancel');
 assert.deepEqual(call.args,{p_owner:uid,p_job:job});
 assert.equal(s.calls.some(c=>c.path.startsWith('studkab_gen_budget')),false);
});
test('C-051: cancel rejects malformed job and hides foreign jobs',async()=>{
 const s=setup();
 assert.equal((await s.request({action:'cancel',job:'x&owner_id=neq.x'})).status,400);
 assert.equal(s.calls.length,0);
 const h=handler({auth:async()=>({id:uid,email:'owner@example.test',email_confirmed_at:'yes'}),config:async()=>({executor_email:'owner@example.test'}),settings:()=>({enabled:true}),db:async()=>'not_found'});
 const r=await h(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer user'},body:JSON.stringify({action:'cancel',job})}));
 assert.equal(r.status,404);
});
test('C-051: student cannot cancel executor jobs',async()=>{
 const s=setup({user:{id:uid,email:'student@example.test',email_confirmed_at:'yes'}});
 assert.equal((await s.request({action:'cancel',job})).status,403);assert.equal(s.calls.length,0);
});
test('R1 diagnostics expose bounded operational fields and omit arbitrary detail',()=>{
 assert.deepEqual(diagnostic({ordinal:2,section:'chapter-2',stage:'provider',attempt:1,request_id:'11111111-1111-4111-8111-111111111111',reason:'RESULT_UNKNOWN',finish_reason:'length',started_at:'2026-09-17T12:00:00Z',finished_at:null,promptTokens:10,completionTokens:20,secret:'x'}),
  {ordinal:2,section:'chapter-2',stage:'provider',attempt:1,requestId:'11111111-1111-4111-8111-111111111111',reason:'RESULT_UNKNOWN',finishReason:'length',startedAt:'2026-09-17T12:00:00Z',finishedAt:null,promptTokens:10,completionTokens:20});
 assert.equal(diagnostic({stage:'private-stage'}),null);
});
