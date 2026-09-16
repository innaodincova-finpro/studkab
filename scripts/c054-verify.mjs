// C-054, пункты 10в, 10г (проверка без публикации), 10д и 10е: проверка после того,
// как изменения базы уже применены. Ничего не меняет: к базе идут только select,
// функции не публикуются, настройки входа только читаются, проверки доступа
// выполняются заведомо неверным ключом и отклоняются до обращения к поставщику.
import {readFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PROJECT,BASE,PROBES,VERSIONS} from './c054-install.mjs';

export {PROJECT,BASE,PROBES,VERSIONS};
const SLUGS=PROBES.map(([slug])=>slug);
// Изменения применены 16.09.2026 средствами Supabase: номер записи — время
// применения, название — имя файла. Поэтому запись ищется и по номеру, и по названию.
export const RECORDS_QUERY=`select version,name,coalesce(array_length(statements,1),0)::int parts,
 regexp_replace(array_to_string(statements,E'\\n'),'\\s+',' ','g') joined
 from supabase_migrations.schema_migrations
 where version in (${VERSIONS.map(([v])=>`'${v}'`).join(',')})
    or name in (${VERSIONS.map(([v,n])=>`'${v}_${n}','${n}'`).join(',')})
 order by version`;

const norm=text=>String(text||'').replace(/\s+/g,' ').trim();

export async function verify({env,request=fetch,log=console.log,summary=async()=>{},read=readFile,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 const supa=env.SUPABASE_ACCESS_TOKEN?.trim();
 if(!supa)throw Error('Не задан SUPABASE_ACCESS_TOKEN');
 const api=async(path,options={})=>{
  const r=await request('https://api.supabase.com/v1/projects/'+PROJECT+path,{...options,headers:{Authorization:'Bearer '+supa,'Content-Type':'application/json'},signal:AbortSignal.timeout(120000)});
  const text=await r.text();
  if(!r.ok)throw Error('Supabase '+r.status+' '+path+': '+text.slice(0,300));
  return text?JSON.parse(text):null;
 };
 const sql=query=>{
  if(!/^\s*select/i.test(query))throw Error('Сценарий выполняет только чтение');
  return api('/database/query',{method:'POST',body:JSON.stringify({query})});
 };
 const problems=[];

 // 1. Пункт 10в: записи в перечне изменений и сверка текста с файлами и описью.
 const records=await sql(RECORDS_QUERY);
 const manifest=JSON.parse(await read('supabase/migrations/manifest.json','utf8'));
 const texts=[];
 for(const [version,name] of VERSIONS){
  const file=await read(`supabase/migrations/${version}_${name}.sql`,'utf8');
  const sha=createHash('sha256').update(file).digest('hex');
  const item=manifest.migrations.concat(manifest.pending_migrations||[]).find(m=>m.version===version);
  const record=records.find(r=>r.version===version||r.name===version+'_'+name||r.name===name);
  if(!item||item.sha256!==sha)problems.push('Опись не совпадает с файлом '+version);
  if(!record){problems.push('В перечне изменений нет записи для '+version);texts.push([version,'записи нет']);continue;}
  const same=norm(record.joined)===norm(file);
  texts.push([version,`записано как ${record.version} «${record.name}», частей ${record.parts}, текст ${same?'совпадает с файлом':'отличается оформлением — нужна ручная сверка'}`]);
  if(!same)problems.push('Текст изменения '+version+' в базе отличается от файла по оформлению');
 }
 const lines=['Пункт 10в. '+texts.map(([v,t])=>v+': '+t).join('; ')+'.'];

 // 2. Пункт 10г: состояние функций без публикации.
 const funcs=(await api('/functions')).filter(f=>SLUGS.includes(f.slug));
 lines.push('Пункт 10г (без публикации). '+SLUGS.map(slug=>{
  const f=funcs.find(x=>x.slug===slug);
  if(!f){problems.push('Функция '+slug+' не найдена');return slug+': не найдена';}
  if(f.status!=='ACTIVE')problems.push('Функция '+slug+' не рабочая: '+f.status);
  return `${slug}: версия ${f.version}, состояние ${f.status}, проверка входа ${f.verify_jwt}, обновлена ${f.updated_at?new Date(f.updated_at).toISOString():'неизвестно'}`;
 }).join('; ')+'.');

 // 3. Пункт 10д: неверный ключ отклоняется. Платных запросов нет.
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
 lines.push('Пункт 10д. '+answers.join('; ')+'.');

 // 4. Пункт 10е: пределы входа только читаются, секреты не выводятся.
 const auth=await api('/config/auth');
 const limits=Object.entries(auth||{}).filter(([k])=>k.startsWith('rate_limit_')||k==='security_captcha_enabled').sort();
 lines.push('Пункт 10е (без изменений). '+limits.map(([k,v])=>k+'='+v).join(', ')+'.');

 for(const line of lines)log(line);
 await summary('## C-054: проверка после установки (без изменений)\n'+lines.map(l=>'- '+l).join('\n')+'\n');
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
