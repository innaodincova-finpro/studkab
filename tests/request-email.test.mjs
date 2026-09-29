import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
import {sendRequestEmail,requestEmailSettings} from '../supabase/functions/studkab-requests/request-email.mjs';

const student='11111111-1111-4111-8111-111111111111',id='33333333-3333-4333-8333-333333333333';
const settings={password:'test-password',from:'sender@example.test',to:'executor@example.test'};

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
  const interrupted='66666666-6666-4666-8666-666666666666';
  await db.query('insert into studkab_requests(id,number,student_id,payload) values($1,6,$2,$3)',[interrupted,student,{rq:'Нужен учебный анализ по заданию'}]);
  await db.query('select studkab_request_publish($1,$2)',[interrupted,student]);
  await db.query('select * from claim_studkab_request_emails()');
  await db.query("update studkab_request_email_notifications set claimed_at=now()-interval '6 minutes' where request_id=$1",[interrupted]);
  assert.equal((await db.query('select reconcile_studkab_request_emails() n')).rows[0].n,1);
  assert.equal((await db.query('select status from studkab_request_email_notifications where request_id=$1',[interrupted])).rows[0].status,'unknown');
  assert.equal((await db.query('select count(*)::int n from claim_studkab_request_emails()')).rows[0].n,0);
 }finally{await db.close();}
});

test('Mail.ru SMTP sends only the request number and authenticated link to the separate notification address',async()=>{
 const cfg={executor_email:'login@example.test',notification_email:'inbox@example.test'};
 const chosen=requestEmailSettings(cfg,{from:settings.from,password:settings.password});
 assert.equal(chosen.to,cfg.notification_email);
 assert.notEqual(chosen.to,cfg.executor_email);
 const writes=[],responses=['220 ready','250-smtp.mail.ru','250 AUTH LOGIN','334 username','334 password','235 authenticated','250 sender','250 recipient','354 go ahead','250 accepted'];
 const connect=async()=>({read:async b=>{const s=responses.shift();if(!s)return null;const v=new TextEncoder().encode(s+'\\r\\n');b.set(v);return v.length;},
  write:async b=>{writes.push(new TextDecoder().decode(b));return b.length;},close:()=>{}});
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...chosen,connect}),{status:'accepted'});
 assert.ok(writes.some(x=>x.includes('RCPT TO:<inbox@example.test>')));
 assert.ok(writes.some(x=>x.includes('AUTH LOGIN')));
 assert.ok(writes.some(x=>x.includes('reestr.html#request=')===false));
 const mime=writes.find(x=>x.includes('Content-Transfer-Encoding: base64'));
 assert.ok(mime);assert.ok(mime.includes('To: <inbox@example.test>'));
 assert.ok(new TextDecoder().decode(Uint8Array.from(atob(mime.split('\\r\\n\\r\\n')[1].replace(/\\s|\\./g,'')),x=>x.charCodeAt(0))).includes('reestr.html#request='+id));
 assert.ok(!mime.includes('Тестовый студент'));
});

test('SMTP failure before DATA is bounded; uncertain result after DATA is never retried',async()=>{
 const fake=(codes)=>async()=>({read:async b=>{const s=codes.shift();if(!s)return null;const v=new TextEncoder().encode(s+'\\r\\n');b.set(v);return v.length;},write:async b=>b.length,close:()=>{}});
 const prefix=['220 ready','250 hello','334 username','334 password','235 authenticated','250 sender'];
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...settings,connect:fake([...prefix,'451 later'])}),{status:'pending'});
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...settings,connect:fake(['220 ready','250 hello','334 username','334 password','535 invalid'])}),{status:'failed'});
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...settings,connect:fake([...prefix,'250 recipient','354 go ahead'])}),{status:'unknown'});
});

test('cron records email independently; missing provider never claims email',async()=>{
 const calls=[];let enabled=false;
 const app=handler({config:async()=>({cron_token:'job',executor_email:settings.to}),db:async(path,method,body)=>{
  calls.push({path,body});if(path==='rpc/claim_studkab_requests')return [];
  if(path==='rpc/reconcile_studkab_request_emails')return 0;
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
