const {test}=require('node:test');const assert=require('node:assert/strict');
const core=import('../supabase/functions/studkab-email/core.mjs');
const postbox=import('../supabase/functions/studkab-email/postbox.mjs');
const at=Date.parse('2026-09-17T07:00:00Z');
const account={id:'a',email:'student@example.test',email_confirmed_at:'2026-01-01'};
async function setup({changed=false,disabled=false,accountChanged=false,sendResult={state:'accepted',messageId:'test'}}={}){
 const {service}=await core;const writes=[],sent=[];let prefReads=0,dataReads=0;
 const pref={user_id:'a',email:account.email,timezone:'Europe/Moscow',enabled:true};
 const data={settings:{warnDays:3},works:[{id:'w',deadline:'2026-09-20'}]};
 const db=async(path,method='GET',body)=>{
  if(method!=='GET'){writes.push({path,body});if(path.startsWith('rpc/'))return true;return [];}
  if(path.startsWith('studkab_email_configuration'))return [{cursor:null}];
  if(path.includes('order=user_id'))return [pref];
  if(path.startsWith('studkab_email_preferences')){prefReads++;return [{...pref,enabled:!disabled,email:accountChanged?'old@example.test':pref.email}];}
  if(path.startsWith('app_data')){dataReads++;return [{data:changed&&dataReads>1?{...data,works:[]}:data}];}
  throw Error(path);
 };
 const app=service({db,getUser:async()=>account,send:async(...args)=>{sent.push(args);return sendResult;},now:()=>at,ready:true,pause:async()=>{}});
 return {app,writes,sent};
}
test('only verified, non-anonymous account email can receive',async()=>{const {verifiedEmail}=await core;assert.equal(verifiedEmail(account),account.email);for(const u of [null,{...account,email_confirmed_at:null},{...account,is_anonymous:true}])assert.equal(verifiedEmail(u),null);});
test('one digest per day; moved/completed work omitted; correct local time',async()=>{const {reminder}=await core;const d={settings:{warnDays:3},works:[{id:'a',deadline:'2026-09-20'},{id:'b',deadline:'2026-09-20',status:'graded'}]};assert.match(reminder(d,'Europe/Moscow',at).body,/1 работ/);assert.equal(reminder(d,'UTC',at),null);assert.equal(reminder({...d,works:[]},'Europe/Moscow',at),null);assert.equal(reminder(d,'Europe/Moscow',at).key,reminder(d,'Europe/Moscow',at+60000).key);});
test('dispatch accepts one digest and persists provider ID',async()=>{const c=await setup();assert.equal((await c.app.dispatch()).accepted,1);assert.equal(c.sent.length,1);assert.equal(c.sent[0][0],account.email);assert.ok(c.writes.some(w=>w.body.message_id==='test'));});
test('recheck stops deleted works, disabled channel and changed address before send',async()=>{for(const option of [{changed:true},{disabled:true},{accountChanged:true}]){const c=await setup(option);await c.app.dispatch();assert.equal(c.sent.length,0);assert.ok(c.writes.some(w=>w.body.state==='cancelled'));}});
test('input cannot replace recipient; unverified account rejected; sending gated',async()=>{
 const {service}=await core;const writes=[];const db=async(p,m,b)=>{if(b)writes.push(b);return []};
 const app=service({db,ready:true});await app.action(account,{action:'enable',email:'attacker@example.test',user_id:'other',timezone:'UTC'});assert.equal(writes[0].email,account.email);assert.equal(writes[0].user_id,'a');
 assert.equal((await app.action({...account,email_confirmed_at:null},{action:'enable',timezone:'UTC'})).status,403);
 assert.equal((await service({db,ready:false}).action(account,{action:'enable',timezone:'UTC'})).status,503);
 assert.equal((await app.action(account,{action:'enable',timezone:'Invalid/Zone'})).status,400);
});
test('ambiguous result never recorded as accepted',async()=>{const c=await setup({sendResult:{state:'unknown'}});assert.equal((await c.app.dispatch()).accepted,0);assert.ok(c.writes.some(w=>w.body.state==='unknown'));assert.ok(!c.writes.some(w=>w.body.last_accepted_at));});
test('Postbox signature and fixed destination; delivery states distinguish acceptance',async()=>{const {sender}=await postbox;const config={from:'sender@example.test',accessKeyId:'test-id',secretAccessKey:'test-secret'};
 for(const [status,payload,state] of [[200,{MessageId:'id'},'accepted'],[200,{},'unknown'],[429,{},'retry'],[503,{},'unknown'],[400,{},'rejected']]){
  const send=sender(config,async(req)=>{assert.equal(new URL(req.url).hostname,'postbox.cloud.yandex.net');assert.match(req.headers.get('authorization'),/ru-central1\/ses\/aws4_request/);const body=await req.json();assert.deepEqual(body.Destination.ToAddresses,[account.email]);return new Response(JSON.stringify(payload),{status});});
  assert.equal((await send(account.email,'Напоминание')).state,state);
 }
 assert.equal((await sender(config,async()=>{throw Error('timeout')})(account.email,'test')).state,'unknown');
});
