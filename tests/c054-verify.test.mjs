import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verify,RECORDS_QUERY,PROBES,MIGRATIONS,SLUGS} from '../scripts/c054-verify.mjs';

const env={SUPABASE_ACCESS_TOKEN:'test-supa'};
const AUTH={rate_limit_verify:30,rate_limit_otp:30,security_captcha_enabled:false,smtp_pass:'secret-smtp-pass'};
const fileOf=m=>readFile('supabase/migrations/'+m.file,'utf8');
// Так изменения записаны в рабочей базе: номер — время применения, название — имя файла.
const recorded=async(overrides={})=>Promise.all(MIGRATIONS.map(async m=>{
 const text=await fileOf(m);
 return {version:m.version,name:m.name,parts:1,sha:createHash('sha256').update(text).digest('hex'),joined:text,...(overrides[m.version]||{})};
}));
const active=()=>SLUGS.map((slug,i)=>({slug,version:4+i,status:'ACTIVE',verify_jwt:slug==='studkab-generation',updated_at:'2026-09-16T17:40:00Z'}));

function world({records=null,funcs=null,probe={},auth=AUTH}={}){
 const queries=[],logs=[],calls=[];
 const request=async(url,o={})=>{
  calls.push({url,method:o.method||'GET',headers:o.headers||{}});
  if(url.endsWith('/database/query')){
   const query=JSON.parse(o.body).query;
   queries.push(query);
   return Response.json(records);
  }
  if(url.endsWith('/functions'))return Response.json(funcs||active());
  if(url.endsWith('/config/auth'))return Response.json(auth);
  if(url.includes('/functions/v1/')){
   const slug=url.split('/functions/v1/')[1];
   return new Response('{}',{status:probe[slug]??PROBES.find(([s])=>s===slug)[2]});
  }
  throw Error('неожиданный запрос '+url);
 };
 return {queries,logs,calls,args:{env,request,read:readFile,wait:async()=>{},log:m=>logs.push(String(m))}};
}

test('C-054 проверка: SHA записей, состояние функций, ответы доступа и пределы входа',async()=>{
 const w=world({records:await recorded()});
 const result=await verify(w.args);
 assert.deepEqual(result.problems,[]);
 const text=w.logs.join('\n');
 assert.match(text,/20260916135700 «20260916100000_studkab_cloud_write_guard», частей 1: SHA записи [0-9a-f]{64}, SHA файла [0-9a-f]{64} — совпадает/);
 assert.match(text,/20260916135724 «20260916100100_studkab_members».*совпадает/);
 assert.match(text,/studkab-requests: версия 4, обновлена 2026-09-16T17:40:00\.000Z, проверка входа false, состояние ACTIVE/);
 assert.match(text,/studkab-requests: ответ 403, ожидался 403/);
 assert.match(text,/studkab-generation: ответ 401, ожидался 401/);
 assert.match(text,/studkab-push: ответ 403, ожидался 403/);
 assert.match(text,/rate_limit_verify=30/);
 assert.match(text,/Замечаний нет/);
 assert.ok(!text.includes('secret-smtp-pass'),'секрет попал в журнал');
});

test('C-054 проверка: к базе идут только select, функции не публикуются',async()=>{
 const w=world({records:await recorded()});
 await verify(w.args);
 assert.deepEqual(w.queries,[RECORDS_QUERY]);
 assert.match(RECORDS_QUERY,/^select/i);
 const probes=w.calls.filter(c=>c.url.includes('/functions/v1/'));
 assert.equal(probes.length,PROBES.length);
 assert.ok(probes.every(c=>JSON.stringify(c.headers).includes('wrong')),'проверки идут заведомо неверным ключом');
 assert.equal(w.calls.filter(c=>c.url.endsWith('/functions')&&c.method!=='GET').length,0);
});

test('C-054 проверка: запись ищется и по номеру, и по названию',async()=>{
 assert.ok(MIGRATIONS.every(m=>RECORDS_QUERY.includes(`'${m.version}'`)&&RECORDS_QUERY.includes(`'${m.name}'`)));
 const byName=await recorded();
 byName[0].version='другой-номер';
 const result=await verify(world({records:byName}).args);
 assert.deepEqual(result.problems,[]);
});

test('C-054 проверка: разбитый на части текст без дословного совпадения SHA не считается ошибкой, чужой текст — считается',async()=>{
 const split=await recorded();
 const text=await fileOf(MIGRATIONS[0]);
 Object.assign(split[0],{parts:3,sha:'0'.repeat(64),joined:text.replace(/\n/g,'\n\n')});
 const soft=await verify(world({records:split}).args);
 assert.deepEqual(soft.problems,[]);
 const other=await verify(world({records:await recorded({'20260916135700':{sha:'0'.repeat(64),joined:'select 1'}})}).args);
 assert.equal(other.problems.length,1);
 assert.match(other.problems[0],/отличается от файла/);
});

test('C-054 проверка: отсутствие записи становится замечанием',async()=>{
 const result=await verify(world({records:(await recorded()).slice(1)}).args);
 assert.match(result.problems[0],/нет записи 20260916135700/);
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
