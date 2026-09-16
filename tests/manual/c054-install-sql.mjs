// C-054, пункт 10 задания: файл установки проверяется на копии базы.
// Запуск: node tests/manual/c054-install-sql.mjs
// Проверяется то, что делает установка в рабочей базе: порядок, запись текста
// изменений в перечень, защита от повторного и преждевременного запуска и
// остановка без изменений при слишком большой записи.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const VERSIONS=[['20260916100000','studkab_cloud_write_guard'],['20260916100100','studkab_members']];
const INSTALL=fs.readFileSync('supabase/c054-install.sql','utf8');
const ids={executor:'00000000-0000-4000-8000-000000000001',withRequest:'00000000-0000-4000-8000-000000000002',stranger:'00000000-0000-4000-8000-000000000009'};

async function fresh({c051=true,big=false}={}){
 const db=new PGlite();
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 grant usage on schema public to authenticated,anon,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 create schema supabase_migrations;
 create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);`);
 for(const [k,v] of Object.entries(ids))await db.query('insert into auth.users values($1,$2)',[v,k+'@example.test']);
 await db.exec(fs.readFileSync('baza.sql','utf8'));
 await db.exec(fs.readFileSync('request-delivery.sql','utf8').replace(/executor@example\.invalid/g,'executor@example.test'));
 await db.exec(`create table public.studkab_push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id))`);
 await db.exec(fs.readFileSync('supabase/migrations/20260907055928_studkab_cloud_safety_v2.sql','utf8').replace(/^do \$guard\$.*$/m,''));
 // Рабочая база на момент установки: изменения C-051 уже зарегистрированы.
 if(c051)await db.query("insert into supabase_migrations.schema_migrations values('20260915130200','studkab_unknown_fully_retained',array['--'])");
 await db.query("insert into studkab_requests(student_id,client_id,payload) values($1,'c1','{}')",[ids.withRequest]);
 await db.exec('set role service_role;');
 await db.query("insert into app_data(user_id,app,data) values($1,'kabinet',$2::jsonb)",[ids.stranger,big?JSON.stringify({a:'x'.repeat(10485761)}):'{}']);
 await db.exec('reset role;');
 return db;
}

// Прерванная установка оставляет соединение в отменённой транзакции; в рабочей
// базе каждый запрос отдельный, поэтому здесь соединение возвращается в обычное
// состояние перед проверкой последствий.
const reset=db=>db.exec('rollback;').catch(()=>{});

const results=[];
async function scenario(name,fn){
 try{await fn();results.push(['пройден',name]);}
 catch(e){results.push(['не пройден',name+': '+String(e.message).split('\n')[0].slice(0,120)]);}
}

await scenario('Установка регистрирует оба изменения точным текстом файлов',async()=>{
 const db=await fresh();
 await db.exec(INSTALL);
 const rows=(await db.query('select version,name,statements from supabase_migrations.schema_migrations order by version')).rows;
 assert.deepEqual(rows.map(r=>r.version),['20260915130200',...VERSIONS.map(v=>v[0])]);
 for(const [version,name] of VERSIONS){
  const row=rows.find(r=>r.version===version);
  assert.equal(row.name,name);
  assert.equal(row.statements.length,1);
  assert.equal(row.statements[0],fs.readFileSync(`supabase/migrations/${version}_${name}.sql`,'utf8'));
 }
});

await scenario('После установки действуют защита записи и список допущенных',async()=>{
 const db=await fresh();
 await db.exec(INSTALL);
 const [{count}]=(await db.query("select count(*)::int count from pg_trigger where tgrelid='public.app_data'::regclass and tgname='studkab_app_data_guard'")).rows;
 assert.equal(count,1);
 const members=(await db.query('select user_id::text id,source from studkab_members')).rows;
 const got=Object.fromEntries(members.map(r=>[r.id,r.source]));
 assert.equal(got[ids.executor],'executor');
 assert.equal(got[ids.withRequest],'backfill');
 assert.equal(got[ids.stranger],'backfill','у аккаунта есть запись кабинета до установки');
 await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${ids.withRequest}';`);
 const [saved]=(await db.query("select * from save_app_data_v2('kabinet','{\"a\":1}'::jsonb,0)")).rows;
 assert.equal(saved.ok,true);
 await db.exec('reset role;');
});

await scenario('Повторный запуск ничего не меняет',async()=>{
 const db=await fresh();
 await db.exec(INSTALL);
 const before=(await db.query('select count(*)::int c from studkab_members')).rows[0].c;
 await assert.rejects(db.exec(INSTALL),/Уже установлено/);
 await reset(db);
 const after=(await db.query('select count(*)::int c from studkab_members')).rows[0].c;
 assert.equal(after,before);
 assert.equal((await db.query('select count(*)::int c from supabase_migrations.schema_migrations')).rows[0].c,3);
});

await scenario('Объекты без записи в перечне останавливают установку',async()=>{
 const db=await fresh();
 await db.exec(fs.readFileSync('supabase/migrations/20260916100100_studkab_members.sql','utf8'));
 await assert.rejects(db.exec(INSTALL),/уже есть в базе, но изменения не зарегистрированы/);
 await reset(db);
 assert.equal((await db.query('select count(*)::int c from supabase_migrations.schema_migrations')).rows[0].c,1);
});

await scenario('Без изменений C-051 установка не начинается',async()=>{
 const db=await fresh({c051:false});
 await assert.rejects(db.exec(INSTALL),/C-051/);
 await reset(db);
 assert.equal((await db.query("select to_regclass('public.studkab_members') is null missing")).rows[0].missing,true);
});

await scenario('Запись больше 10 МБ останавливает установку без изменений',async()=>{
 const db=await fresh({big:true});
 await assert.rejects(db.exec(INSTALL),/больше 10 МБ/);
 await reset(db);
 assert.equal((await db.query("select to_regclass('public.studkab_members') is null missing")).rows[0].missing,true);
 assert.equal((await db.query("select count(*)::int c from pg_trigger where tgrelid='public.app_data'::regclass and tgname='studkab_app_data_guard'")).rows[0].c,0);
 assert.equal((await db.query('select count(*)::int c from supabase_migrations.schema_migrations')).rows[0].c,1);
});

for(const [status,name] of results)console.log(status+' — '+name);
if(results.some(([s])=>s!=='пройден'))process.exit(1);
console.log('C-054 файл установки: все сценарии пройдены');
