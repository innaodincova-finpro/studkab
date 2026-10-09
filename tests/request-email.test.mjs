import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
import {sendRequestEmail,requestEmailSettings} from '../supabase/functions/studkab-requests/request-email.mjs';

const student='11111111-1111-4111-8111-111111111111',id='33333333-3333-4333-8333-333333333333';
const settings={host:'smtp.example.test',port:465,username:'smtp-login@example.test',password:'test-password',from:'sender@example.test',to:'executor@example.test'};

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

test('SMTP uses independent sender credentials and delivers only the request link to the notification address',async()=>{
 const cfg={executor_email:'login@example.test',notification_email:'inbox@example.test'};
 const chosen=requestEmailSettings(cfg,{...settings,port:'465'});
 assert.equal(chosen.to,cfg.notification_email);
 assert.notEqual(chosen.to,cfg.executor_email);
 assert.equal(chosen.port,465);
 const writes=[],responses=['220 ready','250-smtp.example.test','250 AUTH LOGIN','334 username','334 password','235 authenticated','250 sender','250 recipient','354 go ahead','250 accepted'];
 const connect=async()=>({read:async b=>{const s=responses.shift();if(!s)return null;const v=new TextEncoder().encode(s+'\r\n');b.set(v);return v.length;},
  write:async b=>{writes.push(new TextDecoder().decode(b));return b.length;},close:()=>{}});
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...chosen,connect}),{status:'accepted'});
 assert.ok(writes.some(x=>x.includes('RCPT TO:<inbox@example.test>')));
 assert.ok(writes.some(x=>x.includes('AUTH LOGIN')));
 assert.ok(writes.some(x=>x.trim()===btoa(settings.username)));
 assert.ok(!writes.some(x=>x.trim()===btoa(chosen.to)));
 const mime=writes.find(x=>x.includes('Content-Transfer-Encoding: base64'));
 assert.ok(mime);assert.ok(mime.includes('To: <inbox@example.test>'));
 assert.ok(new TextDecoder().decode(Uint8Array.from(atob(mime.split('\r\n\r\n')[1].replace(/\s|\./g,'')),x=>x.charCodeAt(0))).includes('reestr.html#request='+id));
 assert.ok(!mime.includes('Тестовый студент'));
 assert.equal(requestEmailSettings(cfg,{from:cfg.notification_email,password:'personal-password'}).host,undefined);
});

test('SMTP failure before DATA is bounded; uncertain result after DATA is never retried',async()=>{
 const fake=(codes)=>async()=>({read:async b=>{const s=codes.shift();if(!s)return null;const v=new TextEncoder().encode(s+'\r\n');b.set(v);return v.length;},write:async b=>b.length,close:()=>{}});
 const prefix=['220 ready','250 hello','334 username','334 password','235 authenticated','250 sender'];
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...settings,connect:fake([...prefix,'451 later'])}),{status:'pending'});
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...settings,connect:async()=>{throw Error('connect failed');}}),{status:'pending'});
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

test('SMTP submission on 587 upgrades with STARTTLS before credentials and repeats EHLO on TLS',async()=>{
 const plainWrites=[],tlsWrites=[];let upgraded=false,closed=0;
 const transport=(replies,writes,plaintext=false)=>({
  read:async bytes=>{assert.equal(plaintext&&upgraded,false,'old TCP channel cannot be reused');const reply=replies.shift();if(!reply)return null;const data=new TextEncoder().encode(reply+'\r\n');bytes.set(data);return data.length;},
  write:async bytes=>{assert.equal(plaintext&&upgraded,false);writes.push(new TextDecoder().decode(bytes));return bytes.length;},
  close:()=>closed++
 });
 const plain=transport(['220 ready','250-smtp.example.test\r\n250 STARTTLS','220 ready for TLS'],plainWrites,true);
 const secure=transport(['250 AUTH LOGIN','334 username','334 password','235 authenticated','250 sender','250 recipient','354 go ahead','250 accepted'],tlsWrites);
 const result=await sendRequestEmail({request_id:id,number:7},{...settings,port:587,connect:async()=>plain,startTls:async conn=>{assert.equal(conn,plain);assert.deepEqual(plainWrites,['EHLO studkab.local\r\n','STARTTLS\r\n']);upgraded=true;return secure;}});
 assert.deepEqual(result,{status:'accepted'});assert.equal(closed,1);
 assert.equal(tlsWrites[0],'EHLO studkab.local\r\n');assert.equal(tlsWrites[1],'AUTH LOGIN\r\n');
 assert.ok(!plainWrites.some(x=>x.includes(btoa(settings.username))||x.includes(btoa(settings.password))));
});

