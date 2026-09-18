import test from 'node:test';
import assert from 'node:assert/strict';
import {handler,validatePayload} from '../supabase/functions/studkab-requests/handler.mjs';
const p={id:'rq-test',t:'Тема',cn:'Контакт',dl:'2026-10-12',fm:{sz:14}};
const owner={id:'owner',email:'owner@example.test',email_confirmed_at:'2026-01-01'};
const student={...owner,id:'student',email:'student@example.test'};
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
 const app=handler({auth:async()=>student,isMember:async()=>true,db:async(path,method,body)=>{seen=body;return result;}});
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
 const deps={auth:async()=>({id:'s',email:'student@example.test',email_confirmed_at:'yes'}),config:async()=>({executor_email:'owner@example.test'}),invite:async()=>{calls++;return {url:'private'}}};
 const req=email=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer x'},body:JSON.stringify({action:'invite',email})});
 assert.equal((await handler(deps)(req('invitee@example.test'))).status,403);assert.equal(calls,0);
 deps.auth=async()=>({id:'o',email:'owner@example.test',email_confirmed_at:'yes'});
 assert.equal((await handler(deps)(req('bad'))).status,400);assert.equal(calls,0);
 assert.equal((await handler(deps)(req('invitee@example.test'))).status,200);assert.equal(calls,1);
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
 const args={base:'https://test',key:'test',email:'s@example.test',request,isMember:async()=>true};
 assert.equal((await accessLink(args)).existing,true);assert.equal(calls.length,1);
 calls=[];const result=await accessLink({...args,recovery:true});assert.match(result.url,/type=recovery/);assert.equal(JSON.parse(calls[1].body).type,'recovery');
 calls=[];assert.equal((await accessLink({...args,email:'missing@example.test',recovery:true})).missing,true);assert.equal(calls.length,1);
});

test('requirement passport is executor-only and bound to an existing request',async()=>{
 let who=student,reads=0;
 const db=async(path)=>{reads++;return path.startsWith('studkab_requests?')?[{id:requestId}]:[];};
 const app=handler({auth:async()=>who,config:async()=>({executor_email:owner.email}),db});
 assert.equal((await app(request({action:'passport-get',id:requestId}))).status,403);assert.equal(reads,0);
 who=owner;
 assert.equal((await app(request({action:'passport-get',id:'forged'}))).status,400);assert.equal(reads,0);
 assert.equal((await app(request({action:'passport-get',id:requestId}))).status,200);assert.equal(reads,2);
});

test('passport validation separates evidence categories and strips unknown fields',async()=>{
 const {validatePassport,defaultPassport}=await import('../supabase/functions/studkab-requests/requirements.mjs');
 const passport={title:'Методичка кафедры',summary:'Проверено вручную',secret:'remove',items:[
  {id:'R1',category:'method',required:true,text:'Объём 25–30 страниц',source:'Методичка, с. 7',secret:'remove'},
  {id:'A1',category:'assumption',required:false,text:'Возможно потребуется приложение',source:''}
 ]};
 const clean=validatePassport(passport);assert.equal(clean.secret,undefined);assert.equal(clean.items[0].secret,undefined);assert.equal(clean.items.length,2);
 for(const bad of [null,{items:{}},{items:[{id:'R1',category:'unknown',text:'x'}]},{items:[{id:'R1',category:'method',text:''}]},{items:[{id:'R1',category:'method',text:'x'},{id:'R1',category:'expert',text:'y'}]}])assert.throws(()=>validatePassport(bad));
 const generated=defaultPassport({k:'Курсовая работа',d:'Экономика',rq:'25 страниц'});
 assert.deepEqual(generated.items.map(x=>x.id),['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER']);
 assert.match(generated.items.find(x=>x.id==='ANTIPLAGIARISM').text,/требуется уточнить/i);
});

test('saving and approving a passport use server RPC and never trust a student identity',async()=>{
 const calls=[];
 const db=async(path,method,body)=>{calls.push({path,method,body});if(path.startsWith('studkab_requests?'))return[{id:requestId}];return{id:'66666666-6666-4666-8666-666666666666',revision:1};};
 const app=handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db});
 const passport={title:'Требования',summary:'',items:[{id:'M1',category:'method',text:'Нужно введение',source:'Задание'}]};
 assert.equal((await app(request({action:'passport-save',id:requestId,student_id:'forged',passport,sourceFingerprint:'abc'}))).status,200);
 assert.equal(calls[1].path,'rpc/studkab_requirement_passport_save');assert.equal(calls[1].body.p_request,requestId);assert.equal(calls[1].body.student_id,undefined);
 assert.equal((await app(request({action:'passport-approve',id:requestId,passportId:'bad',passport}))).status,400);
 assert.equal((await app(request({action:'passport-approve',id:requestId,passportId:'66666666-6666-4666-8666-666666666666',passport,sourceFingerprint:'a'.repeat(64)}))).status,200);
 assert.equal(calls.at(-1).path,'rpc/studkab_requirement_passport_approve');
 assert.equal(calls.at(-1).body.p_expected_fingerprint,'a'.repeat(64));
});

