import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {attachmentAction} from '../supabase/functions/studkab-requests/attachments.mjs';
import {attachmentDownloadUrl} from '../supabase/functions/studkab-requests/download-url.mjs';

test('Storage REST signed paths download the authorized object with a safe filename',()=>{
 const base='https://project.supabase.co',path='owner/request/file';
 for(const prefix of ['/object/sign/','/storage/v1/object/sign/']){
  const result=new URL(attachmentDownloadUrl(base,prefix+'studkab-request-materials/'+path+'?token=test-token',path,'Методичка & данные.txt'));
  assert.equal(result.origin,base);
  assert.equal(result.pathname,'/storage/v1/object/sign/studkab-request-materials/'+path);
  assert.equal(result.searchParams.get('token'),'test-token');
  assert.equal(result.searchParams.get('download'),'Методичка & данные.txt');
 }
});
test('signed download rejects foreign hosts, objects, public paths and missing tokens',()=>{
 const valid='/object/sign/studkab-request-materials/owner/request/file?token=test-token';
 for(const signed of [undefined,'','https://foreign.example'+valid,'//foreign.example'+valid,valid.replace('/file?','/other?'),valid.replace('/sign/','/public/'),valid.split('?')[0],valid+'#fragment']){
  assert.throws(()=>attachmentDownloadUrl('https://project.supabase.co',signed,'owner/request/file','a.txt'),/Storage unavailable/);
 }
});
const student={id:'11111111-1111-4111-8111-111111111111',email:'student@example.test'};
const executor={id:'22222222-2222-4222-8222-222222222222',email:'executor@example.test'};
const request='33333333-3333-4333-8333-333333333333';
function deps(){let uploaded=0,removed=[];let inserted=[];return {get uploaded(){return uploaded},get inserted(){return inserted},get removed(){return removed},config:async()=>({executor_email:executor.email}),upload:async()=>{uploaded++;return 'trusted extracted text'},remove:async path=>removed.push(path),download:async()=>({url:'https://signed.example/file',expiresIn:300}),db:async(path,method,body)=>{
 if(path.startsWith('studkab_requests?'))return [{id:request,student_id:student.id}];
 if(path.startsWith('studkab_requirement_passports?'))return [];
 if(path==='studkab_request_attachments'&&method==='POST'){inserted.push(body);return [body];}
 if(path.startsWith('studkab_request_attachments?request_id='))return [];
 if(path.startsWith('studkab_request_attachments?id=')&&path.includes('&select=id,'))return [];
 if(path.startsWith('studkab_request_attachments?id='))return [{storage_path:student.id+'/'+request+'/file',file_name:'a.txt'}];
 throw Error('unexpected '+path);
}}}
const valid={action:'attachment-upload',id:request,fileName:'a.txt',contentType:'text/plain',category:'assignment',sizeBytes:3,fileHash:'a'.repeat(64),base64:'YWJj'};
test('student attachment is bound to owner and immutable request path',async()=>{const d=deps(),r=await attachmentAction(valid,student,d);assert.equal(r.status,200);assert.equal(d.uploaded,1);assert.equal(d.inserted[0].student_id,student.id);assert.match(d.inserted[0].storage_path,new RegExp('^'+student.id+'/'+request+'/'));});
test('executor may list and download but may not upload for student',async()=>{const d=deps();assert.equal((await attachmentAction({action:'attachment-list',id:request},executor,d)).status,200);assert.equal((await attachmentAction({action:'attachment-download',id:request,attachmentId:'44444444-4444-4444-8444-444444444444'},executor,d)).status,200);assert.equal((await attachmentAction(valid,executor,d)).status,403);});
test('only executor may obtain extracted attachment context',async()=>{const d=deps();assert.equal((await attachmentAction({action:'attachment-context',id:request},executor,d)).status,200);assert.equal((await attachmentAction({action:'attachment-context',id:request},student,d)).status,403);});
test('executor role takes precedence when executor owns the test request',async()=>{const d=deps(),original=d.db;d.db=async(path,method,body)=>path.startsWith('studkab_requests?')?[{id:request,student_id:executor.id}]:original(path,method,body);assert.equal((await attachmentAction({action:'attachment-context',id:request},executor,d)).status,200);assert.equal((await attachmentAction(valid,executor,d)).status,403);});
test('foreign student sees request-not-found response and cannot touch storage',async()=>{const d=deps(),other={id:'55555555-5555-4555-8555-555555555555',email:'other@example.test'};const r=await attachmentAction(valid,other,d);assert.equal(r.status,404);assert.equal(d.uploaded,0);});
test('invalid type, size, hash and base64 fail before storage',async()=>{for(const change of [{contentType:'text/html'},{sizeBytes:5242881},{fileHash:'x'},{base64:'bad!'}]){const d=deps(),r=await attachmentAction({...valid,...change},student,d);assert.equal(r.status,400);assert.equal(d.uploaded,0);}});
test('failed metadata insert removes the uploaded object',async()=>{const d=deps(),original=d.db;d.db=async(path,method,body)=>path==='studkab_request_attachments'&&method==='POST'?Promise.reject(Error('database unavailable')):original(path,method,body);await assert.rejects(()=>attachmentAction(valid,student,d));assert.equal(d.uploaded,1);assert.equal(d.removed.length,1);});
test('migration keeps files private, metadata service-only and concurrent count bounded',()=>{const sql=fs.readFileSync(new URL('../supabase/migrations/20260917144051_studkab_request_attachments.sql',import.meta.url),'utf8');assert.match(sql,/values\('studkab-request-materials','studkab-request-materials',false,/);assert.match(sql,/enable row level security/);assert.match(sql,/revoke all on public\.studkab_request_attachments from public,anon,authenticated/);assert.match(sql,/grant select,insert on public\.studkab_request_attachments to service_role/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/>= 8/);assert.match(sql,/before update[\s\S]*studkab_request_attachments/);});
test('passport fingerprint initializes a document before DraftEditor reads its order',()=>{const html=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');assert.match(html,/async function passportFingerprint\(x\)\{\s*docOf\(x\);\s*var bytes=new TextEncoder\(\)\.encode\(DraftEditor\.basis\(x\)\)/);});
test('editor keeps immutable student attachments out of manual input fields',()=>{const js=fs.readFileSync(new URL('../draft-editor.js',import.meta.url),'utf8');assert.match(js,/function editableInputs\(x\)/);assert.match(js,/function form\(x\)\{\s*var p=editableInputs\(x\)/);assert.match(js,/function read\(w,x\)\{var p=editableInputs\(x\)/);assert.match(js,/if\(fin\)fin\.value=editableInputs\(x\)\.finance/);});
test('editor removes legacy attachment copies from manual fields before rendering',()=>{const js=fs.readFileSync(new URL('../draft-editor.js',import.meta.url),'utf8'),context={window:{},esc:s=>String(s),DraftQuality:{inputs:()=>({}),financial:()=>false,extended:()=>false,headers:[]}};vm.runInNewContext(js,context);const attachment='immutable attachment text',separator='\n\n--- ФАЙЛЫ СТУДЕНТА ---\n\n',x={org:'Test',requirements:'Requirement',doc:{inputs:{materials:attachment+separator+attachment,sources:attachment},attachmentMaterials:attachment,attachmentSources:attachment}};const html=context.window.DraftEditor.form(x);assert.doesNotMatch(html,/immutable attachment text/);assert.equal(x.doc.inputs.materials,attachment+separator+attachment);assert.equal(x.doc.inputs.sources,attachment);});

test('lost insert response keeps a committed attachment and confirms the saved row',async()=>{
 const d=deps(),original=d.db;let saved;
 d.db=async(path,method,body)=>{
  if(path==='studkab_request_attachments'&&method==='POST'){saved=body;throw Error('response lost');}
  if(path.startsWith('studkab_request_attachments?id=')&&path.includes('&select=id,'))return [saved];
  return original(path,method,body);
 };
 const result=await attachmentAction(valid,student,d);
 assert.equal(result.status,200);assert.equal(result.data.attachment.id,saved.id);assert.equal(d.removed.length,0);
});
test('unknown metadata outcome leaves uploaded bytes intact for reconciliation',async()=>{
 const d=deps(),original=d.db;
 d.db=async(path,method,body)=>{
  if(path==='studkab_request_attachments'&&method==='POST')throw Error('response lost');
  if(path.startsWith('studkab_request_attachments?id=')&&path.includes('&select=id,'))throw Error('read unavailable');
  return original(path,method,body);
 };
 await assert.rejects(()=>attachmentAction(valid,student,d),/response lost/);assert.equal(d.removed.length,0);
});
