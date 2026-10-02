import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';import {DOMParser} from '@xmldom/xmldom';
import {schema,submissionExtension,student,other,apiDatabase} from './intake-fixture.mjs';
import {readDocument,READER_VERSION} from '../supabase/functions/studkab-requests/structured-reader.mjs';
import {runRegisteredReading} from '../supabase/functions/studkab-generation/registered-reading.mjs';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const migrations=['20261001162253_route02_receive_before_analysis.sql','20261001175519_route02_registered_reading.sql'].map(n=>read('supabase/migrations/'+n)).join('\n');
const bytes=new Uint8Array(Buffer.from(JSON.parse(read('tests/fixtures/intake-reading.json'))['management.docx'],'base64'));
async function fixture(){
 const db=new PGlite();await db.exec(schema()+submissionExtension()+migrations);await db.exec('set role service_role');
 const api=apiDatabase(db),draft=await api('rpc/studkab_intake_open','POST',{p_student:student});
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const {file}=await api('rpc/studkab_intake_reserve','POST',{p_student:student,p_draft:draft.id,p_name:'Management.docx',p_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',p_size:bytes.length,p_hash:hash,p_supersedes:null});
 await api('rpc/studkab_intake_finish','POST',{p_student:student,p_draft:draft.id,p_file:file.id,p_hash:hash});
 const snap=await api('rpc/studkab_intake_receive_snapshot','POST',{p_student:student,p_draft:draft.id});
 const receipt=await api('rpc/studkab_intake_receive','POST',{p_student:student,p_draft:draft.id,p_revision:snap.revision,p_deadline:'2026-10-30',p_description:'',p_contact:'synthetic@example.invalid'});
 const rpc=async(name,args)=>{
  assert.ok(['studkab_registered_read_claim','studkab_registered_read_finish'].includes(name));
  return (await db.query('select '+name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')+') result',Object.values(args))).rows[0].result;
 };
 const deps={rpc,loadIntake:async(path,size,h)=>{assert.equal(path,file.storage_path);assert.equal(size,bytes.length);assert.equal(h,hash);return bytes;},readIntake:(b,t)=>readDocument(b,t,{DOMParser})};
 const claim=()=>rpc('studkab_registered_read_claim',{p_version:READER_VERSION});
 const finish=(c,result)=>rpc('studkab_registered_read_finish',{p_request:c.request_id,p_revision:c.revision,p_file:c.file.id,p_lease:c.file.read_lease,p_version:READER_VERSION,p_result:result});
 const parsed=async c=>({...await readDocument(bytes,file.content_type,{DOMParser}),fileId:c.file.id,fileHash:hash});
 return {db,rpc,deps,claim,finish,parsed,receipt,file};
}
test('received real Word is read on server without browser, AI dispatch or passport approval; result tied to original and reused',async()=>{
 const f=await fixture();try{
  assert.equal((await runRegisteredReading(f.deps)).status,'registered_read_ready');
  assert.equal(await runRegisteredReading(f.deps),null);
  const row=(await f.db.query('select * from studkab_intake_files')).rows[0];assert.equal(row.read_result.summary.tables,8);assert.equal(row.file_hash,f.file.file_hash);assert.equal(row.registered_read_attempts,1);
  const a=(await f.db.query('select * from studkab_request_attachments')).rows[0];assert.equal(a.category,'unclassified');assert.equal(a.extracted_text,null);
  await assert.rejects(()=>f.db.query("insert into studkab_requirement_passports(request_id,status) values($1,'approved')",[f.receipt.id]),/INTAKE_STUDY_REQUIRED/);
  assert.equal((await f.db.query('select count(*) n from studkab_intake_analysis_jobs')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('active lease excludes second worker, expired claim restarts, stale worker cannot overwrite result; lost finish returns saved result',async()=>{
 const f=await fixture();try{
  const c=await f.claim();assert.equal(await f.claim(),null);
  await f.db.query("update studkab_intake_files set read_until=now()-interval '1 second'");
  const next=await f.claim();assert.notEqual(next.file.read_lease,c.file.read_lease);
  const result=await f.parsed(next);assert.equal((await f.finish(c,result)).stale,true);
  assert.equal((await f.finish(next,result)).saved,true);assert.equal((await f.finish(next,result)).duplicate,true);
 }finally{await f.db.close();}
});
test('failed transport is persisted as failed, retried at most three times; original and receipt are never duplicated or deleted',async()=>{
 const f=await fixture();try{
  for(let i=0;i<3;i++)assert.equal((await runRegisteredReading({...f.deps,loadIntake:async()=>{throw Error('network');}})).status,'registered_read_failed');
  assert.equal(await f.claim(),null);assert.equal((await f.db.query('select registered_read_attempts n from studkab_intake_files')).rows[0].n,3);
  assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,1);assert.equal((await f.db.query('select count(*) n from studkab_intake_files')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('revoked membership, changed request revision, reassignment and deletion prevent saving or new reading',async()=>{
 for(const sql of ["delete from studkab_members where user_id='"+student+"'",'update studkab_requests set revision=revision+1',"update studkab_requests set student_id='"+other+"'",'update studkab_requests set deleting_at=now()']){
  const f=await fixture();try{const c=await f.claim(),result=await f.parsed(c);await f.db.exec('reset role');await f.db.exec(sql);await f.db.exec('set role service_role');assert.equal((await f.finish(c,result)).stale,true);assert.equal(await f.claim(),null);}finally{await f.db.close();}
 }
});
test('mismatched hash, file and malformed result cannot finish; browser roles cannot claim, save or read private files',async()=>{
 const f=await fixture();try{
  const c=await f.claim(),r=await f.parsed(c);
  for(const bad of [{...r,fileHash:'0'.repeat(64)},{...r,fileId:other},{...r,status:'approved'},{...r,blocks:null}])assert.equal((await f.finish(c,bad)).invalid,true);
  for(const role of ['anon','authenticated']){
   await f.db.exec('reset role;set role '+role);await assert.rejects(()=>f.claim(),/permission denied/);await assert.rejects(()=>f.finish(c,r),/permission denied/);await assert.rejects(()=>f.db.query('select read_result from studkab_intake_files'),/permission denied/);
  }
 }finally{await f.db.close();}
});
test('lost finish response leaves persisted reading and subsequent run does not load original again',async()=>{
 const f=await fixture();try{
  let count=0,lost=true;
  const deps={...f.deps,loadIntake:async(...args)=>{count++;return f.deps.loadIntake(...args);},rpc:async(name,args)=>{const r=await f.rpc(name,args);if(name.endsWith('_finish')&&lost){lost=false;throw Error('lost');}return r;}};
  assert.equal((await runRegisteredReading(deps)).status,'registered_read_save_unconfirmed');assert.equal(await runRegisteredReading(deps),null);assert.equal(count,1);
 }finally{await f.db.close();}
});
test('crash on final attempt ends as an explicit persisted failure after lease expiry',async()=>{
 const f=await fixture();try{
  for(let i=0;i<3;i++){assert.ok(await f.claim());await f.db.query("update studkab_intake_files set read_until=now()-interval '1 second'");}
  assert.equal(await f.claim(),null);
  const row=(await f.db.query('select * from studkab_intake_files')).rows[0];assert.equal(row.read_status,'failed');assert.equal(row.read_result.warnings[0].code,'reading_retry_limit');
 }finally{await f.db.close();}
});
test('request deletion is not blocked by reading history and an in-flight completion cannot recreate a deleted request',async()=>{
 const f=await fixture();try{
  const c=await f.claim(),result=await f.parsed(c);
  await f.db.exec('reset role');await f.db.query('delete from studkab_requests where id=$1',[f.receipt.id]);await f.db.exec('set role service_role');
  assert.equal((await f.finish(c,result)).stale,true);assert.equal(await f.claim(),null);
  assert.equal((await f.db.query('select registered_read_request from studkab_intake_files')).rows[0].registered_read_request,null);
  assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,0);
 }finally{await f.db.close();}
});
