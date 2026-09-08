const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const base='https://example.test/studkab/';
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
