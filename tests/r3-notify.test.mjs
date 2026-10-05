// ROUTE-03, R3-F: исполнителю — уведомление о возврате работы (push и Telegram), каждое один раз, с повтором при сбое.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {schema,submissionExtension,student,other} from './intake-fixture.mjs';
import {returnPush,returnTelegram} from '../supabase/functions/studkab-push/r3-notify.mjs';
const read=n=>fs.readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const r3a=read('20261005090000_route03_a_request_form.sql');
async function fixture(){
 const db=new PGlite();
 await db.exec(schema()+submissionExtension()+read('20261001162253_route02_receive_before_analysis.sql')+r3a.slice(r3a.indexOf('-- R3-A: регистрация заявки по форме'))+read('20261005120000_route03_c_work.sql')+read('20261006090000_route03_d_hand_return.sql'));
 await db.exec(`alter table auth.users add column if not exists email text;
  create table if not exists studkab_push_subscriptions(id uuid primary key,user_id uuid,enabled boolean);
  create table if not exists studkab_telegram_setup(id boolean primary key,owner_chat_id bigint,installed boolean);`);
 await db.exec(read('20261006150000_route03_f_return_notify.sql'));
 await db.exec("update studkab_request_config set executor_email='Exec@Example.invalid'");
 await db.query("update auth.users set email=$2 where id=$1",[other,'exec@example.invalid']);
 await db.query("update auth.users set email=$2 where id=$1",[student,'student@example.invalid']);
 await db.exec("insert into studkab_push_subscriptions values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','"+other+"',true),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','"+student+"',true)");
 await db.exec('set role service_role');
 const rpc=async(name,args)=>(await db.query('select '+name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r;
 const draft=await rpc('studkab_intake_open',{p_student:student});
 const snap=await rpc('studkab_intake_receive_snapshot',{p_student:student,p_draft:draft.id});
 const receipt=await rpc('studkab_intake_receive_form',{p_student:student,p_draft:draft.id,p_revision:snap.revision,p_deadline:'2027-01-25',p_description:'',p_contact:'s@example.invalid',p_details:JSON.stringify({k:'Реферат',d:'История',u:'ВУЗ',fo:'Очная',g:'1 курс',n:'Студент'}),p_link:'https://disk.yandex.ru/d/x'});
 if(!receipt.id)throw Error('receipt failed: '+JSON.stringify(receipt));
 const id=receipt.id,h='a'.repeat(64);
 await rpc('studkab_r3_take',{p_request:id});
 await rpc('studkab_r3_result_set',{p_request:id,p_name:'Работа.docx',p_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',p_size:10,p_hash:h,p_path:'r3-results/'+id+'/'+h});
 await rpc('studkab_r3_deliver',{p_request:id,p_hash:h});
 await rpc('studkab_r3_hand',{p_request:id,p_student:student});
 return {db,id,rpc};
}
test('R3-F SQL: a return is claimed for Telegram once per lease; push targets only the executor devices; closed to browsers',async()=>{
 const f=await fixture();try{
  assert.equal((await f.db.query('select * from claim_studkab_r3_return_telegram()')).rows.length,0);
  await f.db.query('select studkab_r3_return($1,$2,$3)',[f.id,student,'Задание 3 подробно']);
  const first=(await f.db.query('select * from claim_studkab_r3_return_telegram()')).rows;
  assert.equal(first.length,1);assert.equal(first[0].n,1);assert.equal(first[0].telegram_attempts,1);
  assert.equal((await f.db.query('select * from claim_studkab_r3_return_telegram()')).rows.length,0,'lease blocks a second claim');
  await f.db.query("update studkab_r3_returns set telegram_sent_at=now(),telegram_lease_until=null where request_id=$1",[f.id]);
  await f.db.query("update studkab_r3_returns set telegram_lease_until=now()-interval '1 minute' where request_id=$1",[f.id]);
  assert.equal((await f.db.query('select * from claim_studkab_r3_return_telegram()')).rows.length,0,'sent returns are not claimed again');
  assert.equal((await f.db.query("select * from studkab_r3_return_push_targets('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')")).rows.length,1);
  assert.equal((await f.db.query("select * from studkab_r3_return_push_targets('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')")).rows.length,0,'student device gets nothing');
  for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);
   await assert.rejects(()=>f.db.query('select * from claim_studkab_r3_return_telegram()'),/permission denied/);
   await assert.rejects(()=>f.db.query("select * from studkab_r3_return_push_targets('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')"),/permission denied/);}
 }finally{await f.db.close();}
});
test('R3-F module: push once per device and return; Telegram retries later on failure',async()=>{
 const claimed=new Set(),patches=[],sends=[];
 const db=async(path,method,body)=>{
  if(path==='rpc/studkab_r3_return_push_targets')return [{request_id:'r1',n:1,number:15}];
  if(path==='rpc/claim_studkab_push_delivery'){if(claimed.has(body.delivery_key))return false;claimed.add(body.delivery_key);return true;}
  if(path.startsWith('studkab_push_subscriptions?id=eq.s1&enabled'))return [{id:'s1'}];
  if(path==='rpc/claim_studkab_r3_return_telegram')return [{request_id:'r1',n:1,number:15,telegram_attempts:2}];
  if(path.startsWith('studkab_telegram_setup'))return [{owner_chat_id:7,installed:true}];
  patches.push([path,body]);return null;};
 const send=async(sub,msg)=>{sends.push(msg);};
 assert.deepEqual(await returnPush({db,send,sub:{id:'s1'},configuration:{}}),{sent:1,failed:0});
 assert.deepEqual(await returnPush({db,send,sub:{id:'s1'},configuration:{}}),{sent:0,failed:0});
 assert.equal(sends.length,1);assert.equal(sends[0].body,'Заявку №15 вернули на доработку. Откройте замечания.');assert.equal(sends[0].url,'./reestr.html#request=r1');
 const okFetch=async(url,init)=>{assert.match(JSON.parse(init.body).text,/заявке №15 на доработку/);return {ok:true,json:async()=>({ok:true})};};
 assert.deepEqual(await returnTelegram({db,fetch:okFetch,token:'t',now:()=>0}),{sent:1,failed:0});
 assert.ok(patches.some(([p,b])=>p==='studkab_r3_returns?request_id=eq.r1&n=eq.1'&&b.telegram_sent_at));
 const badFetch=async()=>({ok:false,json:async()=>({ok:false})});
 assert.deepEqual(await returnTelegram({db,fetch:badFetch,token:'t',now:()=>0}),{sent:0,failed:1});
 const retry=patches.at(-1)[1];assert.equal(retry.telegram_lease_until,null);assert.equal(retry.telegram_retry_at,new Date(240000).toISOString());
 assert.deepEqual(await returnTelegram({db,fetch:okFetch,token:'',now:()=>0}),{sent:0,failed:1},'no token — retry later, nothing sent');
});
