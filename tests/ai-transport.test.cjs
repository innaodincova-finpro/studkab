const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('reestr.html','utf8');
const code=html.slice(html.indexOf('function askAI('),html.indexOf('function aiErrorText('));
function app(fetch,timers={}){
 const D={settings:{proxyUrl:'https://example.test',proxyToken:'secret-password',providers:{deepseek:{model:'deepseek-chat'}}}};
 const c={D,crypto:require("node:crypto").webcrypto,fetch,AbortController,setTimeout,clearTimeout,save:()=>true,...timers};vm.createContext(c);vm.runInContext(code,c);return c;
}
test('network failure is diagnosed without secrets or retry',async()=>{
 let calls=0;const c=app(async()=>{calls++;throw TypeError('Failed to fetch');});
 await assert.rejects(c.askAI('deepseek','private source','private student'),/NETWORK:connect:/);
 assert.equal(calls,1);assert.equal(c.D.aiDiagnostics[0].phase,'connect');
 assert.doesNotMatch(JSON.stringify(c.D.aiDiagnostics),/secret|private|example/);
});
test('interrupted response body is distinguished from failure before headers',async()=>{
 const c=app(async()=>({status:200,ok:true,json:async()=>{throw TypeError('Load failed');}}));
 await assert.rejects(c.askAI('deepseek','s','u'),/NETWORK:body:/);assert.equal(c.D.aiDiagnostics[0].status,200);
});
test('bounded timeout cancels one request and clears timer',async()=>{
 let expire,cleared=false;const c=app(async (url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'})))),{setTimeout:fn=>{expire=fn;return 1;},clearTimeout:()=>{cleared=true;}});
 const pending=c.askAI('deepseek','s','u');await Promise.resolve();expire();
 await assert.rejects(pending,/CLIENT_TIMEOUT:/);assert.equal(cleared,true);
});
test('heartbeat JSON remains compatible; incomplete output remains an error',async()=>{
 let body;const c=app(async (url,opts)=>{body=JSON.parse(opts.body);return new Response('\n\n'+JSON.stringify({text:'ok',complete:true}));});
 assert.equal((await c.askAI('deepseek','s','u')).text,'ok');assert.equal(body.keepalive,true);
 const bad=app(async()=>Response.json({error:'INCOMPLETE:deepseek'}));await assert.rejects(bad.askAI('deepseek','s','u'),/INCOMPLETE/);
});
test('HTTP failure retains section, stage, reason and unique request identity',async()=>{
 let sent;const c=app(async(url,o)=>{sent=JSON.parse(o.body);return Response.json({error:'INCOMPLETE:deepseek',detail:{reason:'length',completion_tokens:8000,limit_tokens:8000}},{status:502});});
 await assert.rejects(c.askAI('deepseek','private','private',{section:'ch2',stage:'revision',attempt:2}));
 const r=c.D.aiDiagnostics[0];assert.equal(r.section,'ch2');assert.equal(r.stage,'revision');assert.equal(r.attempt,2);assert.equal(r.reason,'length');assert.equal(r.status,502);assert.equal(r.client_request_id,sent.client_request_id);
 await assert.rejects(c.askAI('deepseek','private','private'));assert.notEqual(r.client_request_id,c.D.aiDiagnostics[1].client_request_id);
});
test('actual generation call sites supply section and stage',()=>{
 assert.match(html,/askAI\(prov, pr.system, pr.user, \{section:cid,stage:'draft',attempt:1\}\)/);
 assert.match(html,/askAI\(prov,pr.system,edit,\{section:cid,stage:'revision',attempt:1\}\)/);
});
test('real worker late failure reaches client journal through heartbeat',async()=>{
 const worker=(await import('../worker/ai-proxy.mjs')).default;const old=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({id:'req-123',choices:[{finish_reason:'length',message:{content:'private'}}],usage:{prompt_tokens:20,completion_tokens:8000}});
 try{
 const c=app(async(url,o)=>worker.fetch(new Request(url,o),{PROXY_TOKEN:'secret-password',DEEPSEEK_KEY:'private',RATE_MAX:1000}));
 await assert.rejects(c.askAI('deepseek','private','private',{section:'ch2',stage:'draft',attempt:1}),/INCOMPLETE/);
 const r=c.D.aiDiagnostics[0];assert.equal(r.status,200);assert.equal(r.reason,'length');assert.equal(r.section,'ch2');assert.equal(r.request_id,'req-123');assert.doesNotMatch(JSON.stringify(r),/private|secret-password/);
 }finally{globalThis.fetch=old;}
});