test('an unresolved automatic passport cannot be approved',async()=>{
 const db=async path=>path.startsWith('studkab_requests?')?[{id:requestId,payload:{k:'Курсовая работа'}}]:[];
 const app=handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db});
 const {defaultPassport}=await import('../supabase/functions/studkab-requests/requirements.mjs');
 const response=await app(request({action:'passport-approve',id:requestId,passportId:'66666666-6666-4666-8666-666666666666',passport:defaultPassport({k:'Курсовая работа'}),sourceFingerprint:'a'.repeat(64)}));
 assert.equal(response.status,409);
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
 const withToc=c.window.ResultDocx({...doc,format:{...doc.format,toc:true}},doc.chapters);
 const tocZip=new TextDecoder().decode(await withToc.arrayBuffer());
 assert.match(tocZip,/<w:updateFields w:val="true"/);assert.match(tocZip,/Target="settings.xml"/);
 assert.doesNotMatch(tocZip,/ TOC /);assert.match(tocZip,/PAGEREF section_0/);assert.match(tocZip,/w:name="section_0"/);assert.match(tocZip,/w:anchor="section_0"/);
});

test('Word renumbers table captions, avoids forced section breaks and embeds stored figures',async()=>{
 const vm=await import('node:vm'),fs=await import('node:fs');
 const c={window:{},TextEncoder,Blob,Uint8Array,DataView,Date,Buffer};vm.runInNewContext(fs.readFileSync(new URL('../result-docx.js',import.meta.url),'utf8'),c);
 const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xee6WQAAAABJRU5ErkJggg==';
 const doc={topic:'Универсальный документ',student:'Тест',group:'Т-1',format:{toc:false},chapters:[{id:'a',name:'Раздел 1'},{id:'b',name:'Раздел 2'}],structure:{
  a:{text:'Таблица 7 — Первая\n| Показатель | Значение |\n| --- | --- |\n| А | 1 |'},
  b:{text:'Таблица 7 — Вторая\n| Показатель | Значение |\n| --- | --- |\n| Б | 2 |',figures:[{mimeType:'image/png',dataBase64:pixel,caption:'Рисунок 1 — Схема'}]}
 }};
 const bytes=new Uint8Array(await c.window.ResultDocx(doc,doc.chapters).arrayBuffer()),zip=new TextDecoder().decode(bytes);
 assert.match(zip,/Таблица 1 — Первая/);assert.match(zip,/Таблица 2 — Вторая/);assert.doesNotMatch(zip,/Таблица 7/);
 assert.equal((zip.match(/w:type="page"/g)||[]).length,1);assert.match(zip,/word\/media\/image1.png/);assert.match(zip,/rIdImage1/);assert.match(zip,/Рисунок 1 — Схема/);
});

test('result validation preserves safe PNG and JPEG figures only',async()=>{
 const {validateResult}=await import('../supabase/functions/studkab-requests/results.mjs');
 const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xee6WQAAAABJRU5ErkJggg==';
 const good={...documentFixture,structure:{intro:{text:'Текст',figures:[{mimeType:'image/png',dataBase64:pixel,caption:'Схема'}]}}};
 assert.equal(validateResult(good).structure.intro.figures[0].caption,'Схема');
 assert.throws(()=>validateResult({...good,structure:{intro:{text:'Текст',figures:[{mimeType:'image/svg+xml',dataBase64:pixel}]}}}),/изображения/);
 assert.throws(()=>validateResult({...good,structure:{intro:{text:'Текст',figures:[{mimeType:'image/png',dataBase64:pixel,widthMm:500}]}}}),/размеры изображений/);
});

test('delivery rejects unfinished placeholders in otherwise nonempty documents',async()=>{
 const {validateResult}=await import('../supabase/functions/studkab-requests/results.mjs');
 const base={topic:'Тема',chapters:[{id:'a',name:'Глава'}],structure:{a:{text:'[ДАННЫЕ СТУДЕНТА: прибыль]'}}};
 assert.throws(()=>validateResult(base),/не готов/);
 base.structure.a.text='[СФОРМУЛИРОВАТЬ САМОСТОЯТЕЛЬНО: вывод]';assert.throws(()=>validateResult(base),/не готов/);
});

