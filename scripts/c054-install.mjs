// C-054, пункт 10 задания: установка изменений в рабочую среду одной кнопкой GitHub.
// Порядок пункта 10 задания: сводка до изменений → база (один файл, оба изменения)
// → сверка текста с описью и проверка сохранности записей → публикация трёх функций
// → проверки доступа без платных запросов → значения ограничений входа (только чтение).
// Секреты не читаются и не выводятся: из настроек входа берутся только пределы.
import {readFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export const PROJECT='dcpthwmuiodrjepifzsd';
export const BASE='https://dcpthwmuiodrjepifzsd.supabase.co';
export const VERSIONS=[['20260916100000','studkab_cloud_write_guard'],['20260916100100','studkab_members']];
// Проверки доступа: ключ заведомо неверный, поэтому ни одна работа не запускается.
export const PROBES=[
 ['studkab-requests',{'x-job-key':'wrong'},403],
 ['studkab-generation',{'X-Studkab-Runner':'wrong'},401],
 ['studkab-push',{'x-job-key':'wrong'},403],
];
const LIST=VERSIONS.map(([v])=>`'${v}'`).join(',');

export async function install({env,request=fetch,run=execFileSync,log=console.log,summary=async()=>{},read=readFile,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 const supa=env.SUPABASE_ACCESS_TOKEN?.trim();
 if(!supa)throw Error('Не задан SUPABASE_ACCESS_TOKEN');
 const api=async(path,options={})=>{
  const r=await request('https://api.supabase.com/v1/projects/'+PROJECT+path,{...options,headers:{Authorization:'Bearer '+supa,'Content-Type':'application/json'},signal:AbortSignal.timeout(120000)});
  const text=await r.text();
  if(!r.ok)throw Error('Supabase '+r.status+' '+path+': '+text.slice(0,300));
  return text?JSON.parse(text):null;
 };
 const sql=query=>api('/database/query',{method:'POST',body:JSON.stringify({query})});

 // 1. Состояние до изменений (пункт 10а). Ничего не меняется.
 const [before]=await sql(`select
  (select count(*) from supabase_migrations.schema_migrations where version in (${LIST}))::int installed,
  (select count(*) from supabase_migrations.schema_migrations where version='20260915130200')::int base,
  (select count(*) from public.studkab_gen_jobs where status in ('queued','running'))::int active,
  (select count(*) from public.studkab_requests)::int requests,
  (select count(*) from public.app_data where app in ('kabinet','reestr'))::int cloud,
  (select count(*) from public.studkab_push_subscriptions)::int subs,
  (select coalesce(max(octet_length(data::text)),0) from public.app_data where app in ('kabinet','reestr'))::bigint biggest,
  (select count(*) from auth.users u join public.studkab_request_config c on c.id and lower(u.email)=lower(c.executor_email))::int executor,
  (select count(*) from (
    select student_id as user_id from public.studkab_requests
    union select user_id from public.app_data where app in ('kabinet','reestr')
    union select user_id from public.studkab_push_subscriptions
   ) x join auth.users u on u.id=x.user_id)::int expected`);
 if(before.base!==1)throw Error('Рабочая база не соответствует C-051: нет изменения 20260915130200');
 if(before.active>0)throw Error('Идёт подготовка работы ('+before.active+'). Установка отложена, ничего не изменено');
 if(Number(before.biggest)>10485760)throw Error('Есть запись кабинета или реестра больше 10 МБ ('+before.biggest+' байт). Установка остановлена, ничего не изменено');
 if(before.executor<1)throw Error('Исполнитель из studkab_request_config не найден среди аккаунтов: список допущенных оставил бы исполнителя без доступа');
 await summary(`## C-054: установка\nДо изменений: заявок ${before.requests}, облачных записей кабинета и реестра ${before.cloud}, подписок ${before.subs}, наибольшая запись ${before.biggest} байт, допуск ожидается у ${before.expected} аккаунтов.\n`);

 // 2. База (пункт 10б). Файл сам проверяет порядок и повторный запуск.
 if(before.installed===0)await sql(await read('supabase/c054-install.sql','utf8'));
 else if(before.installed!==2)throw Error('База установлена частично ('+before.installed+' из 2). Нужна ручная проверка');

 // 3. Проверка изменений и сохранности записей (пункт 10в).
 const [after]=await sql(`select
  (select count(*) from supabase_migrations.schema_migrations where version in (${LIST}))::int installed,
  (select count(*) from public.studkab_requests)::int requests,
  (select count(*) from public.app_data where app in ('kabinet','reestr'))::int cloud,
  (select count(*) from public.studkab_push_subscriptions)::int subs,
  (select count(*) from pg_trigger where tgrelid='public.app_data'::regclass and tgname='studkab_app_data_guard')::int guard,
  (select count(*) from public.studkab_members)::int members,
  (select count(*) from public.studkab_members where source='executor')::int executor,
  (select count(*) from public.studkab_members where source='backfill')::int backfill,
  (select count(*) from public.studkab_members where source='invite')::int invited,
  to_regprocedure('public.studkab_member_add(uuid)') is not null member_add`);
 if(after.installed!==2||after.guard!==1||!after.member_add)throw Error('Изменения базы не подтверждены');
 for(const k of ['requests','cloud','subs'])
  if(String(after[k])!==String(before[k]))throw Error('Изменились рабочие записи: '+k);
 if(after.executor<1)throw Error('Исполнитель не получил допуск');
 if(after.members<before.expected)throw Error('Допуск получили не все действующие пользователи: '+after.members+' из '+before.expected);
 const manifest=JSON.parse(await read('supabase/migrations/manifest.json','utf8'));
 const recorded=await sql(`select version,encode(sha256(convert_to(statements[1],'UTF8')),'hex') sha from supabase_migrations.schema_migrations where version in (${LIST}) order by version`);
 for(const [version,name] of VERSIONS){
  const item=(manifest.pending_migrations||[]).concat(manifest.migrations).find(m=>m.version===version);
  const file=await read('supabase/migrations/'+version+'_'+name+'.sql','utf8');
  if(!item||createHash('sha256').update(file).digest('hex')!==item.sha256)throw Error('Опись не совпадает с файлом изменения '+version);
  if(recorded.find(r=>r.version===version)?.sha!==item.sha256)throw Error('Текст изменения '+version+' в базе не совпадает с описью');
 }
 await summary(`База: установлено, текст совпадает с описью. Допущено ${after.members}: исполнитель ${after.executor}, перенесено ${after.backfill}, по приглашению ${after.invited}. Заявки ${after.requests}, облачные записи ${after.cloud}, подписки ${after.subs} — без изменений.\n`);

 // 4. Функции (пункт 10г). Права доступа функции (verify_jwt) не меняются.
 const slugs=PROBES.map(([slug])=>slug);
 const state=async()=>Object.fromEntries((await api('/functions')).filter(f=>slugs.includes(f.slug)).map(f=>[f.slug,{version:f.version,verify_jwt:f.verify_jwt,status:f.status}]));
 const funcsBefore=await state();
 for(const slug of slugs)
  run('supabase',['functions','deploy',slug,'--project-ref',PROJECT,'--use-api'],{stdio:'inherit',env:{...process.env,SUPABASE_ACCESS_TOKEN:supa}});
 const funcsAfter=await state();
 for(const slug of slugs){
  const was=funcsBefore[slug],now=funcsAfter[slug];
  if(!now||now.status!=='ACTIVE')throw Error('Функция '+slug+' не подтверждена как рабочая');
  if(was&&!(Number(now.version)>Number(was.version)))throw Error('Функция '+slug+' не обновилась (версия '+now.version+')');
  if(was&&was.verify_jwt!==now.verify_jwt)throw Error('У функции '+slug+' изменилась проверка входа');
  log('Функция '+slug+': версия '+(was?was.version+' → ':'')+now.version+', проверка входа '+now.verify_jwt);
 }
 await summary(slugs.map(s=>`Функция ${s}: версия ${funcsAfter[s].version}.`).join(' ')+'\n');

 // 5. Проверки доступа без платных запросов (пункт 10д): неверный ключ отклоняется.
 for(const [slug,headers,expected] of PROBES){
  let got=0;
  for(let i=0;i<6&&got!==expected;i++){
   if(i)await wait(5000);
   const r=await request(BASE+'/functions/v1/'+slug,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}',signal:AbortSignal.timeout(30000)});
   got=r.status;
   await r.text().catch(()=>'');
  }
  log('Проверка доступа '+slug+': ответ '+got+', ожидался '+expected);
  if(got!==expected)throw Error('Функция '+slug+' ответила '+got+' вместо '+expected);
 }
 await summary('Проверки доступа: '+PROBES.map(([s,,e])=>s+' → '+e).join(', ')+'. Платных запросов не выполнялось.\n');

 // 6. Ограничения попыток входа (пункт 10е): только чтение и только пределы.
 const auth=await api('/config/auth');
 const limits=Object.entries(auth||{}).filter(([k])=>k.startsWith('rate_limit_')||k==='security_captcha_enabled').sort();
 for(const [k,v] of limits)log('Supabase Auth '+k+': '+v);
 await summary('Ограничения входа (без изменений): '+limits.map(([k,v])=>k+'='+v).join(', ')+'\n');

 return {installed:true,members:after.members,limits:Object.fromEntries(limits)};
}

if(import.meta.url===`file://${process.argv[1]}`){
 install({env:process.env,summary:t=>process.env.GITHUB_STEP_SUMMARY?appendFile(process.env.GITHUB_STEP_SUMMARY,t):Promise.resolve()})
  .then(r=>console.log('C-054 установлен, допущено '+r.members))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
