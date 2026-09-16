// C-054, замечания 4 и 5: список допущенных студентов в базе.
// Запуск: node tests/manual/c054-members.mjs [--before]
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const before=process.argv.includes('--before');
const ids={executor:'00000000-0000-4000-8000-000000000001',withRequest:'00000000-0000-4000-8000-000000000002',withCabinet:'00000000-0000-4000-8000-000000000003',withPush:'00000000-0000-4000-8000-000000000004',stranger:'00000000-0000-4000-8000-000000000009',invited:'00000000-0000-4000-8000-000000000005'};
async function fresh(){
 const db=new PGlite();
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 grant usage on schema public to authenticated,anon,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
 for(const [k,v] of Object.entries(ids))await db.query('insert into auth.users values($1,$2)',[v,k+'@example.test']);
 await db.exec(fs.readFileSync('baza.sql','utf8'));
 await db.exec(fs.readFileSync('request-delivery.sql','utf8').replace(/executor@example\.invalid/g,'executor@example.test'));
 await db.exec(`create table public.studkab_push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id))`);
 await db.exec(fs.readFileSync('supabase/migrations/20260907055928_studkab_cloud_safety_v2.sql','utf8').replace(/^do \$guard\$.*$/m,''));
 await db.exec(fs.readFileSync('supabase/migrations/20260916100000_studkab_cloud_write_guard.sql','utf8'));
 // Данные, существующие до установки списка.
 await db.query("insert into studkab_requests(student_id,client_id,payload) values($1,'c1','{}')",[ids.withRequest]);
 await db.exec("set role service_role;");
 await db.query("insert into app_data(user_id,app,data) values($1,'kabinet','{}')",[ids.withCabinet]);
 await db.exec("reset role;");
 await db.query('insert into studkab_push_subscriptions(user_id) values($1)',[ids.withPush]);
 if(!before)await db.exec(fs.readFileSync('supabase/migrations/20260916100100_studkab_members.sql','utf8'));
 const as=async(uid,sql,args=[])=>{await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${uid}';`);try{return (await db.query(sql,args)).rows;}finally{await db.exec('reset role;');}};
 return {db,as};
}
const results=[];
async function scenario(name,fn){try{await fn(await fresh());results.push(['пройден',name]);}catch(e){results.push(['не пройден',name+': '+String(e.message).split('\n')[0].slice(0,110)]);}}
const save=(as,uid,app)=>as(uid,"select * from save_app_data_v2($1,'{\"a\":1}'::jsonb,0)",[app]);

await scenario('Аккаунт без допуска не сохраняет кабинет в облако',async({as})=>{
 await assert.rejects(save(as,ids.stranger,'kabinet'),/приглашения/);
});
await scenario('Действующие пользователи и исполнитель сохранили доступ',async({db,as})=>{
 const rows=(await db.query('select user_id::text id,source from studkab_members order by user_id')).rows;
 const got=Object.fromEntries(rows.map(r=>[r.id,r.source]));
 assert.equal(got[ids.executor],'executor');
 for(const k of ['withRequest','withCabinet','withPush'])assert.equal(got[ids[k]],'backfill',k);
 assert.equal(got[ids.stranger],undefined);
 const [r]=await save(as,ids.withRequest,'kabinet');assert.equal(r.ok,true);
 const [e]=await save(as,ids.executor,'reestr');assert.equal(e.ok,true);
});
await scenario('Приглашение выдаёт допуск; неизвестный аккаунт отклоняется',async({db,as})=>{
 await db.exec('set role service_role;');
 await db.query('select studkab_member_add($1)',[ids.invited]);
 await db.query('select studkab_member_add($1)',[ids.invited]);
 await assert.rejects(db.query("select studkab_member_add('00000000-0000-4000-8000-0000000000ff')"));
 await db.exec('reset role;');
 const [r]=await save(as,ids.invited,'kabinet');assert.equal(r.ok,true);
});
await scenario('Студент не видит список и не выдаёт себе допуск',async({as})=>{
 await assert.rejects(as(ids.stranger,'select * from studkab_members'));
 await assert.rejects(as(ids.stranger,'select studkab_member_add($1)',[ids.stranger]));
 await assert.rejects(as(ids.stranger,`insert into studkab_members(user_id,source) values('${ids.stranger}','invite')`));
});
for(const [s,n] of results)console.log(s+' — '+n);
const failed=results.filter(r=>r[0]!=='пройден').length;
if(before){if(!failed){console.log('ОШИБКА: без миграции сценарии должны не пройти');process.exit(1);}console.log('Без миграции не пройдено сценариев: '+failed+'. Дефект воспроизведён.');}
else if(failed)process.exit(1);else console.log('C-054 п.4–5 SQL: все сценарии пройдены');
