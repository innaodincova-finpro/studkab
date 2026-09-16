import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {install,VERSIONS,PROBES} from '../scripts/c054-install.mjs';

const env={SUPABASE_ACCESS_TOKEN:'test-supa'};
const manifest=JSON.parse(await readFile('supabase/migrations/manifest.json','utf8'));
const sha=version=>manifest.pending_migrations.concat(manifest.migrations).find(m=>m.version===version).sha256;
// Ответ настроек входа содержит и секреты: проверка следит, что наружу идут только пределы.
const AUTH={rate_limit_verify:30,rate_limit_token_refresh:150,rate_limit_otp:30,security_captcha_enabled:false,smtp_pass:'secret-smtp-pass',hook_send_sms_secrets:'secret-hook'};

function world({installed=0,base=1,active=0,biggest=1000,executor=1,expected=7,members=7,memberExecutor=1,guard=1,memberAdd=true,rows={},recorded=null,versions={before:3,after:4},verifyJwt=null,probe={},auth=AUTH}={}){
 const calls=[],logs=[],runs=[],parts=[];
 let done=installed,deployed=false;
 const slugs=PROBES.map(([slug])=>slug);
 const funcs=()=>slugs.map(slug=>({slug,status:'ACTIVE',verify_jwt:(deployed&&verifyJwt&&verifyJwt[slug]!==undefined)?verifyJwt[slug]:slug!=='studkab-generation'?false:true,version:deployed?versions.after:versions.before}));
 const request=async(url,o={})=>{
  const body=o.body&&o.headers?.['Content-Type']==='application/json'&&o.body!=='{}'?JSON.parse(o.body):null;
  calls.push({url,method:o.method||'GET',query:body?.query||null,headers:o.headers||{}});
  if(url.endsWith('/database/query')){
   const q=body.query;
   if(q.includes('C-054: доступ и данные студентов')){done=2;parts.push('file');return Response.json([])}
   if(q.includes('encode(sha256'))return Response.json(recorded||VERSIONS.map(([v])=>({version:v,sha:sha(v)})));
   if(q.includes('pg_trigger'))return Response.json([{installed:done,requests:3,cloud:4,subs:2,guard,members,executor:memberExecutor,backfill:members-memberExecutor,invited:0,member_add:memberAdd,...rows}]);
   return Response.json([{installed:done,base,active,requests:3,cloud:4,subs:2,biggest,executor,expected}]);
  }
  if(url.endsWith('/functions'))return Response.json(funcs());
  if(url.endsWith('/config/auth'))return Response.json(auth);
  if(url.includes('/functions/v1/')){
   const slug=url.split('/functions/v1/')[1];
   const want=PROBES.find(([s])=>s===slug)[2];
   return new Response('{}',{status:probe[slug]??want});
  }
  throw Error('неожиданный запрос '+url);
 };
 return {calls,logs,runs,parts,args:{env,request,read:readFile,wait:async()=>{},log:m=>logs.push(String(m)),
  run:(c,a)=>{runs.push([c,...a]);deployed=true;}}};
}

test('C-054 установка: порядок шагов, публикация трёх функций и проверки без платных запросов',async()=>{
 const w=world();
 const result=await install(w.args);
 assert.equal(result.installed,true);
 assert.equal(result.members,7);
 const order=w.calls.map(c=>c.query?(c.query.includes('C-054: доступ')?'file':c.query.includes('encode(sha256')?'sha':c.query.includes('pg_trigger')?'after':'before'):c.url.endsWith('/functions')?'functions':c.url.endsWith('/config/auth')?'auth':'probe');
 assert.deepEqual(order.slice(0,5),['before','file','after','sha','functions']);
 assert.equal(order.filter(x=>x==='probe').length,PROBES.length);
 assert.ok(order.lastIndexOf('functions')<order.indexOf('probe'));
 assert.equal(order.at(-1),'auth');
 assert.deepEqual(w.runs.map(r=>r[3]),PROBES.map(([slug])=>slug));
 for(const r of w.runs)assert.deepEqual([r[0],r[1],r[2],r[4],r[5]],['supabase','functions','deploy','--project-ref','dcpthwmuiodrjepifzsd']);
 const probes=w.calls.filter(c=>c.url.includes('/functions/v1/'));
 assert.deepEqual(probes.map(c=>c.method),PROBES.map(()=>'POST'));
 assert.ok(probes.every(c=>JSON.stringify(c.headers).includes('wrong')));
});

