import test from 'node:test';
import assert from 'node:assert/strict';
import {detect,verifyUpload} from '../supabase/functions/studkab-workflow/upload-check.mjs';
const enc=new TextEncoder();
const requestId='11111111-1111-4111-8111-111111111111',fileId='22222222-2222-4222-8222-222222222222',commandId='33333333-3333-4333-8333-333333333333';
function zip(names){
 const parts=[],central=[];let offset=0;
 for(const name of names){const n=enc.encode(name),local=new Uint8Array(30+n.length),lv=new DataView(local.buffer);lv.setUint32(0,0x04034b50,true);lv.setUint16(26,n.length,true);local.set(n,30);parts.push(local);const c=new Uint8Array(46+n.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(28,n.length,true);cv.setUint32(42,offset,true);c.set(n,46);central.push(c);offset+=local.length;}
 const size=central.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,names.length,true);v.setUint16(10,names.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
 const out=new Uint8Array(offset+size+end.length);let p=0;for(const x of [...parts,...central,end]){out.set(x,p);p+=x.length;}return out;
}

test('file signatures distinguish supported documents and reject disguised content',()=>{
 const pdf=enc.encode('%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF');
 assert.deepEqual(detect(pdf,'application/pdf'),{mime:'application/pdf',pages:1});
 assert.equal(detect(zip(['[Content_Types].xml','word/document.xml']),'application/vnd.openxmlformats-officedocument.wordprocessingml.document').mime,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 assert.equal(detect(enc.encode('PK fake word/document.xml'),'application/vnd.openxmlformats-officedocument.wordprocessingml.document').error,'invalid_zip');
 assert.equal(detect(enc.encode('plain text'),'application/pdf').error,'signature_mismatch');
 assert.equal(detect(new Uint8Array([65,0,66,67]),'text/plain').error,'binary_text');
});

test('server binds verification to owner metadata and records its own hash',async()=>{
 const bytes=enc.encode('a;b\n1;2'),calls=[];
 const db=async(path,method,body)=>{calls.push({path,method,body});if(path.startsWith('studkab_request_files?'))return {id:fileId,storage_path:requestId+'/'+fileId+'/1',declared_mime:'text/csv',size_bytes:bytes.length,state:'uploading'};return {fileId,state:'accepted'};};
 const result=await verifyUpload({base:'https://project.test',key:'server-secret',input:{requestId,commandId,payload:{fileId}},user:{id:'44444444-4444-4444-8444-444444444444'},db,request:async()=>new Response(bytes,{headers:{'content-length':String(bytes.length)}})});
 assert.equal(result.state,'accepted');assert.equal(calls[1].path,'rpc/studkab_accept_upload');assert.match(calls[1].body.payload.sha256,/^[0-9a-f]{64}$/);assert.equal(calls[1].body.payload.accepted,true);
 assert.match(calls[0].path,/student_id=eq\.44444444/);
});

test('a rejected signature cannot be accepted by the browser',async()=>{
 const bytes=enc.encode('not a pdf'),calls=[];
 const db=async(path,method,body)=>{calls.push({path,body});if(path.startsWith('studkab_request_files?'))return {id:fileId,storage_path:'a/b/1',declared_mime:'application/pdf',size_bytes:bytes.length,state:'uploading'};return {fileId,state:'rejected'};};
 const result=await verifyUpload({base:'https://project.test',key:'secret',input:{requestId,commandId,payload:{fileId}},user:{id:'44444444-4444-4444-8444-444444444444'},db,request:async()=>new Response(bytes)});
 assert.equal(result.state,'rejected');assert.equal(calls[1].body.payload.accepted,false);assert.equal(calls[1].body.payload.rejectionCode,'signature_mismatch');
});
