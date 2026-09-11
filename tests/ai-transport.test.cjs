const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('reestr.html','utf8');
const code=html.slice(html.indexOf('function askAI('),html.indexOf('function aiErrorText('));
function app(fetch,timers={}){
 const D={settings:{proxyUrl:'https://example.test',proxyToken:'secret-password',providers:{deepseek:{model:'deepseek-chat'}}}};
 const c={D,fetch,AbortController,setTimeout,clearTimeout,save:()=>true,...timers};vm.createContext(c);vm.runInContext(code,c);return c;
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
