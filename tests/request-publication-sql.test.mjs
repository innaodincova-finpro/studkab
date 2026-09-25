import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('C114 incomplete request is invisible to Telegram until all four stored categories publish',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table studkab_requests(id uuid primary key,number bigint,student_id uuid,created_at timestamptz default now(),
    deleting_at timestamptz,telegram_sent_at timestamptz,telegram_attempts integer default 0,
    retry_at timestamptz default now()-interval '1 minute',lease_until timestamptz);
   create table studkab_request_attachments(id uuid primary key default gen_random_uuid(),request_id uuid,
    category text,file_hash text,supersedes uuid);
  `);
  const student='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  const old='33333333-3333-4333-8333-333333333333',current='44444444-4444-4444-8444-444444444444';
  await db.query('insert into studkab_requests(id,number,student_id,telegram_sent_at) values($1,9,$2,now())',[old,student]);
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260925194500_c114_complete_before_publish.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select ready_at is not null as ready from studkab_requests where id=$1',[old])).rows[0].ready,true);
  await db.query('insert into studkab_requests(id,number,student_id) values($1,1,$2)',[current,student]);
  assert.equal((await db.query('select count(*)::int n from claim_studkab_requests()')).rows[0].n,0);
  const publish=async(who=student)=>(await db.query('select studkab_request_publish($1,$2) result',[current,who])).rows[0].result;
  assert.equal((await publish(other)).missing,true);
  for(const category of ['assignment','data','methodology'])await db.query('insert into studkab_request_attachments(request_id,category,file_hash) values($1,$2,$3)',[current,category,category]);
  assert.equal((await publish()).incomplete,true);
  assert.equal((await db.query('select count(*)::int n from claim_studkab_requests()')).rows[0].n,0);
  await db.query('insert into studkab_request_attachments(request_id,category,file_hash) values($1,$2,$3)',[current,'sources','sources']);
  assert.equal((await publish()).ready,true);
  assert.equal((await publish()).duplicate,true);
  const claimed=(await db.query('select number from claim_studkab_requests()')).rows;
  assert.deepEqual(claimed,[{number:1}]);
 }finally{await db.close();}
});
