// C-054: состояние рабочей базы по изменениям этапа 3. Только чтение.
// Изменения установлены 16.09.2026 под номерами времени применения 20260916135700 и
// 20260916135724; названия записей — имена исходных файлов. Сценарий показывает
// фактическое состояние и ничего не меняет: нет ни одной команды изменения данных
// или схемы, только select.
import {appendFile,readFile} from 'node:fs/promises';

export const PROJECT='dcpthwmuiodrjepifzsd';
export const VERSIONS=['20260916135700','20260916135724'];
const FN='public.save_app_data_v2(text,jsonb,bigint)';

export const STATE_QUERY=`select
 (select count(*) from supabase_migrations.schema_migrations where version='20260916135700')::int reg_guard,
 (select count(*) from supabase_migrations.schema_migrations where version='20260916135724')::int reg_members,
 (select count(*) from supabase_migrations.schema_migrations where version='20260915130200')::int reg_c051,
 (select count(*) from pg_trigger where tgrelid='public.app_data'::regclass and tgname='studkab_app_data_guard')::int trigger_guard,
 to_regclass('public.studkab_members') is not null table_members,
 to_regprocedure('public.studkab_app_data_guard()') is not null fn_guard,
 to_regprocedure('public.studkab_current_member()') is not null fn_current,
 to_regprocedure('public.studkab_member_add(uuid)') is not null fn_add,
 (select count(*) from public.studkab_requests)::int requests,
 (select count(*) from public.app_data where app in ('kabinet','reestr'))::int cloud,
 (select count(*) from public.studkab_push_subscriptions)::int subs,
 (select coalesce(max(octet_length(data::text)),0) from public.app_data where app in ('kabinet','reestr'))::bigint biggest,
 (select count(*) from public.studkab_gen_jobs where status in ('queued','running'))::int active,
 (select position('studkab_current_member' in pg_get_functiondef(to_regprocedure('${FN}')))>0) save_member,
 (select position('10485760' in pg_get_functiondef(to_regprocedure('${FN}')))>0) save_limit,
 (select position('studkab.cloud_write' in pg_get_functiondef(to_regprocedure('${FN}')))>0) save_marker,
 (select md5(pg_get_functiondef(to_regprocedure('${FN}')))) save_md5`;

export const MEMBERS_QUERY=`select source,count(*)::int n from public.studkab_members group by source order by source`;

// Перечень изменений с 20260915: только номер и название, текст изменений не читается.
export const MIGRATIONS_QUERY=`select version,name from supabase_migrations.schema_migrations where version >= '20260915' order by version`;

// Текст функций в базе для сверки с файлами изменений.
export const DEFS_QUERY=`select 'save_app_data_v2' fn, pg_get_functiondef(to_regprocedure('${FN}')) def
 union all select 'studkab_app_data_guard', pg_get_functiondef(to_regprocedure('public.studkab_app_data_guard()'))
 union all select 'studkab_current_member', pg_get_functiondef(to_regprocedure('public.studkab_current_member()'))
 union all select 'studkab_member_add', pg_get_functiondef(to_regprocedure('public.studkab_member_add(uuid)'))`;

export const COLUMNS_QUERY=`select column_name,data_type,is_nullable,coalesce(column_default,'') column_default
 from information_schema.columns where table_schema='public' and table_name='studkab_members' order by ordinal_position`;

export const GRANTS_QUERY=`select
 (select coalesce(string_agg(distinct grantee||': '||privilege_type,', ' order by grantee||': '||privilege_type),'нет')
  from information_schema.role_table_grants where table_schema='public' and table_name='studkab_members') grants,
 (select relrowsecurity from pg_class where oid='public.studkab_members'::regclass) rls,
 (select count(*)::int from pg_policies where schemaname='public' and tablename='studkab_members') policies`;

// Тексты сравниваются по телу функции: база возвращает своё оформление заголовка,
// поэтому совпадение проверяется по содержимому между ограничителями и без учёта
// различий в пробелах.
const norm=text=>String(text||'').replace(/\s+/g,' ').trim();
export function bodyFromFile(text,name){
 const re=new RegExp('create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.'+name+'\\s*\\([\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s*;','gi');
 const found=[...String(text).matchAll(re)];
 return found.length?norm(found.at(-1)[1]):null;
}
export function bodyFromDatabase(def){
 const tag=String(def||'').match(/\$([a-z_]*)\$/i);
 if(!tag)return null;
 const parts=String(def).split(tag[0]);
 return parts.length<3?null:norm(parts.slice(1,-1).join(tag[0]));
}