test('Word export normalizes incomplete historical formatting without mutating it',async()=>{
 const vm=await import('node:vm'),fs=await import('node:fs');
 const c={window:{},TextEncoder,Blob,Uint8Array,DataView,Date};vm.runInNewContext(fs.readFileSync(new URL('../result-docx.js',import.meta.url),'utf8'),c);
 for(const format of [undefined,{}, {mLeft:'bad',mRight:null,size:999,spacing:0,indent:0}]){
  const doc={...documentFixture,format},before=JSON.stringify(doc);
  const xml=new TextDecoder().decode(await c.window.ResultDocx(doc,doc.chapters).arrayBuffer());
  assert.doesNotMatch(xml,/NaN|Infinity/);assert.match(xml,/w:left="1701"/);assert.match(xml,/w:right="850"/);
  assert.equal(JSON.stringify(doc),before);
 }
});

const versionId='33333333-3333-4333-8333-333333333333',reviewId='44444444-4444-4444-8444-444444444444',recipientId='55555555-5555-4555-8555-555555555555';
const binding={id:requestId,versionId,reviewId,recipientId,fileHash:'a'.repeat(64),documentHash:'b'.repeat(64)};
const codes=Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']);
const criteria=Object.fromEntries(codes.map(c=>[c,{status:'pass',evidence:'Synthetic review evidence, page 1'}]));
function resultApp(db){return handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db:async(path,method,body)=>path.startsWith('studkab_requests?')?[{id:requestId,student_id:recipientId,payload:{n:documentFixture.student}}]:db(path,method,body)});}
test('legacy delivery fails closed without invoking delivery RPC',async()=>{
 const app=resultApp(()=>{throw Error('must not call');});
 assert.equal((await app(request({action:'deliver',id:requestId,deliveryId,document:documentFixture}))).status,428);
});
test('prepare binds server recipient and rejects invalid file or changed recipient name',async()=>{
 let body;
 const app=resultApp(async(path,method,b)=>{assert.equal(path,'rpc/prepare_studkab_result');body=b;return{versionId};});
 const input={action:'prepare-result',id:requestId,versionId,document:documentFixture,docxBase64:'UEsDBAAAAAA='};
 assert.equal((await app(request({...input,docxBase64:'garbage'}))).status,400);
 assert.equal((await app(request({...input,document:{...documentFixture,student:'Someone else'}}))).status,409);
 assert.equal((await app(request(input))).status,200);assert.equal(body.recipient,recipientId);
});
test('per-criterion evidence is required; stale and recipient conflicts block delivery',async()=>{
 let calls=0,error=null;
 const app=resultApp(async()=>{calls++;return error?{error}:{reviewId,versionId};});
 for(const bad of [null,{}, {...criteria,C11:{status:'manual',evidence:'Not opened in Word'}},{...criteria,C10:{status:'fail',evidence:'Source did not support the claim'}},{...criteria,C03:{status:'pass',evidence:''}}])assert.equal((await app(request({...binding,action:'review-result',criteria:bad}))).status,400);
 assert.equal(calls,0);
 assert.equal((await app(request({...binding,action:'review-result',criteria}))).status,200);
 assert.equal((await app(request({...binding,action:'review-result',criteria:{...criteria,C08:{status:'not_applicable',evidence:'No calculations are required for this work'}}}))).status,200);
 assert.equal((await app(request({...binding,action:'deliver',deliveryId,recipientId:requestId}))).status,409);
 error='stale';assert.equal((await app(request({...binding,action:'deliver',deliveryId}))).status,409);
 error='review_required';assert.equal((await app(request({...binding,action:'deliver',deliveryId}))).status,428);
});
test('student receives stored bytes only for the current server recipient',async()=>{
 let allowed=true;
 const app=handler({auth:async()=>({...student,id:recipientId}),db:async(path)=>{
  if(path.startsWith('studkab_requests?'))return[{id:requestId,student_id:recipientId}];
  if(path.startsWith('studkab_results?'))return[{version_id:versionId,document:documentFixture}];
  return[{recipient_id:allowed?recipientId:requestId,docx_base64:'UEsDBAAAAAA=',file_hash:'a'.repeat(64)}];
 }});
 const res=await (await app(request({action:'result',id:requestId}))).json();assert.equal(res.result.docxBase64,'UEsDBAAAAAA=');
 allowed=false;assert.equal((await app(request({action:'result',id:requestId}))).status,409);
});
