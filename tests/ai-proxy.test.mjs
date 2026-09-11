import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/ai-proxy.mjs';
const env={PROXY_TOKEN:'test-only',DEEPSEEK_KEY:'test-key',RATE_MAX:1000};
function request(body,headers={}) {return new Request('https://example.test/',{method:'POST',headers:{'Content-Type':'application/json','X-Proxy-Token':'test-only',...headers},body:JSON.stringify(body)});}
const basic={provider:'deepseek',system:'Инструкция',user:'Материалы',max_tokens:8000};
function reply(reason='stop',text='Полный ответ'){return Response.json({choices:[{finish_reason:reason,message:{content:text}}],usage:{prompt_tokens:5,completion_tokens:7}});}
test('preserves both fields beyond the former 40000-character cut',async t=>{
  let sent;
  t.mock.method(globalThis,'fetch',async (url,opts)=>{sent=JSON.parse(opts.body);return reply();});
  const body={...basic,system:'а'.repeat(50000)+'КОНЕЦ ЗАДАНИЯ',user:'б'.repeat(70000)+'КОНЕЦ МАТЕРИАЛОВ'};
  const r=await worker.fetch(request(body),env);
  assert.equal(r.status,200);assert.ok(sent.messages[0].content === body.system);assert.ok(sent.messages[1].content === body.user);
  assert.equal((await r.json()).complete,true);
});
test('rejects too much context before any paid request',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('must not call');});
  const r=await worker.fetch(request({...basic,user:'x'.repeat(180001)}),env);
  assert.equal(r.status,413);assert.equal((await r.json()).error,'CONTEXT_TOO_BIG');assert.equal(fetch.mock.callCount(),0);
});
test('rejects oversized stream without trusting content-length',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('must not call');});
  const r=await worker.fetch(request({...basic,user:'x'.repeat(1200001)}),env);
  assert.equal(r.status,413);assert.equal((await r.json()).error,'TOO_BIG');assert.equal(fetch.mock.callCount(),0);
});
test('never exposes unfinished output as a successful chapter',async t=>{
  for(const reason of ['length','content_filter','tool_calls','insufficient_system_resource',null,undefined]) {
    const f=t.mock.method(globalThis,'fetch',async()=>Response.json({choices:[{finish_reason:reason,message:{content:'Incomplete sentence'}}]}));
    const r=await worker.fetch(request(basic),env);const j=await r.json();
    assert.equal(r.status,502);assert.equal(j.error,'INCOMPLETE:deepseek');assert.equal(j.text,undefined);f.mock.restore();
  }
});
test('accepts natural completion and rejects blank completed output',async t=>{
  const f=t.mock.method(globalThis,'fetch',async()=>reply());
  let r=await worker.fetch(request(basic),env);assert.equal((await r.json()).tokens,12);
  f.mock.mockImplementation(async()=>reply('stop','   '));r=await worker.fetch(request(basic),env);
  assert.equal((await r.json()).error,'EMPTY:deepseek');
});
test('preflight supports preview origin without adding settings',async()=>{
  const r=await worker.fetch(new Request('https://example.test/',{method:'OPTIONS',headers:{Origin:'http://terminal.local:4173'}}),env);
  assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');
});
test('wrong password and malformed payload never contact provider',async t=>{
  const f=t.mock.method(globalThis,'fetch',async()=>{throw Error('must not call');});
  assert.equal((await worker.fetch(request(basic,{'X-Proxy-Token':'wrong'}),env)).status,401);
  assert.equal((await worker.fetch(request(null),env)).status,400);
  assert.equal((await worker.fetch(request({...basic,provider:'constructor'}),env)).status,400);
  assert.equal(f.mock.callCount(),0);
});
test('provider errors do not expose credentials or arbitrary payloads',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw Error('private test-key details');});
  const r=await worker.fetch(request(basic),env);assert.deepEqual(await r.json(),{error:'UPSTREAM:deepseek'});
});
test('heartbeat responds before generation finishes and returns complete JSON',async t=>{
  let finish;
  t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{finish=resolve;}));
  const r=await worker.fetch(request({...basic,keepalive:true}),env);
  const reader=r.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value),'\n');
  await Promise.resolve();finish(reply());
  let raw='';for(;;){const x=await reader.read();if(x.done)break;raw+=new TextDecoder().decode(x.value);}
  assert.equal(JSON.parse(raw).complete,true);
});
test('heartbeat never converts incomplete provider output into success',async t=>{
  t.mock.method(globalThis,'fetch',async()=>reply('length','partial'));
  const r=await worker.fetch(request({...basic,keepalive:true}),env);
  assert.deepEqual(await r.json(),{error:'INCOMPLETE:deepseek'});
});
test('client cancellation aborts upstream without retry',async t=>{
  let signal;
  const f=t.mock.method(globalThis,'fetch',async (url,opts)=>{signal=opts.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));});
  const r=await worker.fetch(request({...basic,keepalive:true}),env);
  const reader=r.body.getReader();await reader.read();await reader.cancel();
  assert.equal(signal.aborted,true);assert.equal(f.mock.callCount(),1);
});
