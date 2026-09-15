import {test} from 'node:test';
import assert from 'node:assert/strict';
import {install} from '../scripts/c051-install.mjs';

const env={SUPABASE_ACCESS_TOKEN:'test-supa',CLOUDFLARE_API_TOKEN:'test-cf',CLOUDFLARE_ACCOUNT_ID:'1335d0bfa8029bd5f2da8867560ac512'};
function world({cfRead=true,active=0,installed=0,base=1,cfOk=true,probe=400,changeRows=false}={}){
 const calls=[];let done=installed;const logs=[];let secret=null;
 const counts={requests:3,jobs:2,attempts:4,results:1,reserved:1000};
 const request=async(url,o={})=>{
  const body=o.body?JSON.parse(o.body):null;calls.push({url,method:o.method||'GET',body});
  if(url.endsWith('/database/query')){
   const q=body.query;
   if(q.includes('C-051, замечание 2')){done=1;return Response.json([])}
   if(q.includes('C-051, замечания 6')){done=3;return Response.json([])}
   if(q.includes('active from'))return Response.json([{active}]);
   if(q.includes('cancel'))return Response.json([{installed:done,cancel:done===3,...counts,requests:changeRows?4:3}]);
   return Response.json([{installed:done,base,active,...counts,passports:2}]);
  }
  if(url.includes('api.cloudflare.com')&&!o.method)return Response.json({success:cfRead,result:[{name:'PROXY_TOKEN'}]},{status:cfRead?200:403});
  if(url.includes('api.cloudflare.com'))return Response.json({success:cfOk},{status:cfOk?200:403});
  if(url.endsWith('/secrets')&&o.method==='POST'){secret=body[0].value;return Response.json({})}
  if(url.endsWith('/secrets'))return Response.json([{name:'STUDKAB_PROXY_TOKEN'}]);
  if(url.includes('workers.dev')){assert.equal(o.headers['X-Proxy-Token'],secret);return Response.json({error:probe===400?'UNKNOWN_MODEL:deepseek':'TOKEN'},{status:probe})}
  throw Error('unexpected '+url);
 };
 const runs=[];
 return {calls,logs,runs,args:{env,request,run:(c,a)=>runs.push([c,...a]),log:m=>logs.push(m),read:async f=>f.endsWith('1.sql')?'-- C-051, замечание 2':'-- C-051, замечания 6–8',token:()=>'a'.repeat(64)}};
}
test('C-051 установка: полный порядок, пароль одинаковый в двух местах и не выводится открыто',async()=>{
 const w=world();
 assert.deepEqual(await install(w.args),{installed:true});
 const order=w.calls.map(c=>c.url.includes('cloudflare.com')?(c.method==='GET'?'cf-read':'cloudflare'):c.url.includes('workers.dev')?'probe':c.url.endsWith('/secrets')?'secret-'+c.method:(c.body.query.includes('C-051')?'sql-file':'sql'));
 assert.deepEqual(order.slice(0,5),['sql','cf-read','sql-file','sql-file','sql']);
 assert.ok(order.indexOf('secret-POST')<order.indexOf('cloudflare'));
 assert.ok(order.indexOf('cloudflare')<order.indexOf('probe'));
 assert.equal(w.runs[0].slice(0,4).join(' '),'supabase functions deploy studkab-generation-api');
 const cf=w.calls.find(c=>c.url.includes('cloudflare.com')&&c.method==='PUT');assert.equal(cf.body.name,'PROXY_TOKEN');assert.equal(cf.body.text,'a'.repeat(64));
 assert.deepEqual(w.logs,['::add-mask::'+'a'.repeat(64)]);
});
test('C-051 установка: при идущей подготовке ничего не меняется',async()=>{
 const w=world({active:1});
 await assert.rejects(install(w.args),/Идёт подготовка/);
 assert.equal(w.calls.length,1);assert.equal(w.runs.length,0);
});
test('C-051 установка: без доступа Cloudflare к паролям база не меняется',async()=>{
 const w=world({cfRead:false});
 await assert.rejects(install(w.args),/Нет доступа Cloudflare/);
 assert.equal(w.calls.filter(c=>c.body?.query?.includes('C-051')).length,0);assert.equal(w.runs.length,0);
});
test('C-051 установка: другая версия базы останавливает установку',async()=>{
 const w=world({base:0});
 await assert.rejects(install(w.args),/не соответствует версии/);
 assert.equal(w.calls.length,1);
});
test('C-051 установка: изменение рабочих записей останавливает дальнейшие шаги',async()=>{
 const w=world({changeRows:true});
 await assert.rejects(install(w.args),/Изменились рабочие записи/);
 assert.equal(w.runs.length,0);
 assert.equal(w.calls.some(c=>c.url.includes('api.supabase.com')&&c.url.endsWith('/secrets')),false);assert.equal(w.calls.some(c=>c.method==='PUT'),false);
});
test('C-051 установка: повторный запуск не выполняет файлы базы снова',async()=>{
 const w=world({installed:3});
 await install(w.args);
 assert.equal(w.calls.filter(c=>c.body?.query?.includes('C-051')).length,0);
});
test('C-051 установка: частичная установка базы требует ручной проверки',async()=>{
 const w=world({installed:1});
 await assert.rejects(install(w.args),/частично/);
});
test('C-051 установка: отказ Cloudflare и непринятый пароль не считаются успехом',async()=>{
 await assert.rejects(install(world({cfOk:false}).args),/Cloudflare не принял/);
 const w=world({probe:401});
 const orig=global.setTimeout;global.setTimeout=(f)=>orig(f,0);
 try{await assert.rejects(install(w.args),/не подтвердил/);}finally{global.setTimeout=orig;}
});
test('C-051 установка: без доступа ничего не начинается',async()=>{
 await assert.rejects(install({...world().args,env:{...env,SUPABASE_ACCESS_TOKEN:''}}),/SUPABASE_ACCESS_TOKEN/);
 await assert.rejects(install({...world().args,env:{...env,CLOUDFLARE_ACCOUNT_ID:'other'}}),/Cloudflare/);
});

test('C-051 установка: файлы установки содержат ровно тексты изменений базы из перечня',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {createHash}=await import('node:crypto');
 const manifest=JSON.parse(await readFile('supabase/migrations/manifest.json','utf8'));
 const files={'20260915130000':'supabase/c051-install-1.sql','20260915130100':'supabase/c051-install-2.sql','20260915130200':'supabase/c051-install-2.sql'};
 for(const m of manifest.pending_migrations){
  const body=await readFile('supabase/migrations/'+m.file,'utf8');
  assert.equal(createHash('sha256').update(body).digest('hex'),m.sha256);
  const install=await readFile(files[m.version],'utf8');
  assert.ok(install.includes('$c051_body$'+body+'$c051_body$'),m.file);
  assert.ok(install.includes("values('"+m.version+"','"+m.name+"'"),m.file);
 }
});
