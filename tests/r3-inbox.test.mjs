// ROUTE-03, R3-E часть 4: входящие отдают краткий этап заявок по форме одной выборкой на страницу.
import test from 'node:test';import assert from 'node:assert/strict';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
function app(calls){
 return handler({auth:async()=>({id:'e',email:'exec@example.invalid',email_confirmed_at:'2026-01-01'}),isMember:async()=>true,config:async()=>({executor_email:'exec@example.invalid'}),
  db:async path=>{calls.push(path);
   if(path.startsWith('studkab_requests?'))return [{id:A,number:1,payload:{route:'r3'}},{id:B,number:2,payload:{route:'r3'}},{id:C,number:3,payload:{route:'received'}}];
   if(path.startsWith('studkab_r3_work?'))return [{request_id:A,taken_at:'2026-10-05T07:40:00Z',result_at:null,delivered_at:null,downloaded_at:null,handed_at:null,returns:0,returned_at:null}];
   if(path.startsWith('studkab_clarifications?'))return [{request_id:B},{request_id:B}];
   if(path.startsWith('studkab_results?'))return [];
   throw Error('Unexpected '+path);}});
}
const call=async(a,body)=>{const r=await a(new Request('https://x.test',{method:'POST',headers:{authorization:'Bearer t'},body:JSON.stringify(body)}));return {status:r.status,...await r.json()};};
test('R3-E4: inbox adds the route summary for form requests in two bounded reads',async()=>{
 const calls=[],r=await call(app(calls),{action:'inbox',includeR3:true,after:0});
 assert.equal(r.status,200);
 assert.deepEqual(r.rows[0].r3Summary,{takenAt:'2026-10-05T07:40:00Z',resultAt:null,deliveredAt:null,downloadedAt:null,handedAt:null,returns:0,returnedAt:null,openQuestions:0});
 assert.equal(r.rows[1].r3Summary.openQuestions,2);assert.equal(r.rows[1].r3Summary.takenAt,null);
 assert.equal(r.rows[2].r3Summary,undefined);
 assert.equal(calls.filter(p=>p.startsWith('studkab_r3_work?')).length,1);assert.ok(calls.find(p=>p.startsWith('studkab_r3_work?')).includes('request_id=in.('+A+','+B+')'));
 const plain=[],q=await call(app(plain),{action:'inbox',after:0});assert.equal(q.rows[0].r3Summary,undefined);assert.equal(plain.some(p=>p.startsWith('studkab_r3_work?')),false);
});
