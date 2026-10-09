import test from 'node:test';
import assert from 'node:assert/strict';
import {handler,digest,webhookSecret,BOT,WEBHOOK} from '../supabase/functions/studkab-telegram/handler.mjs';

const bootstrap='a'.repeat(64), activation='bind_'+'b'.repeat(43), token='test-only-token';
async function fixture() {
  const row={setup_hash:await digest(bootstrap),owner_hash:await digest(activation),installed:false,owner_chat_id:null,expires_at:'2030-01-02T00:00:00Z'};
  const calls=[];
  let username=BOT, previous='';
  const db={get:async()=>({...row}),install:async()=>{row.installed=true;},bind:async(hash,id)=>{
    if (row.owner_chat_id !== null || hash !== row.owner_hash) return false;
    row.owner_chat_id=id; return true;
  }};
  const app=handler({token,db,now:()=>Date.parse('2030-01-01T00:00:00Z'),telegram:async(method,payload)=>{
    calls.push({method,payload});
    if (method==='getMe') return {username};
    if (method==='getWebhookInfo') return {url:previous};
    return true;
  }});
  const setup=(code=bootstrap)=>app(new Request(WEBHOOK.replace('/webhook','/setup'),{method:'POST',headers:{authorization:'Bearer '+code}}));
  const expectedSecret = await webhookSecret(token);
  const start=async(id=100,code=activation,type='private',secret=expectedSecret)=>app(new Request(WEBHOOK,{method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:JSON.stringify({message:{chat:{id,type},from:{id,is_bot:false},text:'/start '+code}})}));
  return {row,calls,setup,start,wrongBot:()=>{username='Other_bot';},foreignWebhook:()=>{previous='https://other.example/webhook';}};
}
test('setup rejects wrong capability and cannot be replayed; webhook uses secret',async()=>{
  const f=await fixture();
  assert.equal((await f.setup('c'.repeat(64))).status,401);
  assert.equal(f.calls.length,0);
  assert.equal((await f.setup()).status,200);
  assert.equal((await f.setup()).status,401);
  const install=f.calls.find(c=>c.method==='setWebhook');
  assert.equal(install.payload.url,WEBHOOK);
  assert.equal(install.payload.secret_token,await webhookSecret(token));
  assert.equal((await f.start(100,activation,'private','forged')).status,401);
  assert.equal(f.row.owner_chat_id,null);
});
test('wrong bot or foreign webhook cannot be overwritten',async()=>{
  for (const kind of ['wrongBot','foreignWebhook']) {
    const f=await fixture(); f[kind]();
    assert.equal((await f.setup()).status,409);
    assert.equal(f.calls.some(c=>c.method==='setWebhook'),false);
    assert.equal(f.row.installed,false);
  }
});
test('binding requires private chat and correct unexpired activation',async()=>{
  const f=await fixture(); await f.setup();
  await f.start(100,activation,'group');
  assert.equal(f.row.owner_chat_id,null);
  await f.start(100,'bind_'+'c'.repeat(43));
  assert.equal(f.row.owner_chat_id,null);
  f.row.expires_at='2029-12-31T00:00:00Z';
  await f.start(); assert.equal(f.row.owner_chat_id,null);
});
test('recipient binds once; a second chat cannot take over; retry is safe',async()=>{
  const f=await fixture(); await f.setup();
  await f.start(100);
  assert.equal(f.row.owner_chat_id,100);
  await f.start(200); assert.equal(f.row.owner_chat_id,100);
  await f.start(100); assert.equal(f.row.owner_chat_id,100);
  const replies=f.calls.filter(c=>c.method==='sendMessage');
  assert.match(replies.at(-1).payload.text,/привязан/);
  assert.doesNotMatch(replies.filter(c=>c.payload.chat_id===200).at(-1).payload.text,/привязан/);
  assert.ok(replies.every(c=>!c.payload.text.includes(activation)));
});

test('bound owner enables callbacks only on the verified existing webhook',async()=>{
 for(const url of [WEBHOOK,'https://foreign.example/webhook']){
  const calls=[],secret=await webhookSecret(token);
  const app=handler({token,db:{get:async()=>({installed:true,owner_chat_id:100}),action:async()=>({})},telegram:async(method,payload)=>{calls.push({method,payload});return method==='getWebhookInfo'?{url,allowed_updates:['message']}:{message_id:1};}});
  const r=await app(new Request(WEBHOOK,{method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:JSON.stringify({message:{chat:{id:100,type:'private'},from:{id:100,is_bot:false},text:'/start'}})}));
  assert.equal(r.status,200);const changed=calls.find(c=>c.method==='setWebhook');
  assert.equal(Boolean(changed),url===WEBHOOK);
  if(changed){assert.deepEqual(changed.payload.allowed_updates,['message','callback_query']);assert.equal(changed.payload.secret_token,secret);}
 }
});

test('personal account link requires verified private sender and consumes only hash once',async()=>{
 const raw='d'.repeat(64),expected=await digest(raw),secret=await webhookSecret(token),calls=[];
 let consumed=false;
 const app=handler({token,db:{get:async()=>({installed:true,owner_chat_id:999}),link:async args=>{calls.push(args);if(consumed||args.p_hash!==expected)return false;consumed=true;return true;}},telegram:async(method,payload)=>{calls.push({method,payload});return true;}});
 const request=(overrides={},auth=secret)=>app(new Request(WEBHOOK,{method:'POST',headers:{'x-telegram-bot-api-secret-token':auth},body:JSON.stringify({message:{text:'/start link_'+raw,chat:{id:100,type:'private'},from:{id:100,is_bot:false},...overrides}})}));
 assert.equal((await request({},'forged')).status,401);
 await request({chat:{id:100,type:'group'}});await request({from:{id:200,is_bot:false}});await request({from:{id:100,is_bot:true}});
 assert.equal(calls.length,0);
 await request();assert.deepEqual(calls[0],{p_hash:expected,p_chat:100});assert.match(calls[1].payload.text,/подключён/);
 await request();assert.match(calls.at(-1).payload.text,/недействительна/);
 assert.doesNotMatch(JSON.stringify(calls),new RegExp(raw));
});
