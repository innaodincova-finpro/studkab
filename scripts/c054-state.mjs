// C-054: расширенная сверка рабочей базы. Только чтение.
// SQL из журнала миграций сравнивается внутри процесса и никогда не печатается.
import {appendFile,readFile} from 'node:fs/promises';

export const PROJECT='dcpthwmuiodrjepifzsd';
export const ACTUAL_VERSIONS=['20260916135700','20260916135724'];
const FN='public.save_app_data_v2(text,jsonb,bigint)';

export const STATE_QUERY=`select
 (select count(*) from supabase_migrations.schema_migrations where version='20260915130200')::int reg_c051,
 (select count(*) from public.studkab_requests)::int requests,
 (select count(*) from public.app_data where app in ('kabinet','reestr'))::int cloud,
 (select count(*) from public.studkab_push_subscriptions)::int subs,
 (select coalesce(max(octet_length(data::text)),0) from public.app_data where app in ('kabinet','reestr'))::bigint biggest,
 (select count(*) from public.studkab_gen_jobs where status in ('queued','running'))::int active`;
export const MEMBERS_QUERY=`select source,count(*)::int n from public.studkab_members group by source order by source`;
export const MIGRATION_RECORDS_QUERY=`select version,name,statements from supabase_migrations.schema_migrations
 where version in ('20260916135700','20260916135724') order by version`;
export const MIGRATIONS_QUERY=`select version,name from supabase_migrations.schema_migrations
 where version >= '20260915' order by version`;
export const DEFS_QUERY=`select p.proname fn,pg_get_functiondef(p.oid) def from pg_proc p where p.oid in (
 to_regprocedure('public.save_app_data_v2(text,jsonb,bigint)'),to_regprocedure('public.studkab_app_data_guard()'),
 to_regprocedure('public.studkab_current_member()'),to_regprocedure('public.studkab_member_add(uuid)')) order by fn`;
export const COLUMNS_QUERY=`select column_name,data_type,udt_name,is_nullable,coalesce(column_default,'') column_default
 from information_schema.columns where table_schema='public' and table_name='studkab_members' order by ordinal_position`;
export const CONSTRAINTS_QUERY=`select conname,contype,pg_get_constraintdef(oid,true) definition
 from pg_constraint where conrelid='public.studkab_members'::regclass order by contype,conname`;
export const TRIGGER_QUERY=`select t.tgname,t.tgenabled,(t.tgtype & 1)<>0 is_row,(t.tgtype & 2)<>0 is_before,(t.tgtype & 4)<>0 on_insert,
 (t.tgtype & 8)<>0 on_delete,(t.tgtype & 16)<>0 on_update,t.tgfoid::regprocedure::text function_name
 from pg_trigger t where t.tgrelid='public.app_data'::regclass and not t.tgisinternal and t.tgname='studkab_app_data_guard'`;
export const SECURITY_QUERY=`select
 (select relrowsecurity from pg_class where oid='public.studkab_members'::regclass) rls,
 (select count(*)::int from pg_policies where schemaname='public' and tablename='studkab_members') policies,
 coalesce((select jsonb_agg(jsonb_build_object('grantee',grantee,'privilege',privilege_type) order by grantee,privilege_type)
 from information_schema.role_table_grants where table_schema='public' and table_name='studkab_members'),'[]'::jsonb) grants`;
export const ACCESS_QUERY=`select p.proname fn,pg_get_userbyid(p.proowner) owner,p.prosecdef security_definer,
 coalesce('search_path=""'=any(p.proconfig),false) empty_search_path,
 coalesce((select jsonb_agg(jsonb_build_object('grantee',r.rolname,
 'execute',has_function_privilege(r.oid,p.oid,'EXECUTE')) order by r.rolname) from pg_roles r
 where r.rolname in ('anon','authenticated','service_role')),'[]'::jsonb) access from pg_proc p where p.oid in (
 to_regprocedure('public.save_app_data_v2(text,jsonb,bigint)'),to_regprocedure('public.studkab_app_data_guard()'),
 to_regprocedure('public.studkab_current_member()'),to_regprocedure('public.studkab_member_add(uuid)')) order by fn`;
export const QUERIES={STATE_QUERY,MEMBERS_QUERY,MIGRATION_RECORDS_QUERY,MIGRATIONS_QUERY,DEFS_QUERY,COLUMNS_QUERY,CONSTRAINTS_QUERY,TRIGGER_QUERY,SECURITY_QUERY,ACCESS_QUERY};

