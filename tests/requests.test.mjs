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

test('only confirmed executor can create invitations; invalid email never reaches admin API',async()=>{
 let calls=0;
 const deps={auth:async()=>({id:'s',email:'student@test.ru',email_confirmed_at:'yes'}),config:async()=>({executor_email:'owner@test.ru'}),invite:async()=>{calls++;return {url:'private'}}};
 const req=email=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer x'},body:JSON.stringify({action:'invite',email})});
 assert.equal((await handler(deps)(req('a@test.ru'))).status,403);assert.equal(calls,0);
 deps.auth=async()=>({id:'o',email:'owner@test.ru',email_confirmed_at:'yes'});
 assert.equal((await handler(deps)(req('bad'))).status,400);assert.equal(calls,0);
 assert.equal((await handler(deps)(req('a@test.ru'))).status,200);assert.equal(calls,1);
});

test('recovery is executor-only and requires explicit identity verification',async()=>{
 const make=(email)=>handler({auth:async()=>({id:'a',email,email_confirmed_at:'yes'}),config:async()=>({executor_email:'owner@example.test'}),invite:async(email,recovery)=>({email,recovery})});
 const req=(verified)=>new Request('https://test/',{method:'POST',headers:{authorization:'Bearer token','Content-Type':'application/json'},body:JSON.stringify({action:'recover',email:'student@example.test',identityVerified:verified})});
 assert.equal((await make('student@example.test')(req(true))).status,403);
 assert.equal((await make('owner@example.test')(req(false))).status,400);
 const response=await make('owner@example.test')(req(true));assert.equal(response.status,200);assert.equal((await response.json()).recovery,true);
});

test('recovery link uses existing account only; invite never resets it',async()=>{
 const {accessLink}=await import('../supabase/functions/studkab-requests/access-links.mjs');
 let calls=[];
 const request=async(url,opts)=>{calls.push({url,body:opts.body});if(url.includes('/admin/users'))return Response.json({users:[{email:'s@example.test',email_confirmed_at:'yes'}]});return Response.json({hashed_token:'one-time-test',verification_type:'recovery'});};
 const args={base:'https://test',key:'test',email:'s@example.test',request};
 assert.equal((await accessLink(args)).existing,true);assert.equal(calls.length,1);
 calls=[];const result=await accessLink({...args,recovery:true});assert.match(result.url,/type=recovery/);assert.equal(JSON.parse(calls[1].body).type,'recovery');
 calls=[];assert.equal((await accessLink({...args,email:'missing@example.test',recovery:true})).missing,true);assert.equal(calls.length,1);
});

// Email transport is not connected to production until sender verification.
import {invitationMailer} from '../supabase/functions/studkab-requests/invitation-mail.mjs';
test('mail preparation never generates a token without configured delivery',async()=>{
 let calls=0;const mail=invitationMailer({createLink:async()=>{calls++}});
 assert.equal((await mail('student@example.test')).status,'not_configured');assert.equal(calls,0);
});
test('mail accepts only one recipient and distinguishes acceptance from uncertain delivery',async()=>{
 let calls=0,message;const deps={from:'sender@example.test',createLink:async()=>{calls++;return {existing:true}},render:(email,url,kind)=>kind,transport:{sendMail:async m=>{message=m;return {accepted:['student@example.test']}}}};
 const mail=invitationMailer(deps);
 assert.equal((await mail('student@example.test,other@example.test')).status,'invalid_email');assert.equal(calls,0);
 assert.equal((await mail('student@example.test')).status,'accepted');assert.equal(message.text,'existing');assert.equal(message.to.length,1);assert.equal(message.from.name,'Кабинет студента');
 deps.transport.sendMail=async()=>{throw {code:'ETIMEDOUT',message:'private token'}};
 assert.deepEqual(await mail('student@example.test'),{status:'unknown'});
});
