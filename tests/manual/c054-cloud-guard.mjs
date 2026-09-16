// C-054, замечание 3: запись кабинета и реестра — только через save_app_data_v2.
// Запуск: node tests/manual/c054-cloud-guard.mjs [--before]
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const before=process.argv.includes('--before');
const u='11111111-1111-4111-8111-111111111111';
async function fresh(){
 const db=new PGlite();
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 grant usage on schema public to authenticated,anon,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
 await db.exec(fs.readFileSync('baza.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20260907055928_studkab_cloud_safety_v2.sql','utf8').replace(/^do \$guard\$.*$/m,''));
 if(!before)await db.exec(fs.readFileSync('supabase/migrations/20260916135700_20260916100000_studkab_cloud_write_guard.sql','utf8'));
 await db.query('insert into auth.users values($1)',[u]);
 const as=async(sql,args=[])=>{await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${u}';`);try{return (await db.query(sql,args)).rows;}finally{await db.exec('reset role;');}};
 return {db,as};
}
const results=[];
async function scenario(name,fn){try{await fn(await fresh());results.push(['пройден',name]);}catch(e){results.push(['не пройден',name+': '+String(e.message).split('\n')[0].slice(0,110)]);}}
const save=(as,app,data,rev)=>as("select * from save_app_data_v2($1,$2::jsonb,$3)",[app,JSON.stringify(data),rev]);

await scenario('Сохранение через приложение работает и убирает пароль',async({db,as})=>{
 const [r]=await save(as,'reestr',{settings:{proxyToken:'s',proxyUrl:'u',name:'x'}},0);assert.equal(r.ok,true);
 const [r2]=await save(as,'reestr',{settings:{name:'y'}},1);assert.equal(r2.ok,true);
 const [row]=(await db.query("select data from app_data where app='reestr'")).rows;
 assert.equal(row.data.settings.name,'y');
});
await scenario('Прямое изменение записи реестра отклоняется',async({db,as})=>{
 await save(as,'reestr',{settings:{}},0);
 await assert.rejects(as("update app_data set data='{\"settings\":{\"proxyToken\":\"s\"}}', rev=0 where app='reestr'"));
 const [row]=(await db.query("select rev,data from app_data where app='reestr'")).rows;
 assert.equal(Number(row.rev),1);assert.equal(row.data.settings.proxyToken,undefined);
});
await scenario('Прямое создание записи кабинета отклоняется',async({as})=>{
 await assert.rejects(as(`insert into app_data(user_id,app,data) values('${u}','kabinet','{}')`));
});
await scenario('Прямое удаление записи кабинета отклоняется',async({db,as})=>{
 await save(as,'kabinet',{works:[]},0);
 await as("delete from app_data where app='kabinet'").catch(()=>{});
 assert.equal((await db.query("select count(*)::int n from app_data where app='kabinet'")).rows[0].n,1);
});
await scenario('Запись больше 10 МБ отклоняется',async({as})=>{
 await assert.rejects(save(as,'kabinet',{blob:'x'.repeat(10_500_000)},0),/10 МБ/);
});
await scenario('Записи других приложений не затронуты',async({db,as})=>{
 await as(`insert into app_data(user_id,app,data) values('${u}','drugoe','{}')`);
 await as("update app_data set data='{\"a\":1}' where app='drugoe'");
 assert.equal((await db.query("select data->>'a' a from app_data where app='drugoe'")).rows[0].a,'1');
});
await scenario('Сервер сохраняет право записи',async({db})=>{
 await db.exec("set role service_role;");
 await db.query(`insert into app_data(user_id,app,data) values('${u}','kabinet','{}')`);
 await db.exec('reset role;');
});
for(const [s,n] of results)console.log(s+' — '+n);
const failed=results.filter(r=>r[0]!=='пройден').length;
if(before){if(!failed){console.log('ОШИБКА: без миграции сценарии должны не пройти');process.exit(1);}console.log('Без миграции не пройдено сценариев: '+failed+'. Дефект воспроизведён.');}
else if(failed)process.exit(1);else console.log('C-054 п.3 SQL: все сценарии пройдены');
