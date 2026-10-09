import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {processNotifications} from '../supabase/functions/studkab-push/process-notifications.mjs';
import {processNotificationMessage,sendProcessEmail} from '../supabase/functions/studkab-requests/request-email.mjs';
const id=randomUUID(),recipient=randomUUID(),settings={host:'smtp.offline.test',port:465,username:'offline',password:'test-only',from:'sender@offline.test'};
const row=channel=>({id:randomUUID(),lease:randomUUID(),requestId:id,number:7,kind:'file_prepared',channel,recipient,eventKey:'job:returned:1',email:'owner@offline.test',chat:123,deviceId:randomUUID(),subscription:{endpoint:'https://offline.test/push'}});
function setup(rows){const finishes=[],claims=[];return {finishes,claims,rpc:async(name,args)=>{if(name.endsWith('_claim')){claims.push(args.p_channel);const selected=rows.filter(r=>r.channel===args.p_channel);rows.splice(0,rows.length,...rows.filter(r=>r.channel!==args.p_channel));return selected;}if(name.endsWith('_finish')){finishes.push(args);return true;}throw Error(name)}};}
test('missing configured channels records not_configured without sending or inventing read receipt',async()=>{
 const s=setup(['push','telegram','email'].map(row));const res=await processNotifications({rpc:s.rpc,sendPush:()=>{throw Error('must not send')},sendEmail:()=>{throw Error('must not send')},fetchTelegram:()=>{throw Error('must not send')}});
 assert.equal(res.notConfigured,3);assert.ok(s.finishes.every(f=>f.p_status==='not_configured'));assert.deepEqual(s.claims,['push','telegram','email']);assert.equal(res.read,undefined);
});
test('existing transports return acceptance only and use SQL-bound recipients with short links',async()=>{
 const rows=['push','telegram','email'].map(row),s=setup(rows);let push=0,mail=0,telegram=0;
 const res=await processNotifications({rpc:s.rpc,configuration:{vapid:{publicKey:'offline-public',privateKey:'offline-private'}},telegramToken:'test-only',emailSettings:settings,
 sendPush:async(sub,msg)=>{push++;assert.equal(sub.user_id,recipient);assert.equal(msg.tag,'job:returned:1');assert.match(msg.url,/reestr.html#request=/)},
 sendEmail:async(event,cfg)=>{mail++;assert.equal(cfg.to,'owner@offline.test');assert.equal(event.requestId,id);return {status:'accepted'}},
 fetchTelegram:async(url,opts)=>{telegram++;const sent=JSON.parse(opts.body);assert.equal(sent.chat_id,123);assert.equal(sent.reply_markup.inline_keyboard[0][0].url,processNotificationMessage(row('telegram')).url);return Response.json({ok:true,result:{message_id:99}})}});
 assert.equal(res.accepted,3);assert.deepEqual([push,mail,telegram],[1,1,1]);assert.equal(s.finishes.find(f=>f.p_receipt).p_receipt,'99');
});
test('ambiguous acknowledgments are terminal unknown and a second run does not resend them',async()=>{
 const s=setup(['telegram','email'].map(row));let sends=0;
 const deps={rpc:s.rpc,telegramToken:'test-only',emailSettings:settings,fetchTelegram:async()=>{sends++;throw Error('reply lost')},sendEmail:async()=>{sends++;return {status:'unknown'}}};
 assert.equal((await processNotifications(deps)).unknown,2);assert.ok(s.finishes.every(f=>f.p_status==='unknown'));
 await processNotifications(deps);assert.equal(sends,2);
});
test('lost durable finish acknowledgment never retries the external send',async()=>{
 const s=setup([row('telegram')]);let sends=0;const old=s.rpc;s.rpc=(name,args)=>name.endsWith('_finish')?Promise.reject(Error('lost DB ack')):old(name,args);
 const res=await processNotifications({rpc:s.rpc,telegramToken:'test-only',fetchTelegram:async()=>{sends++;return Response.json({ok:true,result:{message_id:1}})}});
 assert.equal(res.accepted,0);assert.equal(res.unconfirmed,1);assert.equal(sends,1);
});
test('explicit provider refusal differs from missing or malformed acknowledgment',async()=>{
 for(const [body,expected] of [[{ok:false,error_code:400},'failed'],[{ok:false,error_code:429},'pending'],[{ok:false,error_code:503},'pending'],[{ok:false},'unknown'],[{ok:true},'unknown']]){
  const s=setup([row('telegram')]);await processNotifications({rpc:s.rpc,telegramToken:'test-only',fetchTelegram:async()=>Response.json(body)});assert.equal(s.finishes[0].p_status,expected);
 }
});
test('SMTP safe pre-DATA retry remains distinct from uncertain post-DATA acceptance',async()=>{
 const s=setup([row('email')]);const result=await processNotifications({rpc:s.rpc,emailSettings:settings,sendEmail:async()=>({status:'pending'})});assert.equal(result.pending,1);assert.equal(s.finishes[0].p_status,'pending');
});
test('all process templates route by recipient role and contain no document or secret text',async()=>{
 for(const kind of ['file_prepared','problem','answer','handed','rework','question','delivered']){
  const message=processNotificationMessage({...row('email'),kind,secret:'must-not-appear'});
  assert.ok(message.url.includes(['question','delivered'].includes(kind)?'index.html':'reestr.html'));assert.ok(!JSON.stringify(message).includes('must-not-appear'));
 }
 assert.throws(()=>processNotificationMessage({...row('email'),kind:'other'}),/Invalid event kind/);
 const responses=['220 ready','250 hello','334 login','334 password','235 ok','250 sender','250 recipient','354 data','250 accepted'],writes=[];
 const connect=async()=>({read:async bytes=>{const code=responses.shift();if(!code)return null;const data=new TextEncoder().encode(code+'\r\n');bytes.set(data);return data.length},write:async bytes=>{writes.push(new TextDecoder().decode(bytes));return bytes.length},close:()=>{}});
 assert.deepEqual(await sendProcessEmail({...row('email'),kind:'delivered'},{...settings,to:'student@offline.test',connect}),{status:'accepted'});
 const mime=writes.find(x=>x.includes('Content-Transfer-Encoding: base64'));
 const body=new TextDecoder().decode(Uint8Array.from(atob(mime.split('\r\n\r\n')[1].replace(/\s|\./g,'')),x=>x.charCodeAt(0)));
 assert.match(body,/Работа готова/);assert.ok(body.includes('index.html#request='+id));
});
test('time budget releases only undispatched claims and preserves time for existing cron work',async()=>{
 let tick=0,sends=0;const s=setup([row('telegram'),row('telegram')]);
 const result=await processNotifications({rpc:s.rpc,now:()=>tick,telegramToken:'offline',channelOrder:['telegram','email','push'],fetchTelegram:async()=>{sends++;tick=40000;return Response.json({ok:true,result:{message_id:1}})}});
 assert.equal(sends,1);assert.equal(result.accepted,1);assert.equal(result.pending,1);assert.deepEqual(s.claims,['telegram']);assert.equal(s.finishes[1].p_status,'pending');
});
