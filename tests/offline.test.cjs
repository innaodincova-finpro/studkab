const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const base='https://example.test/studkab/';
test('both entry pages and offline shell use the AI criterion assistance scripts',()=>{
 for(const page of ['index.html','reestr.html'])
  assert.match(fs.readFileSync(page,'utf8'),/quality-evidence-ui\.js\?v=7.*results-ui\.js\?v=23/);
 const shell=fs.readFileSync('sw.js','utf8');
 assert.match(shell,/studkab-v101-word-inspection/);
 assert.match(shell,/quality-evidence-ui\.js\?v=7/);
});
function worker(fetch){
 const handlers={},entries=new Map(),pending=[];
 const key=x=>new URL(typeof x==='string'?x:x.url,base).href;
 const cache={match:async x=>entries.get(key(x))?.clone(),put:async(x,r)=>entries.set(key(x),r)};
 const caches={open:async()=>cache,match:cache.match};
 vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{URL,Response,fetch,caches,self:{location:{origin:new URL(base).origin},registration:{scope:base},addEventListener:(n,f)=>handlers[n]=f}});
 return {entries,async page(path){let result;handlers.fetch({request:{url:new URL(path,base).href,method:'GET',mode:'navigate',headers:new Headers({accept:'text/html'})},respondWith:p=>result=p,waitUntil:p=>pending.push(p)});const response=await result;await Promise.all(pending);return response;}};
}
test('server error cannot replace a usable offline page',async()=>{
 const w=worker(async()=>new Response('maintenance',{status:503}));
 w.entries.set(base+'reestr.html',new Response('registry'));
 const r=await w.page('reestr.html');
 assert.equal(await r.text(),'registry');
 assert.equal(await w.entries.get(base+'reestr.html').clone().text(),'registry');
});
test('offline registry query opens registry, never cabinet',async()=>{
 const w=worker(async()=>{throw Error('offline')});
 w.entries.set(base+'index.html',new Response('cabinet'));
 w.entries.set(base+'reestr.html',new Response('registry'));
 assert.equal(await (await w.page('reestr.html?source=shortcut')).text(),'registry');
});
test('unknown offline page does not impersonate cabinet',async()=>{
 const w=worker(async()=>{throw Error('offline')});
 w.entries.set(base+'index.html',new Response('cabinet'));
 assert.equal((await w.page('activate.html')).status,503);
});
test('successful navigation refreshes its own offline copy',async()=>{
 const w=worker(async()=>new Response('new registry'));
 assert.equal(await (await w.page('reestr.html')).text(),'new registry');
 assert.equal(await w.entries.get(base+'reestr.html').clone().text(),'new registry');
});

test('a failed required asset keeps the previous offline worker active',async()=>{
 const handlers={},deleted=[],cached=new Map(),old='studkab-v95-ai-report-registry';
 let activated=0,install;
 const self={location:{origin:new URL(base).origin},registration:{scope:base},
  skipWaiting:()=>{activated++;},clients:{claim:async()=>{}},addEventListener:(name,fn)=>handlers[name]=fn};
 const caches={open:async name=>({add:async url=>{const res=await fetch(url);if(!res.ok)throw Error('resource unavailable');cached.set(name+':'+url,res);}}),
  keys:async()=>[old,'studkab-v98-ai-criteria'],delete:async key=>{deleted.push(key);return true;}};
 const fetch=async url=>new Response('asset',{status:url.includes('results-ui.js')?503:200});
 vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{URL,Response,fetch,caches,self});
 handlers.install({waitUntil:p=>{install=p;}});
 await assert.rejects(install,/resource unavailable/);
 assert.equal(activated,0);
 assert.deepEqual(deleted,[]);
 assert.ok(!cached.has('studkab-v98-ai-criteria:./results-ui.js?v=23'));
});

test('push opens only a same-origin application URL and rejects foreign targets',async()=>{
 const handlers={},shown=[],opened=[],navigated=[];
 const existing={url:base+'index.html',navigate:async url=>{navigated.push(url);existing.url=url},focus:async()=>{}};
 const self={
  location:{origin:new URL(base).origin},
  registration:{scope:base,showNotification:async(title,options)=>shown.push({title,options})},
  clients:{matchAll:async()=>[existing],openWindow:async url=>opened.push(url)},
  addEventListener:(name,fn)=>handlers[name]=fn
 };
 vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{URL,Response,fetch:async()=>new Response('ok'),caches:{open:async()=>({addAll:async()=>{},match:async()=>null,put:async()=>{}}),keys:async()=>[],delete:async()=>{}},self});
 let done;handlers.push({data:{json:()=>({body:'Готово',url:'index.html#request=42',expiresAt:Date.now()+60000})},waitUntil:p=>done=p});await done;
 assert.equal(shown[0].options.data.url,base+'index.html#request=42');
 handlers.notificationclick({notification:{data:shown[0].options.data,close(){}},waitUntil:p=>done=p});await done;
 assert.deepEqual(navigated,[base+'index.html#request=42']);assert.deepEqual(opened,[]);
 handlers.push({data:{json:()=>({url:'https://evil.test/phishing',expiresAt:Date.now()+60000})},waitUntil:p=>done=p});await done;
 assert.equal(shown[1].options.data.url,base);
});
