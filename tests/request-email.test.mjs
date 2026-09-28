import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
import {sendRequestEmail} from '../supabase/functions/studkab-requests/request-email.mjs';

const student='11111111-1111-4111-8111-111111111111',id='33333333-3333-4333-8333-333333333333';
const settings={apiKey:'test-key',from:'sender@example.test',to:'executor@example.test'};

test('email is queued once at publication, never for draft/old request; separate from Telegram',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table studkab_requests(id uuid primary key,number bigint,student_id uuid,created_at timestamptz default now(),
    deleting_at timestamptz,payload jsonb default '{}'::jsonb,telegram_sent_at timestamptz,telegram_attempts integer default 0,
    retry_at timestamptz default now()-interval '1 minute',lease_until timestamptz,ready_at timestamptz);
   create table studkab_request_attachments(id uuid primary key default gen_random_uuid(),request_id uuid,
    category text,file_hash text,supersedes uuid);`);
  await db.query('insert into studkab_requests(id,number,student_id,ready_at) values($1,4,$2,now())',[id,student]);
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260926125807_c121_conditional_request_materials.sql',import.meta.url),'utf8'));
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260928163000_c172_request_email_notifications.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select count(*)::int n from studkab_request_email_notifications')).rows[0].n,0);
  const fresh='44444444-4444-4444-8444-444444444444';
  await db.query('insert into studkab_requests(id,number,student_id,payload) values($1,5,$2,$3)',[fresh,student,{rq:'Нужен учебный анализ по заданию'}]);
  assert.equal((await db.query('select count(*)::int n from studkab_request_email_notifications')).rows[0].n,0);
  await db.query('select studkab_request_publish($1,$2)',[fresh,student]);
  await db.query('select studkab_request_publish($1,$2)',[fresh,student]);
  assert.equal((await db.query('select count(*)::int n from studkab_request_email_notifications')).rows[0].n,1);
  const [first]=(await db.query('select * from claim_studkab_request_emails()')).rows;
  assert.equal(first.number,5);
  assert.equal((await db.query('select count(*)::int n from claim_studkab_request_emails()')).rows[0].n,0);
  assert.equal((await db.query('select finish_studkab_request_email($1,$2,$3,$4) ok',[fresh,first.lease_id,'accepted','message-5'])).rows[0].ok,true);
  assert.equal((await db.query('select finish_studkab_request_email($1,$2,$3,$4) ok',[fresh,first.lease_id,'accepted','message-5'])).rows[0].ok,false);
  const state=(await db.query('select status,provider_message_id from studkab_request_email_notifications where request_id=$1',[fresh])).rows[0];
  assert.deepEqual(state,{status:'accepted',provider_message_id:'message-5'});
 }finally{await db.close();}
});

test('email API sends only the request number and authenticated registry link; ambiguous errors are not blindly retried',async()=>{
 let body,headers;
 const request=async(url,options)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');body=JSON.parse(options.body);headers=options.headers;return Response.json({messageId:'msg-1'},{status:201});};
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7}, {...settings,request}),{status:'accepted',messageId:'msg-1'});
 assert.equal(body.to[0].email,settings.to);assert.equal(body.sender.email,settings.from);
 assert.ok(body.textContent.includes('reestr.html#request='+id));assert.equal(headers['api-key'],settings.apiKey);
 assert.equal(JSON.stringify(body).includes('Тестовый студент'),false);
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...settings,request:async()=>{throw Error('timeout');}}),{status:'unknown'});
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...settings,request:async()=>Response.json({},{status:429})}),{status:'pending'});
});

test('cron records email independently; missing provider never claims email',async()=>{
 const calls=[];let enabled=false;
 const app=handler({config:async()=>({cron_token:'job',executor_email:settings.to}),db:async(path,method,body)=>{
  calls.push({path,body});if(path==='rpc/claim_studkab_requests')return [];
  if(path==='rpc/claim_studkab_request_emails')return [{request_id:id,lease_id:'55555555-5555-4555-8555-555555555555',number:7}];
  if(path==='rpc/finish_studkab_request_email')return true;
  throw Error(path);
 },emailSettings:()=>enabled?settings:{},sendEmail:async()=>({status:'accepted',messageId:'provider-id'})});
 const req=()=>new Request('https://test/',{method:'POST',headers:{'x-job-key':'job'},body:'{}'});
 assert.equal((await (await app(req())).json()).email.configured,false);
 assert.equal(calls.filter(x=>x.path==='rpc/claim_studkab_request_emails').length,0);
 enabled=true;
 const result=await (await app(req())).json();assert.equal(result.email.accepted,1);assert.equal(result.sent,0);
 assert.equal(calls.at(-1).body.p_message_id,'provider-id');
});
