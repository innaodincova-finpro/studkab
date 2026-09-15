// C-051: установка правок аудита в рабочую среду одной кнопкой GitHub.
// Порядок: проверки → сводка до изменений → база (два файла) → серверная функция
// → замена пароля посредника → проверка без платного запроса.
// Секреты не выводятся: значения маскируются и не попадают в журнал.
import {readFile,appendFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export const PROJECT='dcpthwmuiodrjepifzsd';
export const WORKER='calm-bird-dae8';
export const WORKER_URL='https://calm-bird-dae8.bf6mhynzgm.workers.dev';
export const ACCOUNT='1335d0bfa8029bd5f2da8867560ac512';

export async function install({env,request=fetch,run=execFileSync,log=console.log,summary=async()=>{},read=readFile,token=()=>randomBytes(32).toString('hex')}){
 const supa=env.SUPABASE_ACCESS_TOKEN?.trim(),cf=env.CLOUDFLARE_API_TOKEN?.trim();
 if(!supa)throw Error('Не задан SUPABASE_ACCESS_TOKEN');
 if(!cf||env.CLOUDFLARE_ACCOUNT_ID?.trim()!==ACCOUNT)throw Error('Не задан доступ Cloudflare');
 const api=async(path,options={})=>{
  const r=await request('https://api.supabase.com/v1/projects/'+PROJECT+path,{...options,headers:{Authorization:'Bearer '+supa,'Content-Type':'application/json'},signal:AbortSignal.timeout(120000)});
  const text=await r.text();
  if(!r.ok)throw Error('Supabase '+r.status+' '+path+': '+text.slice(0,300));
  return text?JSON.parse(text):null;
 };
 const sql=query=>api('/database/query',{method:'POST',body:JSON.stringify({query})});

 // 1. Проверки до изменений.
 const [state]=await sql(`select
  (select count(*) from supabase_migrations.schema_migrations where version in ('20260915130000','20260915130100','20260915130200'))::int installed,
  (select count(*) from supabase_migrations.schema_migrations where version='20260915072854')::int base,
  (select count(*) from public.studkab_gen_jobs where status in ('queued','running'))::int active,
  (select count(*) from public.studkab_requests)::int requests,
  (select count(*) from public.studkab_requirement_passports)::int passports,
  (select count(*) from public.studkab_gen_jobs)::int jobs,
  (select count(*) from public.studkab_gen_attempts)::int attempts,
  (select count(*) from public.studkab_result_versions)::int results,
  (select reserved_microusd from public.studkab_gen_budget where id=true)::bigint reserved`);
 if(state.base!==1)throw Error('Рабочая база не соответствует версии a2f73217: нет изменения 20260915072854');
 if(state.active>0)throw Error('Идёт подготовка работы ('+state.active+'). Установка отложена, ничего не изменено');
 // Доступ Cloudflare к паролям посредника проверяется до любых изменений.
 const cfList=await request(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}/secrets`,{headers:{Authorization:'Bearer '+cf},signal:AbortSignal.timeout(60000)});
 const cfListBody=await cfList.json().catch(()=>({}));
 if(!cfList.ok||!cfListBody.success)throw Error('Нет доступа Cloudflare к паролям посредника ('+cfList.status+'). Ничего не изменено');
 if(!(cfListBody.result||[]).some(x=>x.name==='PROXY_TOKEN'))throw Error('У посредника нет пароля PROXY_TOKEN. Ничего не изменено');
 await summary(`## C-051: установка\nДо изменений: заявок ${state.requests}, паспортов ${state.passports}, заданий ${state.jobs}, попыток ${state.attempts}, результатов ${state.results}, резерв ${state.reserved} мкд.\n`);

 // 2. База. Файлы сами проверяют порядок и повторный запуск.
 if(state.installed===0){
  await sql(await read('supabase/c051-install-1.sql','utf8'));
  await sql(await read('supabase/c051-install-2.sql','utf8'));
 }else if(state.installed!==3)throw Error('База установлена частично ('+state.installed+' из 3). Нужна ручная проверка');
 const [after]=await sql(`select
  (select count(*) from supabase_migrations.schema_migrations where version in ('20260915130000','20260915130100','20260915130200'))::int installed,
  (select count(*) from public.studkab_requests)::int requests,
  (select count(*) from public.studkab_gen_jobs)::int jobs,
  (select count(*) from public.studkab_gen_attempts)::int attempts,
  (select count(*) from public.studkab_result_versions)::int results,
  (select reserved_microusd from public.studkab_gen_budget where id=true)::bigint reserved,
  to_regprocedure('public.studkab_gen_cancel(uuid,uuid)') is not null cancel`);
 if(after.installed!==3||!after.cancel)throw Error('Изменения базы не подтверждены');
 for(const k of ['requests','jobs','attempts','results','reserved'])
  if(String(after[k])!==String(state[k]))throw Error('Изменились рабочие записи: '+k);
 await summary('База: установлено, рабочие записи не изменились.\n');

 // 3. Серверная функция.
 run('supabase',['functions','deploy','studkab-generation-api','--project-ref',PROJECT,'--use-api'],{stdio:'inherit',env:{...process.env,SUPABASE_ACCESS_TOKEN:supa}});
 await summary('Функция studkab-generation-api опубликована.\n');

 // 4. Пароль посредника: одно значение в Supabase и Cloudflare.
 const value=token();
 if(!/^[a-f0-9]{64}$/.test(value))throw Error('Некорректный новый пароль');
 log('::add-mask::'+value);
 const [again]=await sql(`select count(*)::int active from public.studkab_gen_jobs where status in ('queued','running')`);
 if(again.active>0)throw Error('Началась подготовка работы. Пароль не менялся');
 await api('/secrets',{method:'POST',body:JSON.stringify([{name:'STUDKAB_PROXY_TOKEN',value}])});
 const cfr=await request(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}/secrets`,{method:'PUT',headers:{Authorization:'Bearer '+cf,'Content-Type':'application/json'},body:JSON.stringify({name:'PROXY_TOKEN',text:value,type:'secret_text'}),signal:AbortSignal.timeout(60000)});
 const cfj=await cfr.json().catch(()=>({}));
 if(!cfr.ok||!cfj.success)throw Error('Cloudflare не принял новый пароль ('+cfr.status+'). В Supabase он уже записан: подготовка остановлена до повторного запуска');

 // 5. Проверка без платного запроса: неизвестная модель отклоняется до поставщика.
 let accepted=false;
 for(let i=0;i<6&&!accepted;i++){
  if(i)await new Promise(r=>setTimeout(r,10000));
  const probe=await request(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Proxy-Token':value},body:JSON.stringify({provider:'deepseek',model:'c051-probe',system:'x',user:'x'}),signal:AbortSignal.timeout(30000)});
  const body=await probe.json().catch(()=>({}));
  accepted=probe.status===400&&body.error==='UNKNOWN_MODEL:deepseek';
 }
 if(!accepted)throw Error('Посредник не подтвердил новый пароль');
 const names=(await api('/secrets')).map(s=>s.name);
 if(!names.includes('STUDKAB_PROXY_TOKEN'))throw Error('Секрет Supabase не найден');
 await summary('Пароль посредника заменён и проверен без платного запроса.\n');
 return {installed:true};
}

if(import.meta.url===`file://${process.argv[1]}`){
 install({env:process.env,summary:t=>process.env.GITHUB_STEP_SUMMARY?appendFile(process.env.GITHUB_STEP_SUMMARY,t):Promise.resolve()})
  .then(()=>console.log('C-051 установлен'))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
