import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deploy,needsPublish,INSTALLED_AT} from '../scripts/c054-deploy.mjs';
import {MIGRATIONS,PROBES,SLUGS} from '../scripts/c054-verify.mjs';

const env={SUPABASE_ACCESS_TOKEN:'test-supa'};
const AUTH={rate_limit_verify:30,security_captcha_enabled:false};
const recorded=async()=>Promise.all(MIGRATIONS.map(async m=>{
 const text=await readFile('supabase/migrations/'+m.file,'utf8');
 return {version:m.version,name:m.name,parts:1,sha:createHash('sha256').update(text).digest('hex'),joined:text};
}));
const AFTER='2026-09-16T17:40:00Z',BEFORE='2026-09-16T13:57:00Z';

function world({updated=AFTER,probe={},probeAfterDeploy=null,versions={before:4,after:5},verifyJwt=null}={}){
 const logs=[],runs=[],calls=[];
 let deployed=false,records=null;
 const funcs=()=>SLUGS.map(slug=>({slug,status:'ACTIVE',
  verify_jwt:deployed&&verifyJwt&&verifyJwt[slug]!==undefined?verifyJwt[slug]:slug==='studkab-generation',
  version:deployed?versions.after:versions.before,
  updated_at:deployed?AFTER:updated}));
 const request=async(url,o={})=>{
  calls.push({url,method:o.method||'GET'});
  if(url.endsWith('/database/query'))return Response.json(records);
  if(url.endsWith('/functions'))return Response.json(funcs());
  if(url.endsWith('/config/auth'))return Response.json(AUTH);
  if(url.includes('/functions/v1/')){
   const slug=url.split('/functions/v1/')[1];
   const want=PROBES.find(([s])=>s===slug)[2];
   const table=deployed&&probeAfterDeploy?probeAfterDeploy:probe;
   return new Response('{}',{status:table[slug]??want});
  }
  throw Error('неожиданный запрос '+url);
 };
 return {logs,runs,calls,ready:async()=>{records=await recorded();},
  args:{env,request,read:readFile,wait:async()=>{},log:m=>logs.push(String(m)),
   run:(c,a)=>{runs.push([c,...a]);deployed=true;}}};
}

test('C-054 публикация: обновлённые функции и пройденные проверки не публикуются повторно',async()=>{
 const w=world();
 await w.ready();
 const result=await deploy(w.args);
 assert.equal(result.published,false);
 assert.equal(w.runs.length,0);
 assert.match(w.logs.join('\n'),/Публикация не требуется/);
});

test('C-054 публикация: устаревшие функции публикуются, проверки повторяются',async()=>{
 const w=world({updated:BEFORE});
 await w.ready();
 const result=await deploy(w.args);
 assert.equal(result.published,true);
 assert.deepEqual(result.reasons.length,SLUGS.length);
 assert.deepEqual(w.runs.map(r=>r[3]),SLUGS);
 for(const r of w.runs)assert.deepEqual([r[0],r[1],r[2],r[4],r[5]],['supabase','functions','deploy','--project-ref','dcpthwmuiodrjepifzsd']);
 // Проверки доступа выполняются дважды: до и после публикации.
 assert.equal(w.calls.filter(c=>c.url.includes('/functions/v1/')).length,PROBES.length*2);
 assert.match(w.logs.join('\n'),/Опубликовано studkab-requests: версия 4 → 5, проверка входа false/);
});

test('C-054 публикация: неверный ответ на неверный ключ — основание для публикации',async()=>{
 const w=world({probe:{'studkab-push':200},probeAfterDeploy:{}});
 await w.ready();
 const result=await deploy(w.args);
 assert.equal(result.published,true);
 assert.ok(result.reasons.some(r=>/studkab-push: ответ 200/.test(r)));
 assert.deepEqual(result.after.problems,[]);
});

test('C-054 публикация: замечания после публикации не считаются успехом',async()=>{
 const w=world({updated:BEFORE,probe:{'studkab-push':200},probeAfterDeploy:{'studkab-push':200}});
 await w.ready();
 await assert.rejects(deploy(w.args),/После публикации остались замечания/);
});

test('C-054 публикация: неизменность проверки входа и рост версии обязательны',async()=>{
 const jwt=world({updated:BEFORE,verifyJwt:{'studkab-requests':true}});
 await jwt.ready();
 await assert.rejects(deploy(jwt.args),/изменилась проверка входа/);
 const same=world({updated:BEFORE,versions:{before:5,after:5}});
 await same.ready();
 await assert.rejects(deploy(same.args),/не обновилась/);
});

test('C-054 публикация: явное требование публикует даже при пройденных проверках',async()=>{
 const w=world();
 await w.ready();
 const result=await deploy({...w.args,force:true});
 assert.equal(result.published,true);
 assert.deepEqual(result.reasons,['публикация запрошена явно']);
});

test('C-054 публикация: основание считается по времени установки базы',()=>{
 assert.equal(INSTALLED_AT,Date.parse('2026-09-16T13:59:00Z'));
 const functions=SLUGS.map(slug=>({slug,updated_at:BEFORE}));
 assert.equal(needsPublish({functions,answers:[]}).length,SLUGS.length);
 assert.deepEqual(needsPublish({functions:SLUGS.map(slug=>({slug,updated_at:AFTER})),answers:['studkab-push: ответ 403, ожидался 403']}),[]);
 assert.deepEqual(needsPublish({functions:[{slug:'studkab-push',missing:true}],answers:[]}),['функция studkab-push не найдена']);
});
