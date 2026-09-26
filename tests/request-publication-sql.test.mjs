import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('C114/C121 publication waits for an assignment or written description, preserves ownership and retries',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table studkab_requests(id uuid primary key,number bigint,student_id uuid,created_at timestamptz default now(),
    deleting_at timestamptz,payload jsonb default '{}'::jsonb,telegram_sent_at timestamptz,telegram_attempts integer default 0,
    retry_at timestamptz default now()-interval '1 minute',lease_until timestamptz);
   create table studkab_request_attachments(id uuid primary key default gen_random_uuid(),request_id uuid,
    category text,file_hash text,supersedes uuid);
  `);
  const student='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  const old='33333333-3333-4333-8333-333333333333',current='44444444-4444-4444-8444-444444444444';
  await db.query('insert into studkab_requests(id,number,student_id,telegram_sent_at) values($1,9,$2,now())',[old,student]);
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260925194500_c114_complete_before_publish.sql',import.meta.url),'utf8'));
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260926150000_c121_conditional_request_materials.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select ready_at is not null as ready from studkab_requests where id=$1',[old])).rows[0].ready,true);
  await db.query('insert into studkab_requests(id,number,student_id) values($1,1,$2)',[current,student]);
  assert.equal((await db.query('select count(*)::int n from claim_studkab_requests()')).rows[0].n,0);
  const publish=async(who=student)=>(await db.query('select studkab_request_publish($1,$2) result',[current,who])).rows[0].result;
  assert.equal((await publish(other)).missing,true);
  for(const category of ['data','methodology'])await db.query('insert into studkab_request_attachments(request_id,category,file_hash) values($1,$2,$3)',[current,category,category]);
  assert.equal((await publish()).incomplete,true);
  assert.equal((await db.query('select count(*)::int n from claim_studkab_requests()')).rows[0].n,0);
  await db.query('insert into studkab_request_attachments(request_id,category,file_hash) values($1,$2,$3)',[current,'assignment','assignment']);
  assert.equal((await publish()).ready,true);
  assert.equal((await publish()).duplicate,true);
  const claimed=(await db.query('select number from claim_studkab_requests()')).rows;
  assert.deepEqual(claimed,[{number:1}]);
  const described='55555555-5555-4555-8555-555555555555',replaced='66666666-6666-4666-8666-666666666666';
  await db.query('insert into studkab_requests(id,number,student_id,payload) values($1,2,$2,$3)',[described,student,{rq:'Нужен план курсовой, методичку не выдавали'}]);
  assert.equal((await db.query('select studkab_request_publish($1,$2) result',[described,other])).rows[0].result.missing,true);
  assert.equal((await db.query('select studkab_request_publish($1,$2) result',[described,student])).rows[0].result.ready,true);
  assert.equal((await db.query('select count(*)::int n from claim_studkab_requests()')).rows[0].n,1);
  await db.query('insert into studkab_requests(id,number,student_id,payload) values($1,3,$2,$3)',[replaced,student,{rq:'  '}]);
  const assignment='77777777-7777-4777-8777-777777777777',successor='88888888-8888-4888-8888-888888888888';
  await db.query('insert into studkab_request_attachments(id,request_id,category,file_hash) values($1,$2,$3,$4)',[assignment,replaced,'assignment','one']);
  await db.query('insert into studkab_request_attachments(id,request_id,category,file_hash,supersedes) values($1,$2,$3,$4,$5)',[successor,replaced,'sources','two',assignment]);
  assert.equal((await db.query('select studkab_request_publish($1,$2) result',[replaced,student])).rows[0].result.incomplete,true);
 }finally{await db.close();}
});
