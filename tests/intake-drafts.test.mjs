import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
import {saveOriginal} from '../supabase/functions/studkab-requests/original-storage.mjs';
import {attachmentDownloadUrl} from '../supabase/functions/studkab-requests/download-url.mjs';
import {schema,student,other,apiDatabase} from './intake-fixture.mjs';
const pdf='application/pdf',docx='application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function material(name='data.pdf',bytes=Buffer.from('%PDF-test original')){return {fileName:name,contentType:name.endsWith('.pdf')?pdf:name.endsWith('.xlsx')?xlsx:docx,sizeBytes:bytes.length,base64:bytes.toString('base64'),fileHash:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')};}
async function fixture(){
 const db=new PGlite();await db.exec(schema());await db.exec('set role service_role');
 const objects=new Map();let who=student,member=true,writes=0;
 const deps={db:apiDatabase(db),isMember:async()=>member,auth:async()=>({id:who,email:'student@example.test',email_confirmed_at:'2026-01-01'}),
  saveIntake:async(path,type,bytes,hash)=>{writes++;assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),hash);objects.set(path,bytes);},
  downloadIntake:async(path,fileName)=>{assert.ok(objects.has(path));return {url:'https://signed.example/'+path,fileName};},
  upload:async()=>{throw Error('legacy extraction must not run');},send:async()=>{throw Error('draft must not notify');}};
 const app=handler(deps),call=async body=>{const r=await app(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(body)}));return {status:r.status,...await r.json()};};
 return {db,objects,deps,call,get writes(){return writes;},setUser(id){who=id;},setMember(value){member=value;}};
}
test('private blank draft resumes without required request fields; original DOCX/PDF/XLSX are saved before analysis',async()=>{
 const f=await fixture();try{
  const opened=await f.call({action:'intake-open'});assert.equal(opened.status,200);assert.equal(opened.draft.state,'open');
  for(const [name,bytes] of [['data.pdf',Buffer.from('%PDF-original')],['assignment.docx',Buffer.from([80,75,3,4,1])],['calculations.xlsx',Buffer.from([80,75,3,4,2])]]){
   const r=await f.call({action:'intake-upload',id:opened.draft.id,...await material(name,bytes)});assert.equal(r.status,200);assert.equal(r.file.state,'saved');assert.equal(r.file.roles.length,0);assert.equal(r.file.storage_path,undefined);
  }
  const resumed=await f.call({action:'intake-open'});assert.equal(resumed.draft.id,opened.draft.id);assert.equal(resumed.files.length,3);
  assert.equal((await f.db.query('select count(*)::int n from studkab_intake_drafts')).rows[0].n,1);
  assert.equal(f.objects.size,3);
 }finally{await f.db.close();}
});
test('lost reserve/finish responses and repeat uploads preserve one file, one immutable path and saved bytes',async()=>{
 const f=await fixture();try{
  const {draft}=await f.call({action:'intake-open'}),body={action:'intake-upload',id:draft.id,...await material()};
  const original=f.deps.db;let lose='reserve';
  f.deps.db=async(path,...args)=>{const r=await original(path,...args);if(lose&&path.endsWith(lose)){lose='';throw Error('lost response');}return r;};
  // handler captured db at construction; create a new handler for fault injection.
  const app=handler(f.deps),call=async()=>{const r=await app(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(body)}));return {status:r.status,...await r.json()};};
  assert.equal((await call()).status,503);assert.equal(f.objects.size,0);
  lose='finish';assert.equal((await call()).status,503);assert.equal(f.objects.size,1);
  const saved=await call();assert.equal(saved.status,200);assert.equal(saved.duplicate,true);assert.equal(f.writes,1);
  assert.equal((await f.call({action:'intake-open'})).files.length,1);
 }finally{await f.db.close();}
});
test('same-purpose files coexist; replacement preserves its predecessor until new bytes are confirmed',async()=>{
 const f=await fixture();try{
  const {draft}=await f.call({action:'intake-open'}),upload=async(name,bytes,replacesId)=>f.call({action:'intake-upload',id:draft.id,...await material(name,bytes),replacesId});
  const one=await upload('data-one.pdf',Buffer.from('%PDF-one')),two=await upload('data-two.pdf',Buffer.from('%PDF-two'));
  assert.notEqual(one.file.id,two.file.id);
  const version=await material('data-new.pdf',Buffer.from('%PDF-new'));
  const reservation=await f.deps.db('rpc/studkab_intake_reserve','POST',{p_student:student,p_draft:draft.id,p_name:version.fileName,p_type:pdf,p_size:version.sizeBytes,p_hash:version.fileHash,p_supersedes:one.file.id});
  assert.equal(reservation.file.state,'pending');assert.equal((await f.call({action:'intake-download',id:draft.id,fileId:one.file.id})).status,200);
  const next=await upload('data-new.pdf',Buffer.from('%PDF-new'));assert.equal(next.file.supersedes,one.file.id);
  assert.equal((await f.call({action:'intake-open'})).files.length,3);
  await assert.rejects(()=>f.db.query("update studkab_intake_files set file_hash=$1 where id=$2",['b'.repeat(64),one.file.id]),/IMMUTABLE/);
 }finally{await f.db.close();}
});
test('foreign account, revoked member and invalid hash/format fail before storage access',async()=>{
 const f=await fixture();try{
  const {draft}=await f.call({action:'intake-open'}),body={action:'intake-upload',id:draft.id,...await material()};
  f.setUser(other);assert.equal((await f.call(body)).status,404);assert.equal((await f.call({action:'intake-download',id:draft.id,fileId:crypto.randomUUID()})).status,404);
  f.setUser(student);f.setMember(false);assert.equal((await f.call(body)).status,403);f.setMember(true);
  for(const patch of [{fileHash:'a'.repeat(64)},{contentType:'text/plain'},{fileName:'photo.jpg'},{fileName:'a.xlsx',contentType:xlsx},{sizeBytes:5242881}])assert.equal((await f.call({...body,...patch})).status,400);
  assert.equal(f.writes,0);assert.equal((await f.call({action:'intake-open'})).files.length,0);
 }finally{await f.db.close();}
});
test('draft notes use optimistic revision, upload reservations bound eight independent documents; browser roles cannot read/RPC',async()=>{
 const f=await fixture();try{
  const {draft}=await f.call({action:'intake-open'});
  const notes={action:'intake-notes',id:draft.id,revision:draft.revision,notes:'Уточнение студента'};
  assert.equal((await f.call(notes)).draft.notes,notes.notes);assert.equal((await f.call(notes)).status,409);
  for(let i=0;i<8;i++)assert.equal((await f.call({action:'intake-upload',id:draft.id,...await material('data.pdf',Buffer.from('%PDF-'+i))})).status,200);
  assert.equal((await f.call({action:'intake-upload',id:draft.id,...await material('extra.pdf',Buffer.from('%PDF-extra'))})).status,429);
  assert.equal(f.writes,8);
  let predecessor=(await f.call({action:'intake-open'})).files[0].id,quota;
  for(let i=0;i<20;i++){
   const h=(i+100).toString(16).padStart(64,'0');
   quota=await f.deps.db('rpc/studkab_intake_reserve','POST',{p_student:student,p_draft:draft.id,p_name:'version.pdf',p_type:pdf,p_size:5242880,p_hash:h,p_supersedes:predecessor});
   if(quota.quota)break;
   await f.deps.db('rpc/studkab_intake_finish','POST',{p_student:student,p_draft:draft.id,p_file:quota.file.id,p_hash:h});predecessor=quota.file.id;
  }
  assert.equal(quota.quota,true);assert.ok((await f.db.query('select sum(size_bytes)::int n from studkab_intake_files')).rows[0].n<=104857600);
  await f.db.exec("reset role;insert into storage.objects values('studkab-intake-materials','private'),('legacy-bucket','legacy');set role service_role");
  for(const role of ['anon','authenticated']){
   await f.db.exec('set role '+role);
   await assert.rejects(()=>f.db.query('select * from studkab_intake_drafts'),/permission denied/);
   await assert.rejects(()=>f.db.query('select studkab_intake_open($1)',[student]),/permission denied/);
   assert.deepEqual((await f.db.query('select name from storage.objects')).rows,[{name:'legacy'}]);
   await assert.rejects(()=>f.db.query("insert into storage.objects values('studkab-intake-materials','forged')"),/row-level security/);
  }
 }finally{await f.db.close();}
});
test('storage recovers a lost POST only by checking the exact original; never overwrites or trusts mismatching bytes',async()=>{
 const bytes=Buffer.from('%PDF-original'),m=await material('a.pdf',bytes);let calls=[];
 const args={base:'https://project.supabase.co',key:'offline-test',path:'owner/draft/file',type:pdf,bytes,hash:m.fileHash};
 await saveOriginal({...args,fetcher:async(url,o)=>{calls.push(o);return o.method==='POST'?new Response('',{status:409}):new Response(bytes);}});
 assert.equal(calls[0].headers['x-upsert'],'false');assert.equal(calls.length,2);
 await assert.rejects(()=>saveOriginal({...args,fetcher:async(url,o)=>o.method==='POST'?new Response('',{status:409}):new Response(Buffer.from('%PDF-different'))}),/mismatch/);
 const signed=attachmentDownloadUrl(args.base,'/object/sign/studkab-intake-materials/owner/draft/file?token=synthetic','owner/draft/file','a.pdf','studkab-intake-materials');
 assert.match(signed,/studkab-intake-materials/);
 assert.throws(()=>attachmentDownloadUrl(args.base,'/object/sign/studkab-request-materials/owner/draft/file?token=x','owner/draft/file','a.pdf','studkab-intake-materials'),/unavailable/);
});
