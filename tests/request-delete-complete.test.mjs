// Полное удаление заявки: вместе с заявкой удаляются исходные файлы студента, черновик и отмеченные оставшиеся файлы.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {schema,submissionExtension,student,other} from './intake-fixture.mjs';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
const read=n=>fs.readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const r3a=read('20261005090000_route03_a_request_form.sql');
const H=c=>c.repeat(64);
test('SQL: the delete plan lists the student originals and leftovers; cleanup removes only unreferenced drafts of that student',async()=>{
 const db=new PGlite();
 try{
  await db.exec(schema()+submissionExtension()+read('20261001162253_route02_receive_before_analysis.sql')+r3a.slice(r3a.indexOf('-- R3-A: регистрация заявки по форме'))+read('20261005120000_route03_c_work.sql')+read('20261006090000_route03_d_hand_return.sql'));
  await db.exec(`create table if not exists studkab_gen_jobs(id uuid,request_id text);alter table studkab_gen_jobs add column if not exists id uuid;
   create table if not exists studkab_gen_attempts(request_id uuid,job_id uuid);alter table studkab_gen_attempts add column if not exists job_id uuid;
   create table if not exists studkab_gen_reconciliations(request_ids uuid[]);
   create table if not exists studkab_intake_analysis_jobs(id uuid primary key default gen_random_uuid(),draft_id uuid references studkab_intake_drafts(id));
   create table if not exists studkab_intake_confirmations(id uuid primary key default gen_random_uuid(),draft_id uuid references studkab_intake_drafts(id));`);
  await db.exec(read('20261006170000_request_delete_complete.sql'));
  const d1=(await db.query("insert into studkab_intake_drafts(student_id,state) values($1,'submitted') returning id",[student])).rows[0].id;
  const d2=(await db.query("insert into studkab_intake_drafts(student_id,state) values($1,'submitted') returning id",[student])).rows[0].id;
  const ins=async(d,n,c)=>(await db.query("insert into studkab_intake_files(draft_id,file_name,content_type,size_bytes,file_hash,storage_path) values($1,$2,'application/pdf',10,$3,$4) returning id",[d,n,H(c),'s/'+d+'/'+n])).rows[0].id;
  const f1=await ins(d1,'a.pdf','a'),f2=await ins(d1,'b.pdf','b'),f3=await ins(d2,'c.pdf','c');
  const req=async()=>(await db.query("insert into studkab_requests(student_id,client_id,payload,ready_at) values($1,gen_random_uuid()::text,'{}',now()) returning id",[student])).rows[0].id;
  const r1=await req(),r2=await req();
  const att=async(r,f,p,c)=>db.query("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text,intake_file_id) values(gen_random_uuid(),$1,$2,'assignment','x.pdf','application/pdf',10,$3,$4,'текст',$5)",[r,student,H(c),p,f]);
  // Проверки добавления вложений здесь не предмет теста: вложения вставляются без триггеров.
  await db.exec('set session_replication_role=replica');
  await att(r1,f1,'s/'+d1+'/a.pdf','a');await att(r1,f2,'s/'+d1+'/b.pdf','b');await att(r2,f3,'s/'+d2+'/c.pdf','c');
  await db.exec('set session_replication_role=origin');
  await db.query("insert into studkab_storage_leftovers(bucket,path,student_id,note) values('studkab-request-materials','s/old/x.txt',$1,'остаток'),('studkab-request-materials','o/old/y.txt',$2,'другой студент')",[student,other]);
  await db.exec(`set role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
  const plan=(await db.query('select prepare_studkab_request_delete($1) r',[r1])).rows[0].r;
  assert.deepEqual(plan.drafts,[d1]);assert.deepEqual(plan.intakePaths.sort(),['s/'+d1+'/a.pdf','s/'+d1+'/b.pdf']);
  assert.deepEqual(plan.leftovers,[{bucket:'studkab-request-materials',path:'s/old/x.txt'}]);assert.equal(plan.student,student);
  await db.exec('reset role');await db.query('delete from studkab_requests where id=$1',[r1]);await db.exec('set role service_role');
  // Чужой черновик и черновик, на который ещё ссылается заявка, не трогаются.
  const out=(await db.query('select studkab_request_delete_intake($1,$2,$3) r',[[d1,d2],student,JSON.stringify(plan.leftovers)])).rows[0].r;
  assert.deepEqual(out,{drafts:1,files:2,leftovers:1});
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from studkab_intake_drafts')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from studkab_storage_leftovers')).rows[0].n,1);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);
   await assert.rejects(()=>db.query('select studkab_request_delete_intake($1,$2,$3)',[[d2],student,'[]']),/permission denied/);
   await assert.rejects(()=>db.query('select * from studkab_storage_leftovers'),/permission denied/);await db.exec('reset role');}
 }finally{await db.close();}
});
test('handler: removes request files, student originals and leftovers, then deletes the request and the draft records',async()=>{
 const id='11111111-1111-4111-8111-111111111111',owner={id:'22222222-2222-4222-8222-222222222222',email:'owner@example.test',email_confirmed_at:'yes'};
 const order=[];
 const db=async(path,method,body)=>{order.push(path);
  if(path==='rpc/prepare_studkab_request_delete')return {absent:false,paths:['s/d/a'],drafts:['d'],intakePaths:['s/d/a','s/d/b'],leftovers:[{bucket:'studkab-request-materials',path:'s/old/x'}],student:'st'};
  if(path==='rpc/delete_studkab_request')return {deleted:true,id};
  if(path==='rpc/studkab_request_delete_intake'){assert.deepEqual(body,{p_drafts:['d'],p_student:'st',p_leftovers:[{bucket:'studkab-request-materials',path:'s/old/x'}]});return {drafts:1,files:2,leftovers:1};}
  throw Error('Unexpected '+path);};
 const req=[],intake=[];
 const r=await handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db,remove:async p=>{req.push(p);order.push('req:'+p);},removeIntake:async p=>{intake.push(p);order.push('intake:'+p);}})(new Request('https://x.test',{method:'POST',headers:{authorization:'Bearer t'},body:JSON.stringify({action:'delete-request',id,confirmId:id,reason:'Учебная заявка, больше не нужна'})}));
 assert.equal(r.status,200);const body=await r.json();assert.deepEqual(body.intake,{drafts:1,files:2,leftovers:1});
 assert.deepEqual(req,['s/d/a','s/old/x']);assert.deepEqual(intake,['s/d/a','s/d/b']);
 assert.ok(order.indexOf('rpc/delete_studkab_request')>order.indexOf('intake:s/d/b'));assert.equal(order.at(-1),'rpc/studkab_request_delete_intake');
});
