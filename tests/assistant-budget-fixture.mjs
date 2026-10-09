import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setupAssistantFixture} from './assistant-durable-fixture.mjs';
const read=n=>readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
export async function setupAssistantBudgetFixture(db,actors){
 await setupAssistantFixture(db,actors);await db.exec('reset role');
 await db.exec(read('20260911195103_studkab_generation_storage_v1.sql'));
 await db.exec(`create table public.studkab_gen_policy(id boolean primary key check(id),temporary_total_microusd bigint not null check(temporary_total_microusd>=0));
 create table public.studkab_gen_reconciliations(id uuid primary key,request_ids uuid[],retained_microusd bigint,released_microusd bigint);
 create table public.studkab_intake_analysis_jobs(id uuid primary key,reserved_microusd bigint not null);
 alter table public.studkab_gen_policy enable row level security;alter table public.studkab_gen_reconciliations enable row level security;alter table public.studkab_intake_analysis_jobs enable row level security;
 revoke all on public.studkab_gen_reconciliations from public,anon,authenticated,service_role;grant select on public.studkab_gen_policy to service_role;grant select on public.studkab_intake_analysis_jobs to service_role;
 insert into public.studkab_gen_policy values(true,1070000);`);
 await db.exec(read('20261009021100_assistant_shared_budget.sql'));await db.exec('set role service_role');
}
if(process.argv.includes('--print-sql') && import.meta.url===pathToFileURL(process.argv[1]).href){
 const statements=[],literal=v=>v==null?'null':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
 const fake={exec:async sql=>statements.push(sql+'\n;'),query:async(sql,args)=>statements.push(sql.replace(/\$(\d+)/g,(_,n)=>literal(args[Number(n)-1]))+';')};
 await setupAssistantBudgetFixture(fake,{actor:'22222222-2222-4222-8222-222222222222',student:'11111111-1111-4111-8111-111111111111',other:'33333333-3333-4333-8333-333333333333'});
 process.stdout.write(statements.join('\n').replace(/create role (anon|authenticated|service_role)( bypassrls)?;/g,(_,name,bypass)=>`do $$ begin if not exists(select 1 from pg_roles where rolname='${name}') then create role ${name}${bypass||''};end if;end $$;`));
}