const forbidden=/\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|comment|copy|call|do|vacuum|analyze|refresh|reindex|cluster|discard|listen|notify|security\s+label)\b/i;
export function assertReadOnlyQuery(query){
 const sql=String(query||'').trim();
 if(!/^select\b/i.test(sql)||forbidden.test(sql)||/;\s*\S/.test(sql))throw Error('Сценарий выполняет только один SELECT');
 return true;
}
const norm=text=>String(text||'').replace(/\r\n?/g,'\n').replace(/\s+/g,' ').trim();
const body=text=>Array.isArray(text)?text.join('\n'):String(text||'');
const bool=v=>v===true||v==='true';
const json=v=>typeof v==='string'?JSON.parse(v):v;
const accessMap=row=>Object.fromEntries(json(row?.access||[]).map(x=>[x.grantee,bool(x.execute)]));
const exactSourceCheck=definition=>/^check\(\(?source=any\(array\['backfill'::text,'invite'::text,'executor'::text\]\)\)?\)$/i.test(String(definition||'').replace(/\s+/g,''));

// Supabase хранит migration statements либо одним элементом с полным файлом, либо
// несколькими последовательными фрагментами. Сравнение не печатает ни один вариант.
export function statementsMatch(actual,expected){
 const parts=Array.isArray(actual)?actual.map(String):[String(actual||'')];
 const wanted=norm(expected);
 if(norm(parts.join(''))===wanted)return true;
 if(norm(parts.join('\n'))===wanted)return true;
 if(parts.length>1&&norm(parts.join(';\n'))===wanted)return true;
 return false;
}

export function extractBody(text,name){
 const re=new RegExp('create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.'+name+'\\s*\\([\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s*;','gi');
 return [...String(text).matchAll(re)].at(-1)?.[1]||'';
}

