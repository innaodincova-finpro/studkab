import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('C079 SQL deletion is service-only, blocks unreconciled cost and removes the complete request graph',async()=>{
 const db=new PGlite();
 await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create schema auth;create table auth.users(id uuid primary key);
  create table studkab_requests(id uuid primary key,number bigint,payload jsonb,student_id uuid references auth.users(id));
  create table studkab_request_attachments(id uuid primary key,request_id uuid,storage_path text);
  create table studkab_requirement_passports(id uuid primary key,request_id uuid);
  create table studkab_result_versions(id uuid primary key,request_id uuid);
  create table studkab_result_reviews(id uuid primary key,version_id uuid);
  create table studkab_results(id uuid primary key default gen_random_uuid(),request_id uuid,version_id uuid,review_id uuid);
  create table studkab_gen_jobs(id uuid primary key,request_id text,passport_id uuid);
  create table studkab_gen_parts(job_id uuid,ordinal int,primary key(job_id,ordinal));
  create table studkab_gen_attempts(request_id uuid primary key,job_id uuid,ordinal int);
  create table studkab_gen_recoveries(id bigint generated always as identity,job_id uuid,ordinal int);
  create table studkab_gen_reconciliations(id uuid primary key,request_ids uuid[] not null);
  create function immutable_delete() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
  create trigger immutable_result before delete on studkab_results for each row execute function immutable_delete();
  create trigger immutable_review before delete on studkab_result_reviews for each row execute function immutable_delete();
  create trigger immutable_version before delete on studkab_result_versions for each row execute function immutable_delete();
  create trigger immutable_attempt before delete on studkab_gen_attempts for each row execute function immutable_delete();
 `);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260920111220_c079_request_deletion.sql',import.meta.url),'utf8'));
 const request='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
 const passport='33333333-3333-4333-8333-333333333333',job='44444444-4444-4444-8444-444444444444';
 const version='55555555-5555-4555-8555-555555555555',review='66666666-6666-4666-8666-666666666666',attempt='77777777-7777-4777-8777-777777777777';
 await db.exec(`insert into auth.users values('${actor}');insert into studkab_requests(id,number,payload,student_id,deleting_at)values('${request}',1,'{}','${actor}',now());insert into studkab_request_attachments values(gen_random_uuid(),'${request}','path');insert into studkab_requirement_passports values('${passport}','${request}');insert into studkab_result_versions values('${version}','${request}');insert into studkab_result_reviews values('${review}','${version}');insert into studkab_results(request_id,version_id,review_id)values('${request}','${version}','${review}');insert into studkab_gen_jobs values('${job}','${request}','${passport}');insert into studkab_gen_parts values('${job}',0);insert into studkab_gen_attempts values('${attempt}','${job}',0);`);
 await db.query(`select set_config('request.jwt.claims','{"role":"authenticated"}',false)`);
 await assert.rejects(db.query('select delete_studkab_request($1,$2,$3)',[request,actor,'Удаление неверной заявки']),/FORBIDDEN/);
 await db.query(`select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
 await assert.rejects(db.query('select prepare_studkab_request_delete($1)',[request]),/UNRECONCILED/);
 await db.query('insert into studkab_gen_reconciliations values(gen_random_uuid(),array[$1::uuid])',[attempt]);
 const plan=await db.query('select prepare_studkab_request_delete($1) value',[request]);
 assert.deepEqual(plan.rows[0].value.paths,['path']);
 const result=await db.query('select delete_studkab_request($1,$2,$3) value',[request,actor,'Удаление неверной заявки']);
 assert.equal(result.rows[0].value.deleted,true);
 for(const table of ['studkab_requests','studkab_request_attachments','studkab_requirement_passports','studkab_result_versions','studkab_result_reviews','studkab_results','studkab_gen_jobs','studkab_gen_parts','studkab_gen_attempts','studkab_gen_recoveries']){
  assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0,table);
 }
 assert.equal((await db.query('select count(*)::int n from studkab_gen_reconciliations')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from studkab_request_deletion_audit')).rows[0].n,1);
 await db.close();
});

test('C080 history is removed by the existing graph deletion, with triggers disabled',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
 create table studkab_requests(id uuid primary key,number bigint,payload jsonb,student_id uuid,client_id text);
 create table studkab_request_attachments(id uuid primary key,request_id uuid,storage_path text,student_id uuid,category text);
 create table studkab_requirement_passports(id uuid primary key,request_id uuid);
 create table studkab_result_versions(id uuid primary key,request_id uuid);
 create table studkab_result_reviews(id uuid primary key,version_id uuid);
 create table studkab_results(id uuid primary key,request_id uuid,version_id uuid,review_id uuid);
 create table studkab_gen_jobs(id uuid primary key,request_id text);
 create table studkab_gen_parts(job_id uuid);
 create table studkab_gen_attempts(request_id uuid,job_id uuid);
 create table studkab_gen_recoveries(job_id uuid);
 create table studkab_gen_reconciliations(request_ids uuid[]);`);
 for(const file of ['20260920111220_c079_request_deletion.sql','20260921050532_c080_request_resubmission.sql'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 const r='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
 await db.exec(`insert into auth.users values('${actor}'); insert into studkab_requests(id,student_id) values('${r}','${actor}'); insert into studkab_request_payload_history(request_id,payload) values('${r}','{}');`);
 await db.query(`select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
 await db.query('select prepare_studkab_request_delete($1)',[r]);
 const result=(await db.query('select delete_studkab_request($1,$2,$3) value',[r,actor,'Удаление тестовой заявки'])).rows[0].value;
 assert.equal(result.counts.payload_history,1);
 assert.equal((await db.query('select count(*)::int n from studkab_request_payload_history')).rows[0].n,0);
 }finally{await db.close();}
});

