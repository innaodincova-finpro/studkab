import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {handler,validatePayload} from '../supabase/functions/studkab-requests/handler.mjs';
import {attachmentAction} from '../supabase/functions/studkab-requests/attachments.mjs';
import {currentAttachments} from '../supabase/functions/_shared/current-attachments.mjs';
import {sourceMinimumGuard} from '../supabase/functions/_shared/source-minimum.mjs';
const student='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const a='33333333-3333-4333-8333-333333333333',b='44444444-4444-4444-8444-444444444444',c='55555555-5555-4555-8555-555555555555';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20260921050532_c080_request_resubmission.sql');
test('SQL: owner update, CAS, immutable old files, explicit replacement, freeze and access',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit int,allowed_mime_types text[]);`);
 await db.exec(read('request-delivery.sql'));
 await db.exec(read('supabase/migrations/20260917144051_studkab_request_attachments.sql'));
 await db.exec(`alter table studkab_requests add column deleting_at timestamptz;
 create table studkab_requirement_passports(id uuid,request_id uuid);
 create table studkab_gen_jobs(id uuid,request_id text);
 insert into auth.users values('${student}'),('${other}');`);
 await db.exec(migration);
 const initial={id:'test',t:'Old',cn:'test'},changed={...initial,t:'New',n:'Test Student',d:'Discipline'};
 const req=(await db.query('select submit_studkab_request($1,$2) value',[student,initial])).rows[0].value;
 const update=async(who,expected,content)=>(await db.query('select update_studkab_request($1,$2,$3,$4) value',[req.id,who,expected,content])).rows[0].value;
 assert.equal((await update(other,initial,changed)).missing,true);
 assert.equal((await update(student,{},changed)).conflict,true);
 await db.exec('grant select on studkab_requirement_passports,studkab_gen_jobs to service_role; set role service_role');
 assert.equal((await update(student,initial,changed)).number,req.number);
 await db.exec('reset role');
 assert.equal((await update(student,initial,changed)).duplicate,true);
 assert.equal((await update(student,initial,{...changed,t:'Stale'})).conflict,true);
 assert.deepEqual((await db.query('select payload from studkab_request_payload_history')).rows.map(x=>x.payload),[initial]);
 const insert=(id,h,sup=null,category='assignment')=>db.query(`insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text,supersedes) values($1,$2,$3,$4,'test.txt','text/plain',3,$5,$1::uuid::text,'abc',$6)`,[id,req.id,student,category,h.repeat(64),sup]);
 await insert(a,'a');
 await assert.rejects(insert(b,'b'),/Explicit replacement/);
 await assert.rejects(insert(b,'b',a,'sources'),/version conflict/);
 await insert(b,'b',a);
 await assert.rejects(insert(c,'c',a),/version conflict/);
 await assert.rejects(db.query("update studkab_request_attachments set extracted_text='changed' where id=$1",[a]),/Immutable/);
 const rows=(await db.query('select * from studkab_request_attachments')).rows;
 assert.equal(rows.length,2);assert.deepEqual(currentAttachments(rows).map(x=>x.id),[b]);
 await db.query('insert into studkab_requirement_passports values($1,$2)',[c,req.id]);
 assert.equal((await update(student,changed,{...changed,t:'After preparation'})).locked,true);
 await assert.rejects(insert(c,'c',b),/Preparation already started/);
 await db.query('update studkab_requests set deleting_at=now() where id=$1',[req.id]);
 assert.equal((await update(student,changed,changed)).missing,true);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(db.query('select update_studkab_request($1,$2,$3,$4)',[req.id,student,changed,changed]),/permission denied/);
  await assert.rejects(db.query('select * from studkab_request_payload_history'),/permission denied/);
  await db.exec('reset role');
 }
 }finally{await db.close();}
});
test('Edge binds update to authenticated student and reports conflicts without saved:true',async()=>{
 let body,found=true,result={id:a,number:9};
 const app=handler({auth:async()=>({id:student,email:'student@example.test',email_confirmed_at:'yes'}),isMember:async()=>true,db:async(path,method,data)=>{
  if(path.startsWith('studkab_requests?')){assert.ok(path.includes('student_id=eq.'+student));return found?[{id:a,payload:{}}]:[];}
  body=data;return result;
 }});
 const call=async()=>app(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({action:'update-request',id:a,student_id:other,expectedPayload:{},payload:{id:'test',t:'New',cn:'test'}})}));
 assert.equal((await (await call()).json()).saved,true);assert.equal(body.p_student,student);
 result={conflict:true};assert.equal((await call()).status,409);
 result={locked:true};assert.equal((await call()).status,409);
 found=false;assert.equal((await call()).status,404);
});
test('attachment replacement keeps history out of context and source minimum guard',async()=>{
 const history=[{id:a,category:'assignment',file_hash:'a'.repeat(64),extracted_text:'Не менее 10 источников.'},{id:b,supersedes:a,category:'assignment',file_hash:'b'.repeat(64),extracted_text:'Не менее 5 источников.'}];
 const deps={config:async()=>({executor_email:'executor@example.test'}),db:async path=>path.startsWith('studkab_requests?')?[{id:c,student_id:student}]:history};
 const result=await attachmentAction({action:'attachment-context',id:c},{id:other,email:'executor@example.test'},deps);
 assert.deepEqual(result.data.attachments.map(x=>x.id),[b]);
 assert.equal(await sourceMinimumGuard(async()=>history,c,[{text:'Не менее 5 источников.'}]),null);
 const retry=await attachmentAction({action:'attachment-upload',id:c,fileName:'new.txt',category:'assignment',contentType:'text/plain',fileHash:'b'.repeat(64),sizeBytes:3,base64:'YWJj',replacesId:a},{id:student,email:'student@example.test'},deps);
 assert.equal(retry.data.duplicate,true);
});
test('cabinet sends an update and replacement id instead of faking successful resubmission',async()=>{
 const html=read('index.html'),start=html.indexOf('async function uploadRequestFiles('),end=html.indexOf('function openRequest(',start);
 const uploads=[];const context={Oblako:{requestApi:async input=>{if(input.action==='attachment-list')return {attachments:[{id:a,category:'assignment',file_hash:'a'.repeat(64)}]};uploads.push(input);return{};}},requestFilePayload:async()=>({fileHash:'b'.repeat(64)})};
 vm.createContext(context);vm.runInContext(html.slice(start,end),context);
 const count=await context.uploadRequestFiles({querySelectorAll:()=>[{files:[{}],dataset:{requestFile:'assignment'}}]},c,{});
 assert.equal(count,1);assert.equal(uploads[0].replacesId,a);
 assert.doesNotMatch(html,/r\.serverId\?Promise\.resolve\(\{saved:true/);
 assert.match(html,/action:'update-request',id:r.serverId,expectedPayload:state.payload/);
});
test('repeat submit waits for real server acknowledgement; error keeps form open and sent unchanged',async()=>{
 const html=read('index.html'),code=html.slice(html.indexOf('function openRequest('),html.indexOf('function icsEscape('));
 for(const fail of [false,true]){
  let click,removed=false;const calls=[],messages=[],r={id:'client',serverId:a,number:9,sent:'before'};
  const wrap={addEventListener:(_,fn)=>{click=fn;},querySelector:()=>({value:'test'}),remove:()=>{removed=true;}};
  const api=async input=>{calls.push(input);if(input.action==='request-state')return {payload:{id:'client',t:'old'}};if(fail)throw Error('Server unavailable');if(input.action==='request-publish')return {ready:true,number:9};return {saved:true,id:a,number:9};};
 const context={work:()=>({topic:'new',req:r}),openModal:()=>wrap,esc:x=>x||'',tooLongFields:()=>[],D:{},window:{Oblako:{}},Oblako:{requestApi:api},requestPayload:probe=>({id:probe.req.id,t:probe.topic}),prepareRequestFiles:async()=>[],uploadRequestFiles:async()=>4,change:fn=>fn(),today:()=> 'today',render:()=>{},toast:x=>messages.push(x)};
  vm.createContext(context);vm.runInContext(code,context);context.openRequest('work');
  const btn={disabled:false,getAttribute:()=> 'direct'};click({target:{closest:()=>btn}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[1].action,'update-request');assert.equal(calls[1].payload.t,'new');assert.equal(calls[1].expectedPayload.t,'old');
  assert.equal(removed,!fail);assert.equal(r.sent,fail?'before':'today');assert.equal(btn.disabled,false);
  assert.equal(messages.some(x=>x.includes('сохранена в реестре')), !fail);
 }
});
test('registry applies revised submission once and keeps executor document and notes',async()=>{
 const html=read('reestr.html');
 const merge=html.slice(html.indexOf('function mergeInto('),html.indexOf('var FMT_FIELDS'));
 const receive=html.slice(html.indexOf('async function receiveInbox('),html.indexOf('function viewList('));
 const doc={text:'Keep document'},existing={id:a,topic:'Old',status:'work',note:'Private note',doc,added:'before',submissionRevision:0};
 const context={inboxBusy:false,D:{items:[existing]},window:{Oblako:{}},Oblako:{identity:()=>student,requestApi:async()=>({rows:[{id:a,number:9,revision:1,payload:{t:'New'}}]})},location:{hash:''},fromPayload:p=>({id:p.id,topic:p.t,status:'new',note:''}),item:()=>existing,save:()=>true,render:()=>{},toast:()=>{},today:()=> 'today'};
 vm.createContext(context);vm.runInContext(merge+receive,context);await context.receiveInbox();
 assert.equal(existing.topic,'New');assert.equal(existing.note,'Private note');assert.equal(existing.doc,doc);assert.equal(existing.status,'work');assert.equal(existing.added,'before');
 existing.topic='Executor local correction';await context.receiveInbox();assert.equal(existing.topic,'Executor local correction');
});

test('partial send checkpoints request, retries same id, and never reports failed files as complete',async()=>{
 const html=read('index.html'),code=html.slice(html.indexOf('function openRequest('),html.indexOf('function icsEscape('));
 let click,removed=false,attempt=0;const calls=[],r={id:'client'},status={};
 const wrap={addEventListener:(_,fn)=>{click=fn;},querySelector:s=>s==='[data-request-status]'?status:{value:'test'},remove:()=>{removed=true;}};
 const context={work:()=>({topic:'new',req:r}),openModal:()=>wrap,esc:x=>x||'',tooLongFields:()=>[],D:{},window:{Oblako:{}},Oblako:{requestApi:async input=>{calls.push(input);if(input.action==='request-state')return {payload:{id:'client',t:'new'}};if(input.action==='request-publish')return {ready:true,number:9};return {saved:true,id:a,number:9};}},requestPayload:p=>({id:p.req.id,t:p.topic}),prepareRequestFiles:async()=>['assignment','methodology','data','sources'].map(category=>({category,fileHash:'a'.repeat(64),fileName:category+'.txt'})),uploadRequestFiles:async()=>{if(++attempt===1)throw Error('Upload failed');return 4;},change:fn=>fn(),today:()=> 'today',render:()=>{},toast:()=>{}};
 vm.createContext(context);vm.runInContext(code,context);context.openRequest('work');
 const btn={disabled:false,getAttribute:()=> 'direct'};
 click({target:{closest:()=>btn}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.serverId,a);assert.equal(r.sent,undefined);assert.equal(r.filesPending,true);assert.equal(r.pendingFiles.length,4);assert.equal(removed,false);assert.match(status.textContent,/ожидает полный комплект/);
 click({target:{closest:()=>btn}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(x=>x.action==='submit').length,1);assert.equal(calls.filter(x=>x.action==='update-request').length,1);
 assert.equal(calls.filter(x=>x.action==='request-publish').length,1);
 assert.equal(r.filesPending,false);assert.equal(r.pendingFiles.length,0);assert.equal(r.sent,'today');assert.equal(removed,true);
});

test('invalid selected file is rejected before submitting a new request',async()=>{
 const html=read('index.html'),code=html.slice(html.indexOf('function openRequest('),html.indexOf('function icsEscape('));
 let click;const calls=[],r={id:'client'},status={};
 const wrap={addEventListener:(_,fn)=>{click=fn;},querySelector:s=>s==='[data-request-status]'?status:{value:'test'}};
 const context={work:()=>({topic:'new',req:r}),openModal:()=>wrap,esc:x=>x||'',tooLongFields:()=>[],D:{},window:{Oblako:{}},Oblako:{requestApi:async x=>calls.push(x)},prepareRequestFiles:async()=>{throw Error('Invalid file');},toast:()=>{}};
 vm.createContext(context);vm.runInContext(code,context);context.openRequest('work');
 const btn={disabled:false,getAttribute:()=> 'direct'};click({target:{closest:()=>btn}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,0);assert.equal(r.serverId,undefined);assert.equal(btn.disabled,false);assert.match(status.textContent,/Invalid file/);
});
test('three selected categories never create a visible or pending server request',async()=>{
 const html=read('index.html'),code=html.slice(html.indexOf('function openRequest('),html.indexOf('function icsEscape('));
 let click;const calls=[],r={id:'client'},status={};
 const wrap={addEventListener:(_,fn)=>{click=fn;},querySelector:s=>s==='[data-request-status]'?status:{value:'test'}};
 const context={work:()=>({topic:'new',req:r}),openModal:()=>wrap,esc:x=>x||'',tooLongFields:()=>[],D:{},window:{Oblako:{}},Oblako:{requestApi:async x=>calls.push(x)},prepareRequestFiles:async()=>['assignment','methodology','data'].map(category=>({category,fileHash:'a'.repeat(64)})),toast:()=>{}};
 vm.createContext(context);vm.runInContext(code,context);context.openRequest('work');
 const btn={disabled:false,getAttribute:()=> 'direct'};click({target:{closest:()=>btn}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,0);assert.equal(r.serverId,undefined);assert.match(status.textContent,/задание, методичку, исходные данные и источники/);
});

test('retry skips acknowledged files and refuses to complete with missing pending material',async()=>{
 const html=read('index.html'),code=html.slice(html.indexOf('async function uploadRequestFiles('),html.indexOf('function openRequest('));
 const uploads=[],file={fileHash:'a'.repeat(64),category:'assignment'},missing={fileHash:'b'.repeat(64),category:'sources'};
 const context={Oblako:{requestApi:async input=>{if(input.action==='attachment-list')return {attachments:[{id:a,category:'assignment',file_hash:file.fileHash}]};uploads.push(input);return{};}}};
 vm.createContext(context);vm.runInContext(code,context);
 const wrap={querySelectorAll:()=>[]};
 await assert.rejects(context.uploadRequestFiles(wrap,c,{},[file],[file,missing]),/Не все/);
 assert.equal(uploads.length,0);
 assert.equal(await context.uploadRequestFiles(wrap,c,{},[file,missing],[file,missing]),2);
 assert.equal(uploads.length,1);assert.equal(uploads[0].category,'sources');
});
