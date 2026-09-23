// Disposable SQL fixture shared by independent C096 behavior/concurrency checks.
// No network, credentials or production data are used.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
export const migration='supabase/migrations/20260923023438_c096_material_revision.sql';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
export const actor={student:'11111111-1111-4111-8111-111111111111',executor:'22222222-2222-4222-8222-222222222222',other:'33333333-3333-4333-8333-333333333333'};
export const fingerprint='a'.repeat(64);
export const legacyRequest='44444444-4444-4444-8444-444444444444';
export const items=['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER'].map(id=>({id,category:'method',required:true,verified:true,text:'Учебное требование из задания',source:'Синтетическое задание, с. 1',answer_ids:[]}));
export const plan=[{id:'intro',prompt:'Synthetic offline part',max_cost_microusd:250000,max_output_tokens:4000}];
export const input={system:'Synthetic offline test',prompts:{intro:'Synthetic part'},material_fingerprint:fingerprint};
export function setupSQL({withMigration=true}={}){
 const parts=[`do $$ begin
 if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
 end $$;
 create schema auth;create table auth.users(id uuid primary key,email text,encrypted_password text);
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
 grant usage on schema auth,public to service_role;`];
 for(const path of [
  'request-delivery.sql','result-delivery.sql',
  'supabase/migrations/20260911195103_studkab_generation_storage_v1.sql',
  'supabase/migrations/20260912094701_studkab_versioned_delivery.sql',
  'supabase/migrations/20260912123246_studkab_budget_reconciliation.sql',
  'supabase/migrations/20260914105509_studkab_requirement_passports.sql',
  'supabase/migrations/20260915070508_mandatory_passport_generation_limits.sql',
  'supabase/migrations/20260915130000_studkab_generation_stop.sql',
  'supabase/migrations/20260915130100_studkab_production_drift_recorded.sql',
  'supabase/migrations/20260917144051_studkab_request_attachments.sql',
  'supabase/migrations/20260918130000_review_statuses.sql',
  'supabase/migrations/20260919124300_result_review_context_guard.sql'
 ]){
  parts.push(read(path));
  // A real historical shape: delivery existed before version/review tables.
  // Seed before their migration; never disable or bypass a delivery trigger.
  if(path==='result-delivery.sql')parts.push(`insert into auth.users(id,email) values('${actor.student}','student@example.test');
   insert into studkab_requests(id,student_id,client_id,payload) values('${legacyRequest}','${actor.student}','legacy-fixture','{"id":"legacy-fixture"}');
   insert into studkab_results(request_id,delivery_id,document) values('${legacyRequest}','55555555-5555-4555-8555-555555555555','{"topic":"Preserved historical delivery"}');`);
 }
 parts.push(read('supabase/migrations/20260920111220_c079_request_deletion.sql'));
 parts.push(`
 create table studkab_members(user_id uuid primary key references auth.users(id));
 grant select on studkab_members to service_role;`);
 for(const path of [
  'supabase/migrations/20260921050532_c080_request_resubmission.sql',
  'supabase/migrations/20260921165603_c084_requirement_clarifications.sql',
  'supabase/migrations/20260921181451_c085_clarification_actor_permissions.sql',
  'supabase/migrations/20260922032858_c089_review_notes.sql',
  'supabase/migrations/20260923023346_baseline_c095_request_delete_without_replica_role.sql',
  'supabase/migrations/20260923023405_baseline_draft_passport_attachment_corrections.sql'
 ])parts.push(read(path));
 if(withMigration)parts.push(read(migration));
 parts.push(`insert into auth.users(id,email) values
 ('${actor.student}','student@example.test'),('${actor.executor}','executor@example.test'),('${actor.other}','other@example.test') on conflict(id) do nothing;
 insert into studkab_members values('${actor.student}'),('${actor.executor}'),('${actor.other}');
 update studkab_request_config set executor_email='executor@example.test';`);
 return parts.join('\n');
}
if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv.includes('--print-sql'))process.stdout.write(setupSQL());