test('SMTP 587 never sends credentials if STARTTLS is absent, refused, malformed or cannot be verified',async()=>{
 for(const [replies,expected] of [
  [['220 ready','250 AUTH LOGIN'],'failed'],
  [['220 ready','250 STARTTLS','454 TLS unavailable'],'pending'],
  [['220 ready','250 STARTTLS','220 ready\r\n250 injected plaintext'],'pending'],
  [['220 ready','250 STARTTLS','220 ready'],'pending']
 ]){
  const writes=[];let upgrades=0;
  const conn={read:async bytes=>{const reply=replies.shift();if(!reply)return null;const data=new TextEncoder().encode(reply+'\r\n');bytes.set(data);return data.length;},write:async bytes=>{writes.push(new TextDecoder().decode(bytes));return bytes.length;},close:()=>{}};
  assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...settings,port:587,connect:async()=>conn,startTls:async()=>{upgrades++;throw Error('certificate verification failed');}}),{status:expected});
  assert.ok(writes.every(x=>!x.includes('AUTH LOGIN')&&!x.includes(btoa(settings.username))&&!x.includes(btoa(settings.password))));
  assert.ok(upgrades<=1);
 }
});

test('SMTP preserves fragmented replies and partial writes; only the final acceptance confirms email',async()=>{
 const chunks=['220 re','ady\r\n','250-first\r\n250 ','AUTH LOGIN\r\n','334 user\r\n','334 pass\r\n','235 ok\r\n','250 sender\r\n','250 recipient\r\n','354 data\r\n','250 accept','ed\r\n'],written=[];
 const conn={read:async bytes=>{const chunk=chunks.shift();if(!chunk)return null;const data=new TextEncoder().encode(chunk);bytes.set(data);return data.length;},write:async bytes=>{const part=bytes.subarray(0,Math.min(bytes.length,3));written.push(new TextDecoder().decode(part));return part.length;},close:()=>{}};
 assert.deepEqual(await sendRequestEmail({request_id:id,number:7},{...settings,connect:async()=>conn}),{status:'accepted'});
 assert.ok(written.join('').includes('RCPT TO:<executor@example.test>\r\n'));
});

test('SMTP deadline closes stalled and late transports, without authenticating or reporting acceptance',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let lateResolve,closed=0;
 const sending=sendRequestEmail({request_id:id,number:7},{...settings,connect:()=>new Promise(resolve=>{lateResolve=resolve;})});
 await Promise.resolve();t.mock.timers.tick(10000);
 assert.deepEqual(await sending,{status:'pending'});
 lateResolve({close:()=>closed++});await Promise.resolve();await Promise.resolve();assert.equal(closed,1);
 const stalled={read:()=>new Promise(()=>{}),write:()=>{throw Error('must not authenticate');},close:()=>closed++};
 const stalledSend=sendRequestEmail({request_id:id,number:7},{...settings,connect:async()=>stalled});
 // Wait for the connection to be assigned and its read to start.
 for(let n=0;n<8;n++)await Promise.resolve();
 t.mock.timers.tick(10000);assert.deepEqual(await stalledSend,{status:'pending'});assert.equal(closed,2);
});
