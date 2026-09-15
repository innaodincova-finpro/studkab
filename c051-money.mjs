// C-051, замечания 7 и 8: неподтверждённый запрос удерживается полностью (M6),
// оборванный по длине ответ автоматически не повторяется.
// Запуск: node tests/manual/c051-money.mjs [--before]
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const before=process.argv.includes('--before');
// Крупные материалы, как в настоящей курсовой: 200 КБ текста. На малом запросе
// автосписание не срабатывает, поэтому дефект проверяется на реальном объёме.
const BIG='я'.repeat(100000);
async function fresh(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create table public.studkab_requests(id uuid primary key,student_id uuid,payload jsonb);`);
 for(const f of ['20260911195103_studkab_generation_storage_v1.sql','20260912123246_studkab_budget_reconciliation.sql',
  '20260914105509_studkab_requirement_passports.sql','20260915070508_mandatory_passport_generation_limits.sql',
  '20260915072854_add_gen_job_passport_index.sql','20260915130000_studkab_generation_stop.sql',
  '20260915130100_studkab_production_drift_recorded.sql',...(before?[]:['20260915130200_studkab_unknown_fully_retained.sql'])])
  await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec('update studkab_gen_budget set limit_microusd=1000000 where id=true');
 const one=async(sql,args=[])=>{const r=(await db.query(sql,args)).rows[0];return r&&Object.values(r)[0];};
 const user='11111111-1111-4111-8111-111111111111',request='33333333-3333-4333-8333-333333333333',fp='a'.repeat(64),items=[{id:'R1'}];
 await db.query('insert into auth.users(id) values($1)',[user]);
 await db.query("insert into studkab_requests(id,student_id,payload) values($1,$2,'{}')",[request,user]);
 const p=await one("select studkab_requirement_passport_save($1,$2,'T','',$3::jsonb,$4)",[request,user,JSON.stringify(items),fp]);
 await db.query('select studkab_requirement_passport_approve($1,$2,$3,$4::jsonb,$5)',[request,p.id,user,JSON.stringify(items),fp]);
 const plan=[{id:'a',prompt:'x',max_cost_microusd:250000,max_output_tokens:4000},{id:'b',prompt:'y',max_cost_microusd:250000,max_output_tokens:4000}];
 const job=await one('select studkab_gen_start($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)',[user,request,JSON.stringify({system:BIG,prompts:{a:'x',b:'y'},material_fingerprint:fp}),JSON.stringify(plan),p.id,'coursework',250000]);
 const c=await one('select studkab_gen_claim()');
 const rid=await one('select studkab_gen_dispatch($1,$2,$3)',[c.job_id,c.ordinal,c.claim]);
 const reservation=Number(await one('select reservation_microusd from studkab_gen_attempts where request_id=$1',[rid]));
 const settle=detail=>one("select studkab_gen_settle($1,$2,$3,$4,null,$5::jsonb)",[job,c.ordinal,c.claim,rid,JSON.stringify(detail)]);
 const reserved=async()=>Number(await one('select reserved_microusd from studkab_gen_budget'));
 const partState=()=>one('select state from studkab_gen_parts where job_id=$1 and ordinal=0',[job]);
 const ledger=async()=>{const r=(await db.query(`select (select reserved_microusd from studkab_gen_budget) b,
  (select coalesce(sum(reservation_microusd),0) from studkab_gen_attempts)-(select coalesce(sum(released_microusd),0) from studkab_gen_reconciliations) e`)).rows[0];
  assert.equal(Number(r.b),Number(r.e),'журнал резерва сходится');};
 return {db,one,job,rid,reservation,settle,reserved,partState,ledger};
}
const results=[];
async function scenario(name,fn){try{await fn(await fresh());results.push(['пройден',name]);}catch(e){results.push(['не пройден',name+': '+String(e.message).split('\n')[0].slice(0,120)]);}}

await scenario('7. Неподтверждённый запрос удерживается в расходах полностью',async({db,settle,reserved,reservation,ledger})=>{
 await settle({});
 for(let i=0;i<3;i++)await db.query('select studkab_gen_maintenance()');
 assert.equal(await reserved(),reservation);
 await ledger();
});
await scenario('8. Оборванный по длине ответ не повторяется автоматически',async({db,settle,partState,one,job,ledger})=>{
 await settle({finish_reason:'length'});
 for(let i=0;i<3;i++)await db.query('select studkab_gen_maintenance()');
 assert.equal(await partState(),'unknown');
 assert.equal(await one('select count(*)::int from studkab_gen_attempts where job_id=$1',[job]),1);
 await ledger();
});
await scenario('Восстановление: иной неподтверждённый запрос повторяется не более одного раза, оба резерва удержаны',async({db,one,settle,partState,job,reserved,reservation,ledger})=>{
 await settle({});
 await db.query('select studkab_gen_maintenance()');
 assert.equal(await partState(),'queued');
 const c=await one('select studkab_gen_claim()');
 const rid2=await one('select studkab_gen_dispatch($1,$2,$3)',[c.job_id,c.ordinal,c.claim]);
 await one("select studkab_gen_settle($1,$2,$3,$4,null,'{}'::jsonb)",[job,c.ordinal,c.claim,rid2]);
 for(let i=0;i<3;i++)await db.query('select studkab_gen_maintenance()');
 assert.equal(await partState(),'unknown');
 assert.equal(await one('select count(*)::int from studkab_gen_attempts where job_id=$1',[job]),2);
 assert.ok(await reserved()>=reservation*2-1);
 await ledger();
});
await scenario('Сверка по кабинету поставщика возвращает резерв только с основанием',async({db,one,settle,rid,reservation,reserved,ledger})=>{
 await settle({});
 await assert.rejects(db.query("select studkab_gen_reconcile_unknown($1,$2,'коротко')",[rid,100]));
 const back=Number(await one("select studkab_gen_reconcile_unknown($1,$2,$3)",[rid,100,'Кабинет DeepSeek 15.09.2026: запрос учтён, расход 0.0001 USD']));
 assert.equal(back,reservation-100);
 assert.equal(await reserved(),100);
 await assert.rejects(db.query("select studkab_gen_reconcile_unknown($1,$2,$3)",[rid,50,'Кабинет DeepSeek 15.09.2026: повторная сверка']));
 await ledger();
});
for(const [s,n] of results)console.log(s+' — '+n);
const failed=results.filter(r=>r[0]!=='пройден').length;
if(before){if(!failed){console.log('ОШИБКА: без миграции сценарии должны не пройти');process.exit(1);}console.log('Без миграции не пройдено сценариев: '+failed+'. Дефект воспроизведён.');}
else if(failed)process.exit(1);else console.log('C-051 п.7–8 SQL: все сценарии пройдены');
