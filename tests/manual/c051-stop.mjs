// C-051, замечание 2: остановка подготовки и проверка паспорта перед отправкой.
// Запуск: node tests/manual/c051-stop.mjs  (нужен пакет @electric-sql/pglite).
// С ключом --before проверяется версия без миграции C-051: сценарии обязаны не пройти.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const before=process.argv.includes('--before');
async function fresh(){
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema auth;create table auth.users(id uuid primary key);
create table public.studkab_requests(id uuid primary key,student_id uuid,payload jsonb);`);
const files=[
 'supabase/migrations/20260911195103_studkab_generation_storage_v1.sql',
 'supabase/migrations/20260912123246_studkab_budget_reconciliation.sql',
 'supabase/migrations/20260914105509_studkab_requirement_passports.sql',
 'supabase/migrations/20260915070508_mandatory_passport_generation_limits.sql',
 'supabase/migrations/20260915072854_add_gen_job_passport_index.sql',
 ...(before?[]:['supabase/migrations/20260915130000_studkab_generation_stop.sql']),
 'supabase/migrations/20260915130100_studkab_production_drift_recorded.sql'
];
for(const file of files)await db.exec(fs.readFileSync(file,'utf8'));
await db.exec('update studkab_gen_budget set limit_microusd=1000000 where id=true');

const one=async(sql,args=[])=>{const r=(await db.query(sql,args)).rows[0];return r&&Object.values(r)[0];};
const user='11111111-1111-4111-8111-111111111111';
const request='33333333-3333-4333-8333-333333333333';
const items=[{id:'R1'}];
await db.query('insert into auth.users(id) values($1)',[user]);
await db.query("insert into studkab_requests(id,student_id,payload) values($1,$2,'{}')",[request,user]);
async function approve(fingerprint){
 const p=await one("select studkab_requirement_passport_save($1,$2,'T','',$3::jsonb,$4)",[request,user,JSON.stringify(items),fingerprint]);
 await db.query('select studkab_requirement_passport_approve($1,$2,$3,$4::jsonb,$5)',[request,p.id,user,JSON.stringify(items),fingerprint]);
 return p.id;
}
const fp='a'.repeat(64);
const passport=await approve(fp);
const input={system:'s',prompts:{a:'x',b:'y'},material_fingerprint:fp};
const plan=[{id:'a',prompt:'x',max_cost_microusd:250000,max_output_tokens:4000},{id:'b',prompt:'y',max_cost_microusd:250000,max_output_tokens:4000}];
const start=(inp=input,pid=passport)=>one('select studkab_gen_start($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)',[user,request,JSON.stringify(inp),JSON.stringify(plan),pid,'coursework',250000]);
const claim=()=>one('select studkab_gen_claim()');
const dispatch=c=>one('select studkab_gen_dispatch($1,$2,$3)',[c.job_id,c.ordinal,c.claim]);
const status=job=>one('select status from studkab_gen_jobs where id=$1',[job]);
const reserved=async()=>Number(await one('select reserved_microusd from studkab_gen_budget'));

return {db,one,approve,start,claim,dispatch,status,reserved,passport,input,user};
}
const results=[];
async function scenario(name,fn){let db,one,approve,start,claim,dispatch,status,reserved,passport,input,user;try{({db,one,approve,start,claim,dispatch,status,reserved,passport,input,user}=await fresh());await fn({db,one,approve,start,claim,dispatch,status,reserved,passport,input,user});results.push(['пройден',name]);}catch(e){results.push(['не пройден',name+': '+String(e.message).slice(0,120)]);}}

await scenario('A. Повторный старт активного задания возвращает то же задание',async({start})=>{
 const job1=await start();assert.equal(await start(),job1);
});
await scenario('B. Остановка между захватом и отправкой: резерва нет, задание не берётся снова',async({start,claim,one,user,dispatch,reserved})=>{
 const job1=await start();const c=await claim();assert.equal(c.job_id,job1);
 assert.equal(await one('select studkab_gen_cancel($1,$2)',[user,job1]),'cancelled');
 assert.equal(await one('select studkab_gen_cancel($1,$2)',['22222222-2222-4222-8222-222222222222',job1]),'not_found');
 await assert.rejects(dispatch(c),/STALE_CLAIM/);
 assert.equal(await reserved(),0);
 assert.equal(await claim(),null);
});
await scenario('C. После остановки тот же запуск создаёт новое задание',async({start,one,user})=>{
 const job1=await start();await one('select studkab_gen_cancel($1,$2)',[user,job1]);
 const job2=await start();assert.notEqual(job2,job1);assert.equal(await start(),job2);
});
await scenario('D. Остановка во время отправки: ответ сохранён, задание остаётся остановленным',async({db,start,claim,dispatch,one,user,status})=>{
 const job2=await start();const c=await claim();assert.equal(c.job_id,job2);
 const rid=await dispatch(c);assert.ok(rid);
 await db.query('select studkab_gen_cancel($1,$2)',[user,job2]);
 assert.equal(await one("select studkab_gen_settle($1,$2,$3,$4,'Текст','{}')",[job2,c.ordinal,c.claim,rid]),'done');
 assert.equal(await status(job2),'cancelled');
 if(await one("select to_regprocedure('public.studkab_gen_maintenance()') is not null"))await db.query('select studkab_gen_maintenance()');
 assert.equal(await status(job2),'cancelled');
});
await scenario('E. Паспорт изменился после старта: отправки нет, задание устарело',async({start,claim,dispatch,reserved,approve,status})=>{
 const job3=await start();const c=await claim();assert.equal(c.job_id,job3);
 const was=await reserved();
 await approve('b'.repeat(64));
 assert.equal(await dispatch(c),null);
 assert.equal(await status(job3),'stale');assert.equal(await reserved(),was);
 assert.equal(await claim(),null);
});
await scenario('F. Истёкшая отправка остановленного задания получает статус «неизвестно»',async({db,start,claim,dispatch,one,user})=>{
 const job4=await start();
 const c=await claim();assert.equal(c.job_id,job4);const rid=await dispatch(c);
 await db.query('select studkab_gen_cancel($1,$2)',[user,job4]);
 await db.query("update studkab_gen_parts set lease_until=now()-interval '1 second' where job_id=$1 and state='sent'",[job4]);
 await claim();
 assert.equal(await one('select state from studkab_gen_attempts where request_id=$1',[rid]),'unknown');
});
for(const [s,n] of results)console.log(s+' — '+n);
const failed=results.filter(r=>r[0]!=='пройден').length;
if(before){if(failed===0){console.log('ОШИБКА: без миграции сценарии должны не пройти');process.exit(1);}console.log('Без миграции не пройдено сценариев: '+failed+'. Дефект воспроизведён.');}
else if(failed){process.exit(1);}else console.log('C-051 п.2 SQL: все сценарии пройдены');
