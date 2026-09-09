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

const requestId='11111111-1111-4111-8111-111111111111';
const deliveryId='22222222-2222-4222-8222-222222222222';
const documentFixture={topic:'Тема & <проверка>',student:'Тестовый студент',group:'Т-1',format:{size:14},chapters:[{id:'intro',name:'Введение'}],structure:{intro:{text:'Текст черновика <не HTML>'}}};
test('result delivery is executor-only; a student cannot read another student result',async()=>{
 let who=student,reads=0;
 const app=handler({auth:async()=>who,config:async()=>({executor_email:owner.email}),db:async(path)=>{reads++;return path.startsWith('studkab_requests?')?[{id:requestId,student_id:student.id}]:[{document:documentFixture}];}});
 assert.equal((await app(request({action:'deliver',id:requestId,deliveryId,document:documentFixture}))).status,403);assert.equal(reads,0);
 who={...student,id:'another'};
 assert.equal((await app(request({action:'result',id:requestId}))).status,404);assert.equal(reads,1);
 who=student;
 const result=await (await app(request({action:'result',id:requestId}))).json();assert.equal(result.result.document.topic,documentFixture.topic);
});
test('submitted request flows through inbox to immutable result and student retrieval',async()=>{
 let who=student,row,delivered;
 const app=handler({auth:async()=>who,config:async()=>({executor_email:owner.email}),db:async(path,method,body)=>{
  if(path==='rpc/submit_studkab_request'){row={id:requestId,number:1,payload:body.content,student_id:body.student};return{id:row.id,number:1};}
  if(path.startsWith('studkab_requests?'))return [row];
  if(path==='rpc/deliver_studkab_result'){delivered={delivery_id:body.delivery,document:body.content,created_at:'2026-09-09T00:00:00Z'};return{deliveryId:body.delivery};}
  if(path.startsWith('studkab_results?'))return delivered?[delivered]:[];
  throw Error('Unexpected path');
 }});
 assert.equal((await app(request({action:'submit',payload:p}))).status,200);
 assert.equal((await (await app(request({action:'result',id:requestId}))).json()).result,null);
 who=owner;assert.equal((await (await app(request({action:'inbox'}))).json()).rows[0].id,requestId);
 const ack=await (await app(request({action:'deliver',id:requestId,deliveryId,document:documentFixture}))).json();assert.equal(ack.saved,true);
 who=student;assert.equal((await (await app(request({action:'result',id:requestId}))).json()).result.document.structure.intro.text,documentFixture.structure.intro.text);
});
test('result validation rejects empty text, dangerous keys, oversized sections and invalid formatting',async()=>{
 const {validateResult}=await import('../supabase/functions/studkab-requests/results.mjs');
 for(const bad of [null,{}, {...documentFixture,chapters:[{id:'__proto__',name:'X'}]}, {...documentFixture,chapters:[{id:'intro',name:'A'},{id:'intro',name:'B'}]}, {...documentFixture,structure:{intro:{text:''}}},{...documentFixture,structure:{intro:{text:'x'.repeat(100001)}}},{...documentFixture,format:{size:999}}])assert.throws(()=>validateResult(bad));
 assert.equal(validateResult({...documentFixture,secret:'strip'}).secret,undefined);
});
test('delivered Word preserves custom sections and escapes markup',async()=>{
 const vm=await import('node:vm'),fs=await import('node:fs');
 const c={window:{},TextEncoder,Blob,Uint8Array,DataView,Date};vm.runInNewContext(fs.readFileSync(new URL('../result-docx.js',import.meta.url),'utf8'),c);
 const {validateResult}=await import('../supabase/functions/studkab-requests/results.mjs');
 const doc=validateResult(documentFixture);const blob=c.window.ResultDocx(doc,doc.chapters),bytes=new Uint8Array(await blob.arrayBuffer());
 assert.equal(bytes[0],80);assert.equal(bytes[1],75);
 const zip=new TextDecoder().decode(bytes);assert.match(zip,/Текст черновика &lt;не HTML&gt;/);assert.match(zip,/Тема &amp; &lt;проверка&gt;/);
});
