import test from 'node:test';
import assert from 'node:assert/strict';
import {handler,validatePayload} from '../supabase/functions/studkab-requests/handler.mjs';
const p={id:'rq-test',t:'Тема',cn:'Контакт',dl:'2026-10-12',fm:{sz:14}};
const owner={id:'owner',email:'inna_odincova@mail.ru',email_confirmed_at:'2026-01-01'};
const student={...owner,id:'student',email:'student@example.com'};
const request=(body,headers={authorization:'Bearer test'})=>new Request('https://example.test',{method:'POST',headers,body:JSON.stringify(body)});
test('server validates types, identifiers, dates, formatting and strips unknown keys',()=>{
 for(const bad of [null,[],{...p,id:'bad"'},{...p,cn:''},{...p,t:{}},{...p,dl:'2026-02-31'},{...p,fm:{sz:100}}])assert.throws(()=>validatePayload(bad));
 assert.equal(validatePayload({...p,student_id:'forged'}).student_id,undefined);
});
test('auth and inbox ownership are enforced before reading requests',async()=>{
 let reads=0,user=null;
 const app=handler({auth:async()=>user,config:async()=>({executor_email:owner.email}),db:async()=>{reads++;return[];}});
 assert.equal((await app(request({action:'submit',payload:p}))).status,401);
 user=student;
 assert.equal((await app(request({action:'inbox'}))).status,403);
 assert.equal(reads,0);
 user=owner;
 assert.equal((await app(request({action:'inbox'}))).status,200);
 assert.equal(reads,1);
});
test('submission binds authenticated identity; conflicts and limits are explicit',async()=>{
 let result={id:'stored',number:42},seen;
 const app=handler({auth:async()=>student,db:async(path,method,body)=>{seen=body;return result;}});
 const r=await (await app(request({action:'submit',payload:p,student_id:'owner'}))).json();
 assert.equal(r.saved,true);assert.equal(r.number,42);assert.equal(seen.student,'student');assert.equal(r.email,'not_configured');
 result={conflict:true};assert.equal((await app(request({action:'submit',payload:p}))).status,409);
 result={limited:true};assert.equal((await app(request({action:'submit',payload:p}))).status,429);
});
test('Telegram failure leaves request pending with retry, successful send marks accepted',async()=>{
 const patches=[];let fail=true;
 const app=handler({config:async()=>({cron_token:'job'}),db:async(path,method,body)=>{
  if(path.startsWith('rpc/claim'))return [{id:'row',telegram_attempts:1}];
  patches.push(body);return[];
 },send:async()=>{if(fail)throw Error('failed');},now:()=>1000000});
 assert.equal((await app(request({}, {'x-job-key':'bad'}))).status,403);
 await app(request({}, {'x-job-key':'job'}));
 assert.equal(patches[0].telegram_sent_at,undefined);assert.ok(patches[0].retry_at);
 fail=false;await app(request({}, {'x-job-key':'job'}));assert.ok(patches[1].telegram_sent_at);
});
