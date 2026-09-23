import {defaultPassport} from '../supabase/functions/studkab-requests/requirements.mjs';
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
 const db=async(path,method,body)=>{calls.push({path,method,body});if(path==='rpc/studkab_material_manifest_check')return {valid:true};if(path.startsWith('studkab_requests?'))return[{id:requestId}];if(path.startsWith('studkab_requirement_passports?'))return [{items:passport.items}];if(path.startsWith('studkab_request_attachments?'))return [];return{id:'66666666-6666-4666-8666-666666666666',revision:1};};
 const app=handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db});
 const passport={title:'Требования',summary:'',items:defaultPassport({}).items.map(q=>({...q,text:'Конкретное условие',source:'Задание, с. 2',verified:true}))};
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

test('Word renumbers table captions and embeds stored figures without extra break paragraphs',async()=>{
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
function resultApp(db){return handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db:async(path,method,body)=>path==='rpc/studkab_material_manifest_check'?{valid:true}:path.startsWith('studkab_requests?')?[{id:requestId,student_id:recipientId,payload:{n:documentFixture.student}}]:path.startsWith('studkab_requirement_passports?')?[{id:requestId,status:'approved',items:[]}]:path.startsWith('studkab_request_attachments?')?[]:db(path,method,body)});}
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

const passportId='77777777-7777-4777-8777-777777777777';
const qualityEvidenceIds={internal_borrowing:'88888888-8888-4888-8888-888888888888',external_originality:'99999999-9999-4999-8999-999999999999'};
const reviewContext={passportId,sourceFingerprint:'c'.repeat(64),fingerprint:'d'.repeat(64)};
async function reviewStateApp(options={}){
 const {validateResult}=await import('../supabase/functions/studkab-requests/results.mjs');
 const document=validateResult({...documentFixture,reviewContext});const calls=[];
 const app=handler({auth:async()=>options.student?student:owner,config:async()=>({executor_email:owner.email}),db:async(path,method,body)=>{
  calls.push({path,method,body});
  if(path==='rpc/studkab_material_manifest_check')return {valid:true};
  if(path==='rpc/studkab_quality_check'){assert.equal(method,'POST');assert.deepEqual(body,{p_request:requestId,p_version:versionId});if(options.qualityUnavailable)throw Error('Quality unavailable');return {eligible:!options.qualityMissing,evidenceIds:options.qualityChanged?{...qualityEvidenceIds,internal_borrowing:requestId}:qualityEvidenceIds};}
  if(path==='rpc/studkab_result_context_version')return options.guardMissing?null:1;
  if(path.startsWith('studkab_requests?'))return [{id:requestId,student_id:recipientId}];
  if(path.startsWith('studkab_requirement_passports?'))return [{id:passportId,status:options.stalePassport?'stale':'approved',source_fingerprint:reviewContext.sourceFingerprint}];
  if(path.startsWith('studkab_result_versions?'))return options.empty?[]:[{id:versionId,revision:1,recipient_id:options.otherRecipient?requestId:recipientId,document:options.changed?{...document,topic:'Changed'}:document,file_hash:binding.fileHash,document_hash:binding.documentHash,docx_base64:'UEsDBAAAAAA='}];
  if(path.startsWith('studkab_results?'))return options.delivered?[{delivery_id:versionId,review_id:reviewId,created_at:'2026-09-19'}]:[];
  if(path.startsWith('studkab_result_reviews?'))return options.prepared?[]:[{id:reviewId,version_id:versionId,quality_evidence_ids:qualityEvidenceIds,criteria:options.badReview?{...criteria,C01:{status:'fail',evidence:'Failed content check'}}:criteria,created_at:'2026-09-19'}];
  throw Error('Unexpected write or query: '+path);
 }});return {app,document,calls};
}
test('C-071 review state is executor-only and never writes or exposes another recipient',async()=>{
 const denied=await reviewStateApp({student:true});assert.equal((await denied.app(request({action:'result-review-state',id:requestId,document:denied.document}))).status,403);assert.equal(denied.calls.length,0);
 for(const options of [{},{prepared:true},{delivered:true},{empty:true},{changed:true},{otherRecipient:true}]){
  const {app,document,calls}=await reviewStateApp(options);const response=await app(request({action:'result-review-state',id:requestId,document}));assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.state,options.empty?'none':options.changed||options.otherRecipient?'stale':options.delivered?'delivered':options.prepared?'prepared':'reviewed');
  assert(calls.every(c=>c.method===undefined||(c.path==='rpc/studkab_quality_check'&&c.method==='POST')));
  if(data.state==='stale')assert.equal(data.docxBase64,undefined);
  if(data.state==='reviewed'){assert.equal(data.review.reviewId,reviewId);assert.equal(data.receipt.versionId,versionId);assert.equal(data.docxBase64,'UEsDBAAAAAA=');}
 }
});
test('C102 stale quality evidence reopens exact Word review while historical delivery remains readable',async()=>{
 for(const options of [{qualityChanged:true},{qualityMissing:true}]){
  const {app,document}=await reviewStateApp(options);const response=await app(request({action:'result-review-state',id:requestId,document}));assert.equal(response.status,200);
  const state=await response.json();assert.equal(state.state,'prepared');assert.equal(state.reason,'quality_review_stale');assert.equal(state.review,null);assert.equal(state.receipt.versionId,versionId);assert.equal(state.docxBase64,'UEsDBAAAAAA=');
 }
 const historical=await reviewStateApp({delivered:true,qualityUnavailable:true});const response=await historical.app(request({action:'result-review-state',id:requestId,document:historical.document}));assert.equal(response.status,200);assert.equal((await response.json()).state,'delivered');assert(!historical.calls.some(c=>c.path==='rpc/studkab_quality_check'));
 const unavailable=await reviewStateApp({qualityUnavailable:true});assert.equal((await unavailable.app(request({action:'result-review-state',id:requestId,document:unavailable.document}))).status,503);
});
test('C-071 stale passport and failed stored review block recovery',async()=>{
 for(const options of [{stalePassport:true},{badReview:true}]){
  const {app,document}=await reviewStateApp(options);assert.equal((await app(request({action:'result-review-state',id:requestId,document}))).status,409);
 }
});
test('C-071 changed context/document blocks send before any mutation RPC',async()=>{
 const {app,document,calls}=await reviewStateApp();
 for(const value of [{...document,topic:'Edited'}, {...document,reviewContext:{...reviewContext,fingerprint:'e'.repeat(64)}}]){
  assert.equal((await app(request({...binding,action:'deliver',deliveryId:versionId,document:value}))).status,409);
 }
 assert(calls.every(c=>!c.path.startsWith('rpc/')||['rpc/studkab_result_context_version','rpc/studkab_material_manifest_check'].includes(c.path)));
});

