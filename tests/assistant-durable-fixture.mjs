import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
export async function setupAssistantFixture(db,{actor,student,other}) {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text);create table public.studkab_request_config(executor_email text);
 create table public.studkab_requests(id uuid primary key,student_id uuid,revision integer default 1,payload jsonb,ready_at timestamptz default now(),deleting_at timestamptz);
 create table public.studkab_request_attachments(id uuid,request_id uuid,file_name text,content_type text,size_bytes integer,file_hash text,storage_path text,supersedes uuid);
 create table public.studkab_requirement_passports(id uuid,request_id uuid,revision integer,status text,items jsonb,material_manifest jsonb,source_fingerprint text);
 create table public.studkab_material_revisions(id uuid,request_id uuid,opened_at timestamptz,closed_at timestamptz,opened_revision integer,closed_revision integer);
 create table public.studkab_clarifications(id uuid,request_id uuid,created_at timestamptz,answer text,answered_at timestamptz);
 grant usage on schema auth to service_role;grant select on auth.users to service_role;
 grant all on all tables in schema public to service_role;`);
 await db.query('insert into auth.users values($1,$2),($3,$4),($5,$6)',[actor,'executor@offline.test',student,'student@offline.test',other,'other@offline.test']);
 await db.exec("insert into studkab_request_config values('executor@offline.test')");
 await db.exec(read('20261005120000_route03_c_work.sql'));
 let routeD=read('20261006090000_route03_d_hand_return.sql');
 routeD=routeD.slice(0,routeD.indexOf('-- Удаление заявки'));
 // Create route D schema/functions only; its deletion routine depends on unrelated tables.
 const stop=routeD.indexOf('create or replace function public.prepare_studkab_request_delete');
 if(stop>=0)routeD=routeD.slice(0,stop);
 await db.exec(routeD);
 await db.exec(read('20261009015337_assistant_durable_process.sql'));
 await db.exec('set role service_role');
}
// Native PostgreSQL harness uses the exact same disposable schema and migration.
if (process.argv.includes('--print-sql')) {
 const statements=[];
 const literal=v=>v==null?'null':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
 const fake={exec:async sql=>statements.push(sql),query:async(sql,args)=>statements.push(sql.replace(/\$(\d+)/g,(_,n)=>literal(args[Number(n)-1]))+';')};
 await setupAssistantFixture(fake,{actor:'22222222-2222-4222-8222-222222222222',student:'11111111-1111-4111-8111-111111111111',other:'33333333-3333-4333-8333-333333333333'});
 let sql=statements.join('\n');
 sql=sql.replace(/create role (anon|authenticated|service_role)( bypassrls)?;/g,(_,name,bypass)=>`do $$ begin if not exists(select 1 from pg_roles where rolname='${name}') then create role ${name}${bypass||''};end if;end $$;`);
 process.stdout.write(sql);
}