export async function state({env,request=fetch,log=console.log,summary=async()=>{},read=readFile}){
 const token=env.SUPABASE_ACCESS_TOKEN?.trim();
 if(!token)throw Error('Не задан SUPABASE_ACCESS_TOKEN');
 const sql=async query=>{
  assertReadOnlyQuery(query);
  const r=await request('https://api.supabase.com/v1/projects/'+PROJECT+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw Error('Supabase '+r.status+'; подробности скрыты');
  return r.json();
 };
 const [s]=await sql(STATE_QUERY);
 const migrations=await sql(MIGRATION_RECORDS_QUERY);
 const migrationList=await sql(MIGRATIONS_QUERY);
 const defs=await sql(DEFS_QUERY);
 const columns=await sql(COLUMNS_QUERY);
 const constraints=await sql(CONSTRAINTS_QUERY);
 const triggers=await sql(TRIGGER_QUERY);
 const [security]=await sql(SECURITY_QUERY);
 const access=await sql(ACCESS_QUERY);
 const members=columns.length?await sql(MEMBERS_QUERY):[];
 const guardFile=await read('supabase/migrations/20260916100000_studkab_cloud_write_guard.sql','utf8');
 const membersFile=await read('supabase/migrations/20260916100100_studkab_members.sql','utf8');
 const migrationByVersion=Object.fromEntries(migrations.map(x=>[x.version,x]));
 const migrationVerdicts={
  '20260916135700':!!migrationByVersion['20260916135700']&&statementsMatch(migrationByVersion['20260916135700'].statements,guardFile),
  '20260916135724':!!migrationByVersion['20260916135724']&&statementsMatch(migrationByVersion['20260916135724'].statements,membersFile),
 };
 const defByName=Object.fromEntries(defs.map(x=>[x.fn,x.def]));
 const functionVerdicts={
  save_app_data_v2:norm(defByName.save_app_data_v2).includes(norm(extractBody(membersFile,'save_app_data_v2'))),
  studkab_app_data_guard:norm(defByName.studkab_app_data_guard).includes(norm(extractBody(guardFile,'studkab_app_data_guard'))),
  studkab_current_member:norm(defByName.studkab_current_member).includes(norm(extractBody(membersFile,'studkab_current_member'))),
  studkab_member_add:norm(defByName.studkab_member_add).includes(norm(extractBody(membersFile,'studkab_member_add'))),
 };
 const expectedColumns=[['user_id','uuid','uuid','NO',''],['source','text','text','NO',''],['added_at','timestamp with time zone','timestamptz','NO','now()']];
 const columnsOk=columns.length===3&&columns.every((c,i)=>JSON.stringify([c.column_name,c.data_type,c.udt_name,c.is_nullable,c.column_default])===JSON.stringify(expectedColumns[i]));
 const constraintsOk=constraints.length===3
  &&constraints.some(x=>x.contype==='p'&&/^PRIMARY KEY \(user_id\)$/i.test(x.definition))
  &&constraints.some(x=>x.contype==='f'&&/^FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE$/i.test(x.definition))
  &&constraints.some(x=>x.contype==='c'&&exactSourceCheck(x.definition));
 const triggerOk=triggers.length===1&&triggers[0].tgenabled==='O'&&bool(triggers[0].is_row)&&bool(triggers[0].is_before)
  &&bool(triggers[0].on_insert)&&bool(triggers[0].on_update)&&bool(triggers[0].on_delete)
  &&triggers[0].function_name==='studkab_app_data_guard()';
 const grants=json(security?.grants||[]).map(x=>x.grantee+':'+x.privilege).sort();
 const securityOk=bool(security?.rls)&&Number(security?.policies)===0
  &&JSON.stringify(grants)===JSON.stringify(['service_role:INSERT','service_role:SELECT']);
 const accessByName=Object.fromEntries(access.map(x=>[x.fn,x]));
 const exactAccess=(name,{definer,anon,authenticated,service})=>{
  const row=accessByName[name],a=accessMap(row);
  return !!row&&row.owner==='postgres'&&bool(row.security_definer)===definer&&bool(row.empty_search_path)
   &&a.anon===anon&&a.authenticated===authenticated&&a.service_role===service;
 };
 const accessOk=exactAccess('save_app_data_v2',{definer:false,anon:false,authenticated:true,service:true})
  &&exactAccess('studkab_app_data_guard',{definer:false,anon:false,authenticated:false,service:true})
  &&exactAccess('studkab_current_member',{definer:true,anon:false,authenticated:true,service:true})
  &&exactAccess('studkab_member_add',{definer:true,anon:false,authenticated:false,service:true});
 const checks={c051_registered:Number(s.reg_c051)===1,migration_records:Object.values(migrationVerdicts).every(Boolean),functions:Object.values(functionVerdicts).every(Boolean),columns:columnsOk,constraints:constraintsOk,trigger:triggerOk,security:securityOk,access:accessOk};
 const verdict=Object.values(checks).every(Boolean)?'соответствует':'не соответствует';
 const lines=[
  `Фактические миграции: 20260916135700 — ${migrationVerdicts['20260916135700']?'соответствует':'не соответствует'}; 20260916135724 — ${migrationVerdicts['20260916135724']?'соответствует':'не соответствует'}.`,
  `Базовая миграция C-051 (20260915130200): ${Number(s.reg_c051)===1?'зарегистрирована':'не зарегистрирована'}.`,
  `Перечень миграций с 20260915: ${migrationList.length?migrationList.map(x=>x.version+' '+x.name).join('; '):'записей нет'}.`,
  `Объекты C-054: ${Object.entries(checks).filter(([k])=>!['c051_registered','migration_records'].includes(k)).map(([k,v])=>k+' — '+(v?'соответствует':'не соответствует')).join('; ')}.`,
  `Записи: заявок ${s.requests}, облачных записей ${s.cloud}, подписок ${s.subs}, допущенных ${members.reduce((n,x)=>n+Number(x.n),0)}, активных подготовок ${s.active}, наибольшая запись ${s.biggest} байт.`,
  `Вывод: ${verdict}.`,
 ];
 for(const line of lines)log(line);
 await summary('## C-054: расширенная сверка (только чтение)\n'+lines.map(x=>'- '+x).join('\n')+'\n');
 return {checks,migrationVerdicts,functionVerdicts,migrationList,columns,constraints,triggers,security,access,members,...s,verdict};
}

if(import.meta.url===`file://${process.argv[1]}`){
 state({env:process.env,summary:t=>process.env.GITHUB_STEP_SUMMARY?appendFile(process.env.GITHUB_STEP_SUMMARY,t):Promise.resolve()})
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
