import fs from 'node:fs';
export const migration='supabase/migrations/20260930172312_intake_private_drafts.sql';
export const student='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
export const schema=()=>`do $$ begin
 if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
 end $$;
 create schema auth;create table auth.users(id uuid primary key);
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;
 grant select,insert on storage.objects to anon,authenticated;
 grant usage on schema storage to anon,authenticated;
 create policy broad_existing_policy on storage.objects for all to anon,authenticated using(true) with check(true);
 create table studkab_members(user_id uuid primary key);
 insert into auth.users values('${student}'),('${other}');insert into studkab_members values('${student}'),('${other}');
 grant usage on schema public,auth,storage to service_role;grant select on studkab_members to service_role;
`+fs.readFileSync(new URL('../'+migration,import.meta.url),'utf8')+fs.readFileSync(new URL('../supabase/migrations/20261001015312_intake_structured_reading.sql',import.meta.url),'utf8')+`
 create table studkab_gen_budget(id boolean primary key,limit_microusd bigint default 0,reserved_microusd bigint default 0);insert into studkab_gen_budget(id) values(true);
 create table studkab_gen_attempts(request_id uuid primary key,reservation_microusd bigint);
 create table studkab_gen_reconciliations(request_ids uuid[],retained_microusd bigint);
 grant select on studkab_gen_budget,studkab_gen_attempts,studkab_gen_reconciliations to service_role;
 grant update(reserved_microusd) on studkab_gen_budget to service_role;
 alter default privileges in schema public grant all on tables to service_role;
`+fs.readFileSync(new URL('../supabase/migrations/20261001031058_intake_semantic_analysis.sql',import.meta.url),'utf8')+fs.readFileSync(new URL('../supabase/migrations/20261001051454_intake_confirmation.sql',import.meta.url),'utf8')+fs.readFileSync(new URL('../supabase/migrations/20261001110117_intake_analysis_output_bound.sql',import.meta.url),'utf8');
export function apiDatabase(db){return async(path,method='GET',body)=>{
 if(path.startsWith('rpc/')){
  const name=path.slice(4);if(!/^studkab_intake_(open|reserve|finish|notes|read_begin|read_finish|analysis_snapshot|analysis_start|analysis_state|analysis_claim|analysis_dispatch|analysis_finish|analysis_fail_claim|confirmation_state|confirmation_save|submission_snapshot|submit|request_context|receive_snapshot|receive)$/.test(name))throw Error('unexpected RPC');
  const vals=Object.values(body),placeholders=vals.map((_,i)=>'$'+(i+1)).join(',');
  return (await db.query('select '+name+'('+placeholders+') result',vals)).rows[0].result;
 }
 if(path.startsWith('studkab_intake_drafts?')){
  const q=new URLSearchParams(path.split('?')[1]);
  return (await db.query("select * from studkab_intake_drafts where id=$1 and student_id=$2 and state='open'",[q.get('id').slice(3),q.get('student_id').slice(3)])).rows;
 }
 if(path.startsWith('studkab_intake_files?')){
  const q=new URLSearchParams(path.split('?')[1]),vals=[q.get('draft_id').slice(3)];let where='draft_id=$1';
  if(q.has('id')){vals.push(q.get('id').slice(3));where+=' and id=$2';}
  if(q.has('state'))where+=" and state='saved'";
  return (await db.query('select * from studkab_intake_files where '+where+' order by created_at,id',vals)).rows;
 }
 throw Error('unexpected path '+path);
};}
if(process.argv.includes('--print-sql'))process.stdout.write(schema());
export function submissionExtension(){return fs.readFileSync(new URL('../request-delivery.sql',import.meta.url),'utf8')+`
 alter table studkab_requests add column revision integer not null default 1,add column ready_at timestamptz,add column deleting_at timestamptz;
 create table studkab_material_revisions(id uuid,request_id uuid,closed_at timestamptz);
 create table studkab_gen_jobs(request_id text);create table studkab_result_versions(request_id uuid);create table studkab_results(request_id uuid);
 create table studkab_requirement_passports(request_id uuid,status text);
 create table studkab_request_reassignments(request_id uuid,from_student_id uuid,to_student_id uuid);
 grant select on studkab_material_revisions,studkab_gen_jobs,studkab_result_versions,studkab_results,studkab_requirement_passports,studkab_request_reassignments to service_role;
 `+fs.readFileSync(new URL('../supabase/migrations/20260917144051_studkab_request_attachments.sql',import.meta.url),'utf8')+`
 alter table studkab_request_attachments add column supersedes uuid references studkab_request_attachments(id),add column material_revision_id uuid;
 `+fs.readFileSync(new URL('../supabase/migrations/20260926125807_c121_conditional_request_materials.sql',import.meta.url),'utf8')+fs.readFileSync(new URL('../supabase/migrations/20261001062029_intake_submission.sql',import.meta.url),'utf8');}
if(process.argv.includes('--print-submission-sql'))process.stdout.write(submissionExtension());