export async function state({env,request=fetch,log=console.log,summary=async()=>{},read=readFile}){
 const supa=env.SUPABASE_ACCESS_TOKEN?.trim();
 if(!supa)throw Error('Не задан SUPABASE_ACCESS_TOKEN');
 const sql=async query=>{
  if(!/^\s*select/i.test(query))throw Error('Сценарий выполняет только чтение');
  const r=await request('https://api.supabase.com/v1/projects/'+PROJECT+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+supa,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(120000)});
  const text=await r.text();
  if(!r.ok)throw Error('Supabase '+r.status+': '+text.slice(0,300));
  return JSON.parse(text);
 };
 const [s]=await sql(STATE_QUERY);
 const members=s.table_members?await sql(MEMBERS_QUERY):[];
 const migrations=await sql(MIGRATIONS_QUERY);
 const defs=Object.fromEntries((await sql(DEFS_QUERY)).map(r=>[r.fn,r.def]));
 const columns=s.table_members?await sql(COLUMNS_QUERY):[];
 const [access]=s.table_members?await sql(GRANTS_QUERY):[{grants:'таблицы нет',rls:null,policies:0}];

 // Сверка текста функций с файлами изменений.
 const guardFile=await read('supabase/migrations/20260916135700_20260916100000_studkab_cloud_write_guard.sql','utf8');
 const membersFile=await read('supabase/migrations/20260916135724_20260916100100_studkab_members.sql','utf8');
 const expected={
  save_app_data_v2:[['20260916135724',bodyFromFile(membersFile,'save_app_data_v2')],['20260916135700',bodyFromFile(guardFile,'save_app_data_v2')]],
  studkab_app_data_guard:[['20260916135700',bodyFromFile(guardFile,'studkab_app_data_guard')]],
  studkab_current_member:[['20260916135724',bodyFromFile(membersFile,'studkab_current_member')]],
  studkab_member_add:[['20260916135724',bodyFromFile(membersFile,'studkab_member_add')]],
 };
 const comparison=Object.entries(expected).map(([fn,variants])=>{
  const body=bodyFromDatabase(defs[fn]);
  if(!body)return [fn,'функции нет в базе'];
  const hit=variants.find(([,text])=>text&&text===body);
  return [fn,hit?'совпадает с '+hit[0]:'не совпадает'];
 });

 const lines=[
  `Перечень изменений: 20260916135700 — ${s.reg_guard?'зарегистрировано':'нет'}, 20260916135724 — ${s.reg_members?'зарегистрировано':'нет'}, C-051 (20260915130200) — ${s.reg_c051?'зарегистрировано':'нет'}.`,
  `Объекты: триггер ${s.trigger_guard?'есть':'нет'}, таблица допущенных ${s.table_members?'есть':'нет'}, функции: защита ${s.fn_guard?'есть':'нет'}, проверка допуска ${s.fn_current?'есть':'нет'}, выдача допуска ${s.fn_add?'есть':'нет'}.`,
  `save_app_data_v2: проверка допуска ${s.save_member?'есть':'нет'}, предел 10 МБ ${s.save_limit?'есть':'нет'}, метка записи через приложение ${s.save_marker?'есть':'нет'}, отпечаток ${s.save_md5||'нет функции'}.`,
  `Записи: заявок ${s.requests}, облачных записей кабинета и реестра ${s.cloud}, подписок ${s.subs}, наибольшая запись ${s.biggest} байт, идущих подготовок ${s.active}.`,
  `Допущено: ${members.length?members.map(m=>m.source+' — '+m.n).join(', '):'таблицы нет'}.`,
  `Перечень изменений с 20260915: ${migrations.length?migrations.map(m=>m.version+' '+m.name).join('; '):'записей нет'}.`,
  `Тексты функций против файлов изменений: ${comparison.map(([fn,verdict])=>fn+' — '+verdict).join('; ')}.`,
  `Таблица studkab_members: ${columns.length?columns.map(c=>`${c.column_name} ${c.data_type}${c.is_nullable==='NO'?' not null':''}${c.column_default?' по умолчанию '+c.column_default:''}`).join('; '):'таблицы нет'}.`,
  `Права studkab_members: ${access.grants}; защита строк ${access.rls===null?'неизвестно':access.rls?'включена':'выключена'}; политик ${access.policies}.`,
 ];
 for(const line of lines)log(line);
 await summary('## C-054: состояние рабочей базы (только чтение)\n'+lines.map(l=>'- '+l).join('\n')+'\n');
 // Вывод для следующего шага: объекты без записи в перечне — расхождение.
 const objects=[s.trigger_guard===1,s.table_members,s.fn_guard,s.fn_current,s.fn_add];
 const registered=VERSIONS.every((v,i)=>(i?s.reg_members:s.reg_guard)===1);
 const verdict=objects.every(Boolean)&&!registered?'объекты есть, в перечне изменений не зарегистрированы'
  :objects.every(Boolean)&&registered?'установлено и зарегистрировано'
  :objects.some(Boolean)?'установлено частично'
  :'не установлено';
 log('Вывод: '+verdict);
 await summary('Вывод: '+verdict+'\n');
 return {...s,members,migrations,columns,access,comparison:Object.fromEntries(comparison),verdict};
}

if(import.meta.url===`file://${process.argv[1]}`){
 state({env:process.env,summary:t=>process.env.GITHUB_STEP_SUMMARY?appendFile(process.env.GITHUB_STEP_SUMMARY,t):Promise.resolve()})
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
