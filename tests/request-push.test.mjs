import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {requestPush} from '../supabase/functions/studkab-push/request-push.mjs';

const owner='11111111-1111-4111-8111-111111111111',student='22222222-2222-4222-8222-222222222222';
const sub='33333333-3333-4333-8333-333333333333',secondSub='77777777-7777-4777-8777-777777777777',otherSub='44444444-4444-4444-8444-444444444444';
const old='55555555-5555-4555-8555-555555555555',fresh='66666666-6666-4666-8666-666666666666';

test('only a newly published request queues push for the current executor device, never old or student devices',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text not null);
   create table public.studkab_request_config(id boolean primary key,executor_email text not null);
   create table public.studkab_requests(id uuid primary key,number bigint,ready_at timestamptz,deleting_at timestamptz);
   create table public.studkab_push_subscriptions(id uuid primary key,user_id uuid,enabled boolean);
   insert into auth.users values('${owner}','owner@example.test'),('${student}','student@example.test');
   insert into public.studkab_request_config values(true,'owner@example.test');
   insert into public.studkab_push_subscriptions values('${sub}','${owner}',true),('${secondSub}','${owner}',true),('${otherSub}','${student}',true);
   insert into public.studkab_requests values('${old}',1,now(),null);`);
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260929051225_c175_request_push.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select count(*)::int n from public.studkab_request_push_events')).rows[0].n,0);
  await db.query('insert into public.studkab_requests(id,number) values($1,2)',[fresh]);
  assert.equal((await db.query('select count(*)::int n from public.studkab_request_push_events')).rows[0].n,0);
  await db.query('update public.studkab_requests set ready_at=now() where id=$1',[fresh]);
  await db.query('update public.studkab_requests set ready_at=now() where id=$1',[fresh]);
  const rows=(await db.query('select id,request_id,subscription_id from public.studkab_request_push_events')).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(x=>x.request_id===fresh));
  assert.deepEqual(rows.map(x=>x.subscription_id).sort(),[sub,secondSub].sort());
  assert.equal((await db.query('select public.studkab_request_push_target($1) ok',[rows[0].id])).rows[0].ok,true);
  await db.query("update public.studkab_request_config set executor_email='student@example.test'");
  assert.equal((await db.query('select public.studkab_request_push_target($1) ok',[rows[0].id])).rows[0].ok,false);
  assert.equal((await db.query("select has_table_privilege('authenticated','public.studkab_request_push_events','SELECT') ok")).rows[0].ok,false);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.studkab_request_push_target(bigint)','EXECUTE') ok")).rows[0].ok,false);
 }finally{await db.close();}
});

test('push opens the exact registry request and is not sent to a revoked target',async()=>{
 const now=Date.parse('2026-09-29T05:00:00Z'),calls=[],writes=[],key=sub+':request:'+fresh;
 const event={id:1,request_id:fresh,subscription_id:sub,created_at:new Date(now).toISOString()};
 const db=async(path,method,body)=>{
  calls.push({path,method,body});
  if(method==='PATCH'){writes.push({path,body});return [];}
  if(path.startsWith('studkab_request_push_events?'))return [event];
  if(path==='rpc/claim_studkab_push_delivery')return true;
  if(path==='rpc/studkab_request_push_target')return true;
  if(path.startsWith('studkab_push_subscriptions?id=eq.')&&method!=='PATCH')return [{id:sub}];
  if(path.startsWith('studkab_requests?id=eq.'))return [{id:fresh,number:2}];
  throw Error(path);
 };
 let message;
 assert.deepEqual(await requestPush({db,send:async(s,m)=>{message=m;},configuration:{},now:()=>now}),{sent:1,failed:0});
 assert.equal(message.title,'Реестр заявок');
 assert.equal(message.url,'./reestr.html#request='+fresh);
 assert.equal(message.body,'Новая заявка №2. Откройте реестр.');
 assert.equal(message.tag,key);
 assert.ok(writes.some(x=>x.path.startsWith('studkab_request_push_events?id=eq.')&&x.body.accepted_at));
 const denied=async(path,method,body)=>path.startsWith('studkab_request_push_events?')?[event]:path==='rpc/claim_studkab_push_delivery'?true:path==='rpc/studkab_request_push_target'?false:method==='PATCH'?[]:(()=>{throw Error(path);})();
 assert.deepEqual(await requestPush({db:denied,send:()=>{throw Error('must not send');},configuration:{},now:()=>now}),{sent:0,failed:0});
});
