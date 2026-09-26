import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {clarificationAction} from '../supabase/functions/studkab-requests/clarifications.mjs';
const student='11111111-1111-4111-8111-111111111111',executor='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333';
const request='44444444-4444-4444-8444-444444444444',question='55555555-5555-4555-8555-555555555555';
const file=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
test('C120 dialogue events are atomic, unique and scoped to the recipient',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key,email text);
   create table studkab_request_config(executor_email text);
   create table studkab_members(user_id uuid primary key);
   create table studkab_requests(id uuid primary key,student_id uuid,deleting_at timestamptz);
   insert into auth.users values('${student}','student@example.test'),('${executor}','executor@example.test'),('${stranger}','stranger@example.test');
   insert into studkab_request_config values('executor@example.test');
   insert into studkab_members values('${student}');
   insert into studkab_requests values('${request}','${student}',null);
  `);
  for(const name of ['20260914105509_studkab_requirement_passports.sql','20260921165603_c084_requirement_clarifications.sql','20260921181451_c085_clarification_actor_permissions.sql','20260926114639_c120_dialog_events.sql'])await db.exec(file(name));
  await db.exec(`grant usage on schema auth to service_role;
   grant select,update on studkab_requests to service_role;
   grant select on studkab_request_config,studkab_members to service_role;set role service_role;`);
  const items=[{id:'METHODOLOGY',category:'method',required:true,verified:true,text:'Методика',source:'Файл',answer_ids:[]}];
  await db.query('select studkab_requirement_passport_save($1,$2,$3,$4,$5,$6)',[request,executor,'Требования','Проверка',JSON.stringify(items),'a'.repeat(64)]);
  const ask=()=>db.query('select studkab_clarification_ask($1,$2,$3,$4,$5)',[request,executor,question,'METHODOLOGY','Какую методику использовать?']);
  await ask();await ask();
  assert.deepEqual((await db.query('select kind,recipient_id from studkab_dialog_events')).rows.map(r=>[r.kind,r.recipient_id]),[['question',student]]);
  await assert.rejects(db.query('select studkab_clarification_answer($1,$2,$3,$4,$5)',[request,stranger,question,'Ответ','Файл']),/FORBIDDEN/);
  const answer=()=>db.query('select studkab_clarification_answer($1,$2,$3,$4,$5)',[request,student,question,'По заданию','Методичка, с. 2']);
  await answer();await answer();
  assert.deepEqual((await db.query('select kind,recipient_id from studkab_dialog_events order by id')).rows.map(r=>[r.kind,r.recipient_id]),[['question',student],['answer',executor]]);
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_table_privilege($1,'studkab_dialog_events','SELECT') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("select count(*)::int n from claim_studkab_dialog_telegram()")).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from claim_studkab_dialog_telegram()")).rows[0].n,0);
  await db.query("update studkab_dialog_events set telegram_lease_until=now()-interval '1 minute' where kind='answer'");
  assert.equal((await db.query("select count(*)::int n from claim_studkab_dialog_telegram()")).rows[0].n,1);
  const calls=[];const deps={config:async()=>({executor_email:'executor@example.test'}),isMember:async()=>true,db:async(path,method,body)=>{
   calls.push({path,method,body});if(path.startsWith('studkab_requests?'))return path.includes('student_id=eq.'+stranger)?[]:[{id:request,student_id:student}];
   if(path.startsWith('studkab_dialog_events?')&&!method)return [{id:1,kind:'question'}];return [];
  }};
  assert.equal((await clarificationAction({action:'clarification-unread',id:request},{id:stranger,email:'stranger@example.test'},deps)).status,404);
  assert.equal((await clarificationAction({action:'clarification-unread',id:request},{id:student,email:'student@example.test'},deps)).data.question,1);
  await clarificationAction({action:'clarification-read',id:request},{id:student,email:'student@example.test'},deps);
  assert.match(calls.at(-1).path,new RegExp('recipient_id=eq\\.'+student));
 }finally{await db.close();}
});
