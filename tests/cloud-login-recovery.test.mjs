import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createClient} from '@supabase/supabase-js';
const source=readFileSync(new URL('../oblako.js',import.meta.url),'utf8');
const user={id:'synthetic-user',email:'synthetic@example.test'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function screen(options={}){
 let config,authEvent,realClient;const writes=deferred(),timers=new Set();let signins=0;
 const auth={onAuthStateChange(fn){authEvent=fn;},async getSession(){return {data:{session:options.session?{user}:null}};},async signInWithPassword(){signins++;if(options.network)await config.global.fetch('https://example.test/auth/v1/token',{method:'POST'});return {data:{user}};}};
 const window={addEventListener(){},document:{addEventListener(){}},OBLAKO_CONFIG:{url:'https://example.test',key:'synthetic'},location:{href:'https://example.test/'},localStorage:{getItem(){return null;},setItem(){}},fetch:options.fetch||(()=>Promise.resolve({ok:true})),supabase:{createClient(_url,_key,o){config=o;if(options.realClient){realClient=createClient(_url,_key,{...o,auth:{...o.auth,persistSession:false,autoRefreshToken:false}});return realClient;}return {auth,rpc:()=>writes.promise};}}};
 vm.runInNewContext(source,{window,URL,AbortController,setTimeout(fn,ms){const timer=setTimeout(()=>{timers.delete(timer);fn();},ms===30000?20:ms);timers.add(timer);return timer;},clearTimeout(timer){timers.delete(timer);clearTimeout(timer);}});
 return {api:window.Oblako,writes,timers,stop:()=>realClient?.auth.stopAutoRefresh(),signins:()=>signins,fetch:(...args)=>config.global.fetch(...args),event:(...args)=>authEvent(...args),init:()=>window.Oblako.init({app:'kabinet',switchUser:options.switchUser,onAccountChange:options.onAccountChange,onChange(){}})};
}
const hangingFetch=(_url,{signal})=>new Promise((_resolve,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
test('sign-out during write releases busy and allows a fresh login without using stale revision',async()=>{
 const identities=[];const s=screen({session:true,switchUser:id=>identities.push(id)});await s.init();s.api.accept({rows:[]});const writing=s.api.push({rows:['synthetic']});assert.equal(s.api.busy,true);
 s.event('SIGNED_OUT',null);assert.equal(s.api.mode,'local');s.writes.resolve({data:{ok:true,rev:99}});assert.equal((await writing).status,'stale');assert.equal(s.api.busy,false);assert.equal(s.api.hasPending(),false);assert.equal(s.api.rev,0);
 await s.api.signInPassword(user.email,'synthetic-password');assert.equal(s.signins(),1);assert.equal(s.api.mode,'cloud');assert.deepEqual(identities,[user.id,'',user.id]);
});
test('aborting the actual stalled login releases busy and permits retry',async()=>{
 let calls=0,aborted=false;const s=screen({network:true,fetch:(url,init)=>{calls++;if(calls===1){init.signal.addEventListener('abort',()=>{aborted=true;});return hangingFetch(url,init);}return Promise.resolve({ok:true});}});await s.init();
 await assert.rejects(s.api.signInPassword(user.email,'synthetic-password'),/не ответил вовремя/);assert.equal(aborted,true);assert.equal(s.api.busy,false);assert.equal(s.api.mode,'local');assert.equal(s.timers.size,0);
 await s.api.signInPassword(user.email,'synthetic-password');assert.equal(s.api.mode,'cloud');assert.equal(calls,2);assert.equal(s.timers.size,0);
});
test('successful login completes while reconciliation waits for a version choice',async()=>{
 const choice=deferred(),called=deferred();const s=screen({onAccountChange(){called.resolve();return choice.promise;}});await s.init();
 assert.equal(await s.api.signInPassword(user.email,'synthetic-password'),true);await called.promise;assert.equal(s.api.mode,'cloud');assert.equal(s.api.busy,false);assert.equal(s.api.canSync(),false);choice.resolve();
});
test('reconciliation failure is a sync error and never reclassifies successful login',async()=>{
 const s=screen({onAccountChange(){throw new Error('Synthetic sync unavailable');}});await s.init();assert.equal(await s.api.signInPassword(user.email,'synthetic-password'),true);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(s.api.mode,'cloud');assert.equal(s.api.lastError,'Synthetic sync unavailable');assert.equal(s.api.canSync(),false);
});
test('caller cancellation is forwarded and timeout listeners are cleaned',async()=>{
 const s=screen({fetch:hangingFetch});await s.init();const controller=new AbortController();const request=s.fetch('https://example.test/rest',{signal:controller.signal});controller.abort();await assert.rejects(request,{name:'AbortError'});assert.equal(s.timers.size,0);
});
test('an already aborted Request remains aborted',async()=>{
 const s=screen({fetch:hangingFetch});await s.init();const controller=new AbortController();controller.abort();const request=new Request('https://example.test/rest',{signal:controller.signal});await assert.rejects(s.fetch(request),{name:'AbortError'});assert.equal(s.timers.size,0);
});
test('completed and synchronously failed requests clear timers',async()=>{
 const s=screen();await s.init();await s.fetch('https://example.test/rest');assert.equal(s.timers.size,0);
 const broken=screen({fetch(){throw new TypeError('Synthetic network failure');}});await broken.init();await assert.rejects(broken.fetch('https://example.test/rest'),TypeError);assert.equal(broken.timers.size,0);
});

test('pinned Supabase client receives the abort and a subsequent password login succeeds',async()=>{
 let requests=0;const s=screen({realClient:true,fetch:(url,init)=>{
  assert.match(String(url),/grant_type=password/);requests++;
  if(requests===1)return hangingFetch(url,init);
  return Promise.resolve(new Response(JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,user}),{status:200,headers:{'content-type':'application/json'}}));
 }});
 try{await s.init();await assert.rejects(s.api.signInPassword(user.email,'synthetic-password'),/не ответил вовремя/);assert.equal(s.api.busy,false);assert.equal(s.api.mode,'local');assert.equal(await s.api.signInPassword(user.email,'synthetic-password'),true);assert.equal(s.api.mode,'cloud');assert.equal(requests,2);}finally{s.stop();}
});
