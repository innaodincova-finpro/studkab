import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=fs.readFileSync(new URL('../supabase/migrations/20260921165603_c084_requirement_clarifications.sql',import.meta.url),'utf8');
const student='11111111-1111-4111-8111-111111111111',executor='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333',request='44444444-4444-4444-8444-444444444444',question='55555555-5555-4555-8555-555555555555';
const ids=['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER'];
const complete=()=>ids.map(id=>({id,category:'method',required:true,verified:true,text:'Условие из задания',source:'Методичка, с. 2',answer_ids:[]}));
async function fixture(applyFix=true){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,encrypted_password text);create table studkab_request_config(executor_email text);
 create table studkab_members(user_id uuid primary key);create table studkab_requests(id uuid primary key,student_id uuid,deleting_at timestamptz);
 insert into auth.users values('${student}','student@example.test',null),('${executor}','executor@example.test',null),('${stranger}','stranger@example.test',null);
 insert into studkab_request_config values('executor@example.test');insert into studkab_members values('${student}'),('${stranger}');
 insert into studkab_requests values('${request}','${student}',null);
 `);await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260914105509_studkab_requirement_passports.sql',import.meta.url),'utf8'));await db.exec(migration);
 await db.exec(`grant usage on schema auth to service_role;
 grant select,update on studkab_requests to service_role;
 grant select on studkab_request_config,studkab_members to service_role;`);
 if(applyFix)await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260921181451_c085_clarification_actor_permissions.sql',import.meta.url),'utf8'));
 await db.exec('set role service_role');return db;}
async function save(db,items=complete()){return (await db.query("select studkab_requirement_passport_save($1,$2,'Требования','Проверка',$3,$4) p",[request,executor,JSON.stringify(items),'a'.repeat(64)])).rows[0].p;}
async function approve(db,p,actor=executor){return (await db.query('select studkab_requirement_passport_approve($1,$2,$3,$4,$5) p',[request,p.id,actor,JSON.stringify(p.items),'a'.repeat(64)])).rows[0].p;}
const ask=(db,id=question)=>db.query('select studkab_clarification_ask($1,$2,$3,$4,$5) q',[request,executor,id,'ANTIPLAGIARISM','Какой порог указан преподавателем?']);
const answer=(db,actor=student,value='Не менее 70%')=>db.query('select studkab_clarification_answer($1,$2,$3,$4,$5) q',[request,actor,question,value,'Ответ преподавателя, учебный сценарий']);

test('C084 SQL: two roles, retries, immutable answer, evidence and last revision',async()=>{const db=await fixture();try{
 let p=await save(db);await approve(db,p);await ask(db);await ask(db);
 assert.equal((await db.query('select count(*)::int n from studkab_clarifications')).rows[0].n,1);
 assert.equal((await db.query('select status from studkab_requirement_passports where id=$1',[p.id])).rows[0].status,'stale');
 p=await save(db);await assert.rejects(approve(db,p),/CLARIFICATION_UNREVIEWED/);
 await assert.rejects(answer(db,stranger),/FORBIDDEN/);
 await answer(db);await answer(db);
 assert.match((await answer(db,student,'80%')).rows[0].q.error,/уже сохранён/);
 await assert.rejects(approve(db,p),/CLARIFICATION_UNREVIEWED/);
 const items=complete();items.find(x=>x.id==='ANTIPLAGIARISM').answer_ids=[question];
 p=await save(db,items);assert.equal((await approve(db,p)).status,'approved');
 const newer=await save(db,items);await assert.rejects(approve(db,p),/passport_changed/);
 await assert.rejects(approve(db,newer,student),/FORBIDDEN/);
 assert.equal((await approve(db,newer)).status,'approved');
 await ask(db,'66666666-6666-4666-8666-666666666666');
 p=await save(db,items);await assert.rejects(approve(db,p),/CLARIFICATION_UNREVIEWED/);
 for(const role of ['anon','authenticated']){
  const r=await db.query("select has_table_privilege($1,'studkab_clarifications','SELECT') s,has_function_privilege($1,'studkab_clarification_answer(uuid,uuid,uuid,text,text)','EXECUTE') e",[role]);assert.equal(r.rows[0].s,false);assert.equal(r.rows[0].e,false);
  assert.equal((await db.query("select has_function_privilege($1,'studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text)','EXECUTE') e",[role])).rows[0].e,false);
 }
 assert.equal((await db.query("select relrowsecurity from pg_class where relname='studkab_clarifications'")).rows[0].relrowsecurity,true);
 }finally{await db.close();}});

test('C084 SQL: absence, false required flag, unknown wording, missing source and evidence never approve',async()=>{const db=await fixture();try{
 for(const mutation of [a=>a.splice(0,1),a=>{a[0].verified=false;},a=>{a[0].required=false;a[0].verified=false;},a=>{a[0].source='';},a=>{a[0].text='Порог не задан, ожидается ответ';},a=>{a[0].answer_ids=[question];}]){
  const items=complete();mutation(items);const p=await save(db,items);await assert.rejects(approve(db,p),/PASSPORT_/);
 }
 let p=await save(db);const old=await save(db);await assert.rejects(approve(db,p),/passport_changed/);assert.equal((await approve(db,old)).status,'approved');
 }finally{await db.close();}});

test('C085: reproduce production denial, then grant only actor columns',async()=>{
 const db=await fixture(false);try{
  const p=await save(db);
  await assert.rejects(ask(db),/permission denied for table users/);
  await assert.rejects(approve(db,p),/permission denied for table users/);
  assert.equal((await db.query('select count(*)::int n from studkab_clarifications')).rows[0].n,0);
  await db.exec('reset role');
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260921181451_c085_clarification_actor_permissions.sql',import.meta.url),'utf8'));
  await db.exec('set role service_role');
  assert.equal((await approve(db,p)).status,'approved');await ask(db);await answer(db);
  await assert.rejects(db.query('select encrypted_password from auth.users'),/permission denied/);
  await assert.rejects(db.query("update auth.users set email='changed@example.test'"),/permission denied/);
  for(const role of ['anon','authenticated']){
   assert.equal((await db.query("select has_column_privilege($1,'auth.users','email','SELECT') p",[role])).rows[0].p,false);
  }
 }finally{await db.close();}
});