test('C-071 new recovery fails closed before guard migration is installed',async()=>{
 const {app,document,calls}=await reviewStateApp({guardMissing:true});
 const response=await app(request({action:'result-review-state',id:requestId,document}));
 assert.equal(response.status,503);
 assert(calls.every(c=>!c.path.startsWith('studkab_result_versions?')));
});

test('C072 inbox refresh returns only server delivery metadata for existing requests',async()=>{
 let user=owner,reads=[];
 const id='11111111-1111-4111-8111-111111111111';
 const app=handler({auth:async()=>user,config:async()=>({executor_email:owner.email}),db:async path=>{
  reads.push(path);
  if(path.startsWith('studkab_requests?'))return [{id,number:6,payload:p}];
  assert.match(path,/select=delivery_id,version_id,created_at/);
  assert.match(path,/request_id=eq\.11111111/);
  return [{delivery_id:'receipt',version_id:'version',created_at:'2026-09-18T11:07:52Z'}];
 }});
 const r=await (await app(request({action:'inbox',includeDeliveryState:true}))).json();
 assert.equal(r.rows[0].deliveryState.last.versionId,'version');
 assert.equal(r.rows[0].deliveryState.last.createdAt,'2026-09-18T11:07:52Z');
 assert.equal(reads.length,2);
 user=student;reads=[];
 assert.equal((await app(request({action:'inbox',includeDeliveryState:true}))).status,403);
 assert.equal(reads.length,0);
});
test('C072 failed delivery read does not return an empty successful state',async()=>{
 const app=handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db:async path=>{
  if(path.startsWith('studkab_requests?'))return [{id:'11111111-1111-4111-8111-111111111111',number:6,payload:p}];
  throw Error('Offline');
 }});
 assert.equal((await app(request({action:'inbox',includeDeliveryState:true}))).status,503);
});

test('C078 Word starts sections on new pages and keeps table captions with rows',async()=>{
 const vm=await import('node:vm'),fs=await import('node:fs');
 const c={window:{},TextEncoder,Blob};vm.runInNewContext(fs.readFileSync(new URL('../result-docx.js',import.meta.url),'utf8'),c);
 const chapters=[{id:'a',name:'Введение'},{id:'b',name:'Глава 1'},{id:'app',name:'Приложение А'}];
 const doc={format:{toc:true},structure:{a:{text:'Текст введения.'},b:{text:'Таблица 1 — Данные\n| Текст | Число |\n| --- | --- |\n| Сохранить точно | 42 |'},app:{text:'Таблица А.1 — Приложение\n| Текст | Число |\n| --- | --- |\n| Сохранить тоже | 17 |'}}};
 const xml=new TextDecoder().decode(await c.window.ResultDocx(doc,chapters).arrayBuffer());
 assert.equal((xml.match(/<w:pageBreakBefore\/>/g)||[]).length,2);
 assert.match(xml,/<w:keepNext\/>[\s\S]*?Таблица 1 — Данные/);
 assert.match(xml,/<w:keepNext\/>[\s\S]*?Таблица А.1 — Приложение/);
 assert.match(xml,/Сохранить точно/);assert.match(xml,/Сохранить тоже/);
 const continuous=new TextDecoder().decode(await c.window.ResultDocx({...doc,format:{sectionPageBreaks:false}},chapters).arrayBuffer());
 assert.doesNotMatch(continuous,/<w:pageBreakBefore\/>/);
});