test('C084 clarification history is counted and deleted with the request graph',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
 create table studkab_requests(id uuid primary key,number bigint,payload jsonb,student_id uuid,client_id text);
 create table studkab_request_attachments(id uuid primary key,request_id uuid,storage_path text,student_id uuid,category text);
 create table studkab_requirement_passports(id uuid primary key,request_id uuid);
 create table studkab_result_versions(id uuid primary key,request_id uuid);
 create table studkab_result_reviews(id uuid primary key,version_id uuid);
 create table studkab_results(id uuid primary key,request_id uuid,version_id uuid,review_id uuid);
 create table studkab_gen_jobs(id uuid primary key,request_id text);
 create table studkab_gen_parts(job_id uuid);
 create table studkab_gen_attempts(request_id uuid,job_id uuid);
 create table studkab_gen_recoveries(job_id uuid);
 create table studkab_gen_reconciliations(request_ids uuid[]);`);
 for(const file of ['20260920111220_c079_request_deletion.sql','20260921050532_c080_request_resubmission.sql','20260921165603_c084_requirement_clarifications.sql'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 const r='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
 await db.exec(`insert into auth.users values('${actor}'); insert into studkab_requests(id,student_id) values('${r}','${actor}'); insert into studkab_request_payload_history(request_id,payload) values('${r}','{}');`);
 await db.query('insert into studkab_clarifications(id,request_id,item_id,question,asked_by)values(gen_random_uuid(),$1,$2,$3,$4)',[r,'VOLUME','Сколько страниц?',actor]);
 await db.query(`select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
 await db.query('select prepare_studkab_request_delete($1)',[r]);
 const result=(await db.query('select delete_studkab_request($1,$2,$3) value',[r,actor,'Удаление тестовой заявки'])).rows[0].value;
 assert.equal(result.counts.payload_history,1);
 assert.equal(result.counts.clarifications,1);
 assert.equal((await db.query('select count(*)::int n from studkab_clarifications')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from studkab_request_payload_history')).rows[0].n,0);
 }finally{await db.close();}
});
