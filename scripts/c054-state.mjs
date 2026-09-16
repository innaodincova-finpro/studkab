// C-054: состояние рабочей базы по изменениям этапа 3. Только чтение.
// Запуск 16.09.2026 остановился с ошибкой «relation "studkab_members" already exists»:
// объекты в базе есть, а в перечне изменений оба изменения не зарегистрированы.
// Этот сценарий показывает фактическое состояние и ничего не меняет: нет ни одной
// команды изменения данных или схемы, только select.
import {appendFile} from 'node:fs/promises';

export const PROJECT='dcpthwmuiodrjepifzsd';
export const VERSIONS=['20260916100000','20260916100100'];
const FN='public.save_app_data_v2(text,jsonb,bigint)';

export const STATE_QUERY=`select
 (select count(*) from supabase_migrations.schema_migrations where version='20260916100000')::int reg_guard,
 (select count(*) from supabase_migrations.schema_migrations where version='20260916100100')::int reg_members,
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

export async function state({env,request=fetch,log=console.log,summary=async()=>{}}){
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
 const lines=[
  `Перечень изменений: 20260916100000 — ${s.reg_guard?'зарегистрировано':'нет'}, 20260916100100 — ${s.reg_members?'зарегистрировано':'нет'}, C-051 (20260915130200) — ${s.reg_c051?'зарегистрировано':'нет'}.`,
  `Объекты: триггер ${s.trigger_guard?'есть':'нет'}, таблица допущенных ${s.table_members?'есть':'нет'}, функции: защита ${s.fn_guard?'есть':'нет'}, проверка допуска ${s.fn_current?'есть':'нет'}, выдача допуска ${s.fn_add?'есть':'нет'}.`,
  `save_app_data_v2: проверка допуска ${s.save_member?'есть':'нет'}, предел 10 МБ ${s.save_limit?'есть':'нет'}, метка записи через приложение ${s.save_marker?'есть':'нет'}, отпечаток ${s.save_md5||'нет функции'}.`,
  `Записи: заявок ${s.requests}, облачных записей кабинета и реестра ${s.cloud}, подписок ${s.subs}, наибольшая запись ${s.biggest} байт, идущих подготовок ${s.active}.`,
  `Допущено: ${members.length?members.map(m=>m.source+' — '+m.n).join(', '):'таблицы нет'}.`,
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
 return {...s,members,verdict};
}

if(import.meta.url===`file://${process.argv[1]}`){
 state({env:process.env,summary:t=>process.env.GITHUB_STEP_SUMMARY?appendFile(process.env.GITHUB_STEP_SUMMARY,t):Promise.resolve()})
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
