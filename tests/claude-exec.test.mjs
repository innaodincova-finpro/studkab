// «Передать Claude»: копия материалов для Claude и прикрепление готового файла Claude как готовой работы.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {schema,submissionExtension,student} from './intake-fixture.mjs';
import {claudeAction,toBase64} from '../supabase/functions/studkab-requests/claude-exec.mjs';
const read=n=>fs.readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const ID='11111111-1111-4111-8111-111111111111',EXEC={id:'e',email:'owner@example.test'},STUDENT={id:'s',email:'s@example.test'};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const DOCX=Buffer.concat([Buffer.from([80,75,3,4]),Buffer.from('работа')]);
function fake({job=null,result=null,attachments=[]}={}){
 const calls=[],saved=[],files=[];
 const db=async(path,method='GET',body)=>{calls.push([path,method,body]);
  if(path.startsWith('studkab_requests?'))return [{id:ID,number:3,ready_at:'x',payload:{route:'r3'}}];
  if(path==='rpc/studkab_claude_queue'){job={request_id:ID,queued_at:'2026-10-06T18:00:00Z'};return {queued_at:job.queued_at};}
  if(path.startsWith('studkab_request_attachments?'))return attachments;
  if(path==='rpc/studkab_claude_file_put'){files.push(body);return {ok:true};}
  if(path.startsWith('studkab_claude_jobs?')&&method==='GET')return job?[job]:[];
  if(path.startsWith('studkab_claude_jobs?')&&method==='PATCH'){Object.assign(job,body);return [job];}
  if(path.startsWith('studkab_claude_files?'))return files.length?files:[{},{}];
  if(path.startsWith('studkab_claude_results?'))return result?[result]:[];
  if(path==='rpc/studkab_r3_result_set')return {ok:true};
  if(path==='rpc/studkab_claude_attached'){job.attached_at='2026-10-06T19:00:00Z';return {ok:true};}
  throw Error('Unexpected '+path);};
 return {db,calls,saved,files,deps:{db,config:async()=>({executor_email:EXEC.email}),loadRequestFile:async(p,size)=>Buffer.alloc(size,1),saveResult:async(...a)=>saved.push(a)}};
}
test('queue: executor only; current materials copied (replaced files skipped); state reports the copy',async()=>{
 const f=fake({attachments:[{id:'a1',file_name:'Практика1.pdf',content_type:'application/pdf',size_bytes:5,file_hash:'1'.repeat(64),storage_path:'p/1'},
  {id:'a2',file_name:'Практика1_новая.pdf',content_type:'application/pdf',size_bytes:4,file_hash:'2'.repeat(64),storage_path:'p/2',supersedes:'a1'}]});
 assert.equal((await claudeAction({action:'claude-queue',id:ID},STUDENT,f.deps)).status,403);
 const r=await claudeAction({action:'claude-queue',id:ID,note:'  задачи 2 и 4  '},EXEC,f.deps);
 assert.equal(r.status,undefined);assert.deepEqual(f.files.map(x=>x.p_attachment),['a2']);
 assert.equal(f.files[0].p_b64,toBase64(Buffer.alloc(4,1)));assert.equal(f.calls.find(c=>c[0]==='rpc/studkab_claude_queue')[2].p_note,'задачи 2 и 4');
 assert.equal(r.data.claude.files,1);assert.ok(!r.data.claude.attachedAt);
 assert.equal((await claudeAction({action:'claude-state',id:'bad'},EXEC,f.deps)).status,400);
});
test('state: a ready Claude file is checked and attached as the finished work; a damaged file is reported',async()=>{
 const good=fake({job:{request_id:ID,queued_at:'q',result_ready_at:'r'},result:{name:'Работа.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:DOCX.length,hash:sha(DOCX),content_b64:DOCX.toString('base64')}});
 const r=await claudeAction({action:'claude-state',id:ID},EXEC,good.deps);
 assert.equal(good.saved.length,1);assert.equal(good.saved[0][0],'r3-results/'+ID+'/'+sha(DOCX));
 assert.ok(good.calls.some(c=>c[0]==='rpc/studkab_r3_result_set'&&c[2].p_name==='Работа.docx'));assert.ok(r.data.claude.attachedAt);
 const bad=fake({job:{request_id:ID,queued_at:'q',result_ready_at:'r'},result:{name:'Работа.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:DOCX.length,hash:'0'.repeat(64),content_b64:DOCX.toString('base64')}});
 const b=await claudeAction({action:'claude-state',id:ID},EXEC,bad.deps);
 assert.equal(bad.saved.length,0);assert.match(b.data.claude.error,/не полностью/);assert.equal(b.data.claude.attachedAt,undefined);
 // Повторное открытие не прикрепляет файл второй раз.
 const again=fake({job:{request_id:ID,queued_at:'q',result_ready_at:'r',attached_at:'a'}});await claudeAction({action:'claude-state',id:ID},EXEC,again.deps);assert.equal(again.saved.length,0);
});
test('SQL: queue takes the request into work, copies are checked and cleared after attaching; server-only access',async()=>{
 const db=new PGlite();
 try{
  const r3a=read('20261005090000_route03_a_request_form.sql');
  await db.exec(schema()+submissionExtension()+read('20261001162253_route02_receive_before_analysis.sql')+r3a.slice(r3a.indexOf('-- R3-A: регистрация заявки по форме'))+read('20261005120000_route03_c_work.sql')+read('20261006090000_route03_d_hand_return.sql')+read('20261007150000_claude_executor.sql'));
  const req=(await db.query("insert into studkab_requests(student_id,client_id,payload,ready_at) values($1,'c1','{\"route\":\"r3\"}',now()) returning id",[student])).rows[0].id;
  await db.exec(`set role service_role`);
  const q=(await db.query('select studkab_claude_queue($1,$2) r',[req,'задачи'])).rows[0].r;assert.ok(q.queued_at);
  assert.ok((await db.query('select taken_at from studkab_r3_work where request_id=$1',[req])).rows[0].taken_at);
  const att='22222222-2222-4222-8222-222222222222';
  assert.deepEqual((await db.query('select studkab_claude_file_put($1,$2,$3,$4,$5,$6,$7) r',[req,att,'a.pdf','application/pdf',4,'1'.repeat(64),'AAAA'])).rows[0].r,{invalid:true});
  assert.deepEqual((await db.query('select studkab_claude_file_put($1,$2,$3,$4,$5,$6,$7) r',[req,att,'a.pdf','application/pdf',3,'1'.repeat(64),'AAAA'])).rows[0].r,{ok:true});
  await db.query("insert into studkab_claude_results(request_id,name,type,size,hash,content_b64) values($1,'r.docx','t',3,$2,'AAAA')",[req,'2'.repeat(64)]);
  await db.query('update studkab_claude_jobs set result_ready_at=now() where request_id=$1',[req]);
  await db.query('select studkab_claude_attached($1)',[req]);
  const st=(await db.query('select j.attached_at,f.content_b64 f,r.content_b64 r from studkab_claude_jobs j join studkab_claude_files f using(request_id) join studkab_claude_results r using(request_id)')).rows[0];
  assert.ok(st.attached_at);assert.equal(st.f,null);assert.equal(st.r,'');
  // Повторная передача сбрасывает отметки готовности.
  await db.query('select studkab_claude_queue($1,$2)',[req,'']);
  assert.equal((await db.query('select attached_at from studkab_claude_jobs')).rows[0].attached_at,null);
  await db.exec('reset role');
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);
   await assert.rejects(()=>db.query('select * from studkab_claude_files'),/permission denied/);
   await assert.rejects(()=>db.query('select studkab_claude_queue($1,$2)',[req,'']),/permission denied/);await db.exec('reset role');}
  // Удаление заявки удаляет и копии.
  await db.exec("set session_replication_role=origin");await db.query('delete from studkab_requests where id=$1',[req]);
  assert.equal((await db.query('select count(*)::int n from studkab_claude_files')).rows[0].n,0);
 }finally{await db.close();}
});
test('handler routes «Передать Claude» actions to the executor module',async()=>{
 const {handler}=await import('../supabase/functions/studkab-requests/handler.mjs');
 const f=fake({job:{request_id:ID,queued_at:'q'}});
 const h=handler({auth:async()=>({...EXEC,email_confirmed_at:'yes'}),...f.deps});
 const r=await h(new Request('https://x.test',{method:'POST',headers:{authorization:'Bearer t'},body:JSON.stringify({action:'claude-state',id:ID})}));
 assert.equal(r.status,200);assert.equal((await r.json()).claude.queuedAt,'q');
});
