// C-054, пункт 3 задания: публикация функций studkab-requests, studkab-generation,
// studkab-push из main, если они не обновлены после установки базы или не отклоняют
// неверный ключ. Изменения базы не выполняются; права входа функции (verify_jwt)
// не меняются; после публикации те же проверки повторяются.
import {readFile,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {PROJECT,SLUGS,api,functionState,verify} from './c054-verify.mjs';

// Установка базы завершена 16.09.2026 16:59 МСК (13:59 UTC): функции, опубликованные
// раньше этого времени, не содержат проверок допуска из C-054.
export const INSTALLED_AT=Date.parse('2026-09-16T13:59:00Z');

export function needsPublish({functions,answers}){
 const reasons=[];
 for(const f of functions){
  if(f.missing){reasons.push('функция '+f.slug+' не найдена');continue;}
  const updated=f.updated_at?new Date(f.updated_at).getTime():0;
  if(!updated||updated<INSTALLED_AT)reasons.push('функция '+f.slug+' не обновлялась после установки базы');
 }
 for(const a of answers)if(!/ответ (\d+), ожидался \1$/.test(a))reasons.push('проверка доступа: '+a);
 return reasons;
}

export async function deploy({env,request=fetch,run=execFileSync,log=console.log,summary=async()=>{},read=readFile,wait=ms=>new Promise(r=>setTimeout(r,ms)),force=false}){
 const call=api(env,request);
 const before=await verify({env,request,log,summary,read,wait});
 const reasons=force?['публикация запрошена явно']:needsPublish(before);
 if(!reasons.length){
  log('Публикация не требуется: функции обновлены после установки базы и неверный ключ отклоняется.');
  await summary('Публикация не требуется: функции обновлены после установки базы, проверки доступа пройдены.\n');
  return {published:false,before,reasons};
 }
 log('Публикация нужна: '+reasons.join('; '));
 await summary('## C-054: публикация функций\nОснование: '+reasons.join('; ')+'\n');

 const was=Object.fromEntries((await functionState(call)).map(f=>[f.slug,f]));
 const supa=env.SUPABASE_ACCESS_TOKEN.trim();
 for(const slug of SLUGS)
  run('supabase',['functions','deploy',slug,'--project-ref',PROJECT,'--use-api'],{stdio:'inherit',env:{...process.env,SUPABASE_ACCESS_TOKEN:supa}});
 const now=Object.fromEntries((await functionState(call)).map(f=>[f.slug,f]));
 for(const slug of SLUGS){
  const a=was[slug],b=now[slug];
  if(!b||b.missing||b.status!=='ACTIVE')throw Error('Функция '+slug+' не подтверждена как рабочая');
  if(!a.missing&&!(Number(b.version)>Number(a.version)))throw Error('Функция '+slug+' не обновилась (версия '+b.version+')');
  if(!a.missing&&a.verify_jwt!==b.verify_jwt)throw Error('У функции '+slug+' изменилась проверка входа');
  log('Опубликовано '+slug+': версия '+(a.missing?'':a.version+' → ')+b.version+', проверка входа '+b.verify_jwt);
 }
 await summary(SLUGS.map(s=>`Функция ${s}: версия ${now[s].version}.`).join(' ')+'\n');

 // Повтор тех же проверок после публикации.
 const after=await verify({env,request,log,summary,read,wait});
 if(after.problems.length)throw Error('После публикации остались замечания: '+after.problems.join('; '));
 return {published:true,before,after,reasons};
}

if(import.meta.url===`file://${process.argv[1]}`){
 deploy({env:process.env,force:process.argv.includes('--force'),summary:t=>process.env.GITHUB_STEP_SUMMARY?appendFile(process.env.GITHUB_STEP_SUMMARY,t):Promise.resolve()})
  .then(r=>console.log(r.published?'Функции опубликованы и проверены':'Публикация не потребовалась'))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