test('C-054 установка: секреты настроек входа не выводятся, пределы выводятся',async()=>{
 const w=world();
 const summary=[];
 const result=await install({...w.args,summary:async t=>{summary.push(t)}});
 const text=w.logs.concat(summary).join('\n');
 assert.match(text,/rate_limit_verify: ?30/);
 assert.ok(!text.includes('secret-smtp-pass')&&!text.includes('secret-hook'),'секрет попал в журнал');
 assert.deepEqual(Object.keys(result.limits).sort(),['rate_limit_otp','rate_limit_token_refresh','rate_limit_verify','security_captcha_enabled']);
});

test('C-054 установка: идущая подготовка, чужая версия базы и запись больше 10 МБ останавливают установку',async()=>{
 for(const [opts,pattern] of [[{active:1},/Идёт подготовка/],[{base:0},/не соответствует C-051/],[{biggest:10485761},/больше 10 МБ/],[{executor:0},/Исполнитель из studkab_request_config/]]){
  const w=world(opts);
  await assert.rejects(install(w.args),pattern);
  assert.equal(w.parts.length,0,'файл установки не выполнялся');
  assert.equal(w.runs.length,0,'функции не публиковались');
 }
});

test('C-054 установка: частичная установка базы требует ручной проверки',async()=>{
 const w=world({installed:1});
 await assert.rejects(install(w.args),/частично/);
 assert.equal(w.parts.length,0);
});

test('C-054 установка: повторный запуск не выполняет файл базы снова, но проверяет и публикует',async()=>{
 const w=world({installed:2});
 await install(w.args);
 assert.equal(w.parts.length,0);
 assert.equal(w.runs.length,PROBES.length);
});

test('C-054 установка: изменение рабочих записей и неполный допуск останавливают публикацию',async()=>{
 for(const [opts,pattern] of [
  [{rows:{requests:4}},/Изменились рабочие записи: requests/],
  [{rows:{cloud:5}},/Изменились рабочие записи: cloud/],
  [{rows:{subs:1}},/Изменились рабочие записи: subs/],
  [{guard:0},/Изменения базы не подтверждены/],
  [{memberAdd:false},/Изменения базы не подтверждены/],
  [{memberExecutor:0},/Исполнитель не получил допуск/],
  [{members:6,expected:7},/Допуск получили не все/]]){
  const w=world(opts);
  await assert.rejects(install(w.args),pattern);
  assert.equal(w.runs.length,0,'функции не публиковались');
 }
});

test('C-054 установка: текст изменений сверяется с описью',async()=>{
 const w=world({recorded:VERSIONS.map(([v],i)=>({version:v,sha:i?sha(v):'0'.repeat(64)}))});
 await assert.rejects(install(w.args),/не совпадает с описью/);
 assert.equal(w.runs.length,0);
});

test('C-054 установка: неопубликованная функция и изменение проверки входа не считаются успехом',async()=>{
 await assert.rejects(install(world({versions:{before:3,after:3}}).args),/не обновилась/);
 await assert.rejects(install(world({verifyJwt:{'studkab-requests':true}}).args),/изменилась проверка входа/);
});

test('C-054 установка: неверный ключ должен отклоняться, иначе установка не подтверждена',async()=>{
 const w=world({probe:{'studkab-push':200}});
 await assert.rejects(install(w.args),/studkab-push ответила 200 вместо 403/);
});

test('C-054 установка: без доступа ничего не начинается',async()=>{
 await assert.rejects(install({...world().args,env:{}}),/SUPABASE_ACCESS_TOKEN/);
});

test('C-054 установка: файл установки содержит ровно тексты изменений из описи',async()=>{
 const file=await readFile('supabase/c054-install.sql','utf8');
 for(const [version,name] of VERSIONS){
  const body=await readFile('supabase/migrations/'+version+'_'+name+'.sql','utf8');
  const {createHash}=await import('node:crypto');
  assert.equal(createHash('sha256').update(body).digest('hex'),sha(version),version);
  assert.ok(file.includes('$c054_body$'+body+'$c054_body$'),version);
  assert.ok(file.includes("values('"+version+"','"+name+"'"),version);
 }
});
