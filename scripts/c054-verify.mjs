// C-054, пункт 10 задания после установки базы (выполнена 16.09.2026 под номерами
// времени применения). Сценарий ничего не меняет: к базе идут только select, функции
// не публикуются, настройки входа только читаются, а проверки доступа выполняются
// заведомо неверным ключом и отклоняются до обращения к поставщику.
import {readFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const PROJECT='dcpthwmuiodrjepifzsd';
export const BASE='https://dcpthwmuiodrjepifzsd.supabase.co';
export const MIGRATIONS=[
 {version:'20260916135700',name:'20260916100000_studkab_cloud_write_guard',file:'20260916135700_20260916100000_studkab_cloud_write_guard.sql'},
 {version:'20260916135724',name:'20260916100100_studkab_members',file:'20260916135724_20260916100100_studkab_members.sql'},
];
// Ключ заведомо неверный, поэтому ни одна работа не запускается и платных запросов нет.
export const PROBES=[
 ['studkab-requests',{'x-job-key':'wrong'},403],
 ['studkab-generation',{'X-Studkab-Runner':'wrong'},401],
 ['studkab-push',{'x-job-key':'wrong'},403],
];
export const SLUGS=PROBES.map(([slug])=>slug);
export const RECORDS_QUERY=`select version,name,coalesce(array_length(statements,1),0)::int parts,
 encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex') sha,
 regexp_replace(array_to_string(statements,E'\\n'),'\\s+',' ','g') joined
 from supabase_migrations.schema_migrations
 where version in (${MIGRATIONS.map(m=>`'${m.version}'`).join(',')})
    or name in (${MIGRATIONS.map(m=>`'${m.name}'`).join(',')})
 order by version`;

const norm=text=>String(text||'').replace(/\s+/g,' ').trim();

export function api(env,request){
 const supa=env.SUPABASE_ACCESS_TOKEN?.trim();
 if(!supa)throw Error('Не задан SUPABASE_ACCESS_TOKEN');
 return async(path,options={})=>{
  const r=await request('https://api.supabase.com/v1/projects/'+PROJECT+path,{...options,headers:{Authorization:'Bearer '+supa,'Content-Type':'application/json'},signal:AbortSignal.timeout(120000)});
  const text=await r.text();
  if(!r.ok)throw Error('Supabase '+r.status+' '+path+': '+text.slice(0,300));
  return text?JSON.parse(text):null;
 };
}

export async function functionState(call){
 const list=await call('/functions');
 return SLUGS.map(slug=>list.find(f=>f.slug===slug)||{slug,missing:true});
}

export async function verify({env,request=fetch,log=console.log,summary=async()=>{},read=readFile,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 const call=api(env,request);
 const sql=query=>{
  if(!/^\s*select/i.test(query))throw Error('Сценарий выполняет только чтение');
  return call('/database/query',{method:'POST',body:JSON.stringify({query})});
 };
 const problems=[],lines=[];

 // 1. Текст изменений в базе против файлов и описи (пункт 10в).
 const records=await sql(RECORDS_QUERY);
 const manifest=JSON.parse(await read('supabase/migrations/manifest.json','utf8'));
 const texts=[];
 for(const m of MIGRATIONS){
  const file=await read('supabase/migrations/'+m.file,'utf8');
  const sha=createHash('sha256').update(file).digest('hex');
  const item=manifest.migrations.find(x=>x.version===m.version);
  if(!item||item.sha256!==sha)problems.push('Опись не совпадает с файлом '+m.file);
  const record=records.find(r=>r.version===m.version||r.name===m.name);
  if(!record){problems.push('В перечне изменений нет записи '+m.version);texts.push(`${m.version}: записи нет`);continue;}
  const same=record.sha===sha,similar=norm(record.joined)===norm(file);
  texts.push(`${m.version} «${record.name}», частей ${record.parts}: SHA записи ${record.sha}, SHA файла ${sha} — ${same?'совпадает':similar?'не совпадает дословно, текст отличается только пробелами':'не совпадает'}`);
  if(!same&&!similar)problems.push('Текст изменения '+m.version+' в базе отличается от файла');
 }
 lines.push('Пункт 1а, изменения базы. '+texts.join('; ')+'.');

 // 2. Состояние функций без публикации (пункт 10г).
 const funcs=await functionState(call);
 lines.push('Пункт 1б, функции (без публикации). '+funcs.map(f=>{
  if(f.missing){problems.push('Функция '+f.slug+' не найдена');return f.slug+': не найдена';}
  if(f.status!=='ACTIVE')problems.push('Функция '+f.slug+' не рабочая: '+f.status);
  return `${f.slug}: версия ${f.version}, обновлена ${f.updated_at?new Date(f.updated_at).toISOString():'неизвестно'}, проверка входа ${f.verify_jwt}, состояние ${f.status}`;
 }).join('; ')+'.');

 // 3. Проверки доступа неверным ключом (пункт 10д). Платных запросов нет.
 const answers=[];
 for(const [slug,headers,expected] of PROBES){
  let got=0;
  for(let i=0;i<3&&got!==expected;i++){
   if(i)await wait(5000);
   const r=await request(BASE+'/functions/v1/'+slug,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}',signal:AbortSignal.timeout(30000)});
   got=r.status;
   await r.text().catch(()=>'');
  }
  answers.push(`${slug}: ответ ${got}, ожидался ${expected}`);
  if(got!==expected)problems.push('Функция '+slug+' ответила '+got+' вместо '+expected);
 }
 lines.push('Пункт 1в, проверки доступа. '+answers.join('; ')+'.');

 // 4. Пределы входа: только чтение, секреты не выводятся (пункт 10е).
 const auth=await call('/config/auth');
 const limits=Object.entries(auth||{}).filter(([k])=>k.startsWith('rate_limit_')||k==='security_captcha_enabled').sort();
 lines.push('Пункт 1г, ограничения входа (без изменений). '+limits.map(([k,v])=>k+'='+v).join(', ')+'.');

 for(const line of lines)log(line);
 await summary('## C-054: проверка рабочей среды (без изменений)\n'+lines.map(l=>'- '+l).join('\n')+'\n');
 if(problems.length){
  for(const p of problems)log('Замечание: '+p);
  await summary('Замечания:\n'+problems.map(p=>'- '+p).join('\n')+'\n');
 }else{
  log('Замечаний нет.');
  await summary('Замечаний нет.\n');
 }
 return {records,functions:funcs,answers,limits:Object.fromEntries(limits),problems};
}

if(import.meta.url===`file://${process.argv[1]}`){
 verify({env:process.env,summary:t=>process.env.GITHUB_STEP_SUMMARY?appendFile(process.env.GITHUB_STEP_SUMMARY,t):Promise.resolve()})
  .then(r=>{if(r.problems.length)process.exitCode=1;})
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
