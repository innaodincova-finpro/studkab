import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verify,RECORDS_QUERY,PROBES,VERSIONS} from '../scripts/c054-verify.mjs';

const env={SUPABASE_ACCESS_TOKEN:'test-supa'};
const SLUGS=PROBES.map(([slug])=>slug);
const AUTH={rate_limit_verify:30,rate_limit_otp:30,security_captcha_enabled:false,smtp_pass:'secret-smtp-pass'};
// Так изменения записаны в рабочей базе: номер — время применения, название — имя файла.
const recorded=async(overrides={})=>Promise.all(VERSIONS.map(async([version,name],i)=>({
 version:['20260916135700','20260916135724'][i],
 name:version+'_'+name,
 parts:1,
 joined:await readFile(`supabase/migrations/${version}_${name}.sql`,'utf8'),
 ...(overrides[version]||{}),
})));

function world({records=null,funcs=null,probe={},auth=AUTH}={}){
 const queries=[],logs=[],calls=[];
 const request=async(url,o={})=>{
  calls.push({url,method:o.method||'GET',headers:o.headers||{}});
  if(url.endsWith('/database/query')){
   const query=JSON.parse(o.body).query;
   queries.push(query);
   return Response.json(records);
  }
  if(url.endsWith('/functions'))return Response.json(funcs||SLUGS.map((slug,i)=>({slug,version:4+i,status:'ACTIVE',verify_jwt:slug==='studkab-generation',updated_at:'2026-09-16T13:57:00Z'})));
  if(url.endsWith('/config/auth'))return Response.json(auth);
  if(url.includes('/functions/v1/')){
   const slug=url.split('/functions/v1/')[1];
   return new Response('{}',{status:probe[slug]??PROBES.find(([s])=>s===slug)[2]});
  }
  throw Error('неожиданный запрос '+url);
 };
 return {queries,logs,calls,args:{env,request,read:readFile,wait:async()=>{},log:m=>logs.push(String(m))}};
}

test('C-054 проверка: записи перечня, состояние функций, ответы доступа и пределы входа',async()=>{
 const w=world({records:await recorded()});
 const result=await verify(w.args);
 assert.deepEqual(result.problems,[]);
 const text=w.logs.join('\n');
 assert.match(text,/20260916100000: записано как 20260916135700 «20260916100000_studkab_cloud_write_guard», частей 1, текст совпадает с файлом/);
 assert.match(text,/20260916100100: записано как 20260916135724 .*текст совпадает с файлом/);
 assert.match(text,/studkab-requests: версия 4, состояние ACTIVE/);
 assert.match(text,/studkab-requests: ответ 403, ожидался 403/);
 assert.match(text,/studkab-generation: ответ 401, ожидался 401/);
 assert.match(text,/rate_limit_verify=30/);
 assert.match(text,/Замечаний нет/);
 assert.ok(!text.includes('secret-smtp-pass'),'секрет попал в журнал');
});

test('C-054 проверка: к базе идут только select, функции не публикуются',async()=>{
 const w=world({records:await recorded()});
 await verify(w.args);
 assert.deepEqual(w.queries,[RECORDS_QUERY]);
 for(const q of w.queries)assert.match(q,/^select/i);
 const probes=w.calls.filter(c=>c.url.includes('/functions/v1/'));
 assert.equal(probes.length,PROBES.length);
 assert.ok(probes.every(c=>JSON.stringify(c.headers).includes('wrong')),'проверки идут заведомо неверным ключом');
 assert.equal(w.calls.filter(c=>c.url.endsWith('/functions')&&c.method!=='GET').length,0);
});

test('C-054 проверка: запись ищется и по номеру, и по имени файла',async()=>{
 const byVersion=await recorded();
 byVersion[0].version='20260916100000';
 byVersion[0].name='studkab_cloud_write_guard';
 const w=world({records:byVersion});
 const result=await verify(w.args);
 assert.deepEqual(result.problems,[]);
 assert.ok(RECORDS_QUERY.includes("'20260916100000_studkab_cloud_write_guard'"));
 assert.ok(RECORDS_QUERY.includes("'20260916100000'"));
});

test('C-054 проверка: отличие текста и отсутствие записи становятся замечаниями',async()=>{
 const changed=await recorded({'20260916100000':{joined:'select 1'}});
 const one=await verify(world({records:changed}).args);
 assert.equal(one.problems.length,1);
 assert.match(one.problems[0],/отличается от файла/);
 const missing=(await recorded()).slice(1);
 const two=await verify(world({records:missing}).args);
 assert.match(two.problems[0],/нет записи для 20260916100000/);
});

test('C-054 проверка: неверный ключ должен отклоняться, нерабочая функция — замечание',async()=>{
 const open=await verify(world({records:await recorded(),probe:{'studkab-push':200}}).args);
 assert.ok(open.problems.some(p=>/studkab-push ответила 200 вместо 403/.test(p)));
 const broken=await verify(world({records:await recorded(),funcs:[{slug:'studkab-requests',version:4,status:'REMOVED',verify_jwt:false}]}).args);
 assert.ok(broken.problems.some(p=>/studkab-requests не рабочая: REMOVED/.test(p)));
 assert.ok(broken.problems.some(p=>/studkab-generation не найдена/.test(p)));
});

test('C-054 проверка: без доступа ничего не запрашивается',async()=>{
 const w=world({records:await recorded()});
 await assert.rejects(verify({...w.args,env:{}}),/SUPABASE_ACCESS_TOKEN/);
 assert.equal(w.calls.length,0);
});
