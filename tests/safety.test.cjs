const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
async function cloud(){
 const c={console,Promise,Date,Number,JSON, timers:new Map(),calls:[],nextRead:{data:null},nextWrite:{data:{ok:true,rev:1}},user:{id:'a',email:'a@test'},changes:[]};
 c.setTimeout=fn=>{let key={};c.timers.set(key,fn);return key};c.clearTimeout=k=>c.timers.delete(k);c.addEventListener=()=>{};c.window=c;
 c.OBLAKO_CONFIG={url:'test',key:'public'};
 const q={select(){return this},eq(){return this},maybeSingle(){return Promise.resolve(c.nextRead)}};
 c.supabase={createClient:()=>({auth:{onAuthStateChange(fn){c.authEvent=fn},getSession:async()=>({data:{session:{user:c.user}}}),signOut:async()=>c.logout||{},signInWithPassword:async args=>{c.passwordArgs=args;return c.passwordResult||{data:{user:c.user}}},updateUser:async args=>{c.passwordUpdate=args;return {}},signInWithOAuth:async args=>{c.oauth=args;return c.oauthResult||{}},verifyOtp:async()=>({data:{user:c.user}})},from:()=>q,rpc:(name,args)=>{c.calls.push({name,args});return Promise.resolve(c.nextWrite)}})};
 vm.createContext(c);vm.runInContext(read('oblako.js'),c);
 await c.Oblako.init({app:'reestr',getData:()=>({items:[]}),switchUser:id=>c.changes.push(id)});
 return c;
}
test('failed initial read cannot cause any cloud write, including forced',async()=>{let c=await cloud();c.nextRead={error:{message:'NetworkError'}};await c.Oblako.pull();assert.equal((await c.Oblako.push({},true)).status,'blocked');assert.equal(c.calls.length,0)});
test('read alone does not authorize overwrite',async()=>{let c=await cloud();await c.Oblako.pull();assert.equal((await c.Oblako.push({})).status,'blocked')});
test('new row uses v2 and rev 0, secrets removed without mutating local data',async()=>{let c=await cloud();await c.Oblako.pull();c.Oblako.accept();let data={settings:{proxyToken:'secret',dsKey:'old',name:'kept'}};assert.equal((await c.Oblako.push(data)).status,'ok');assert.equal(c.calls[0].name,'save_app_data_v2');assert.equal(c.calls[0].args.p_rev,0);assert.equal(c.calls[0].args.p_data.settings.proxyToken,undefined);assert.equal(data.settings.proxyToken,'secret')});
test('conflict blocks future automatic save and keeps original revision',async()=>{let c=await cloud();c.nextRead={data:{rev:4,data:{}}};await c.Oblako.pull();c.Oblako.accept();c.nextWrite={data:{conflict:true,rev:5}};assert.equal((await c.Oblako.push({})).status,'conflict');assert.equal(c.Oblako.rev,4);assert.equal((await c.Oblako.push({})).status,'blocked');c.nextWrite={data:{ok:true,rev:6}};await c.Oblako.push({},true);assert.equal(c.calls[1].args.p_rev,5)});
test('failed or malformed acknowledgement is not success',async()=>{for(const response of [{error:{message:'denied'}},{data:{ok:false,rev:2}},{data:null}]){let c=await cloud();await c.Oblako.pull();c.Oblako.accept();c.nextWrite=response;assert.equal((await c.Oblako.push({})).status,'error');assert.equal(c.Oblako.rev,0)}});
test('overlapping writes are not sent concurrently',async()=>{let c=await cloud();await c.Oblako.pull();c.Oblako.accept();let finish;c.nextWrite=new Promise(r=>finish=r);let p=c.Oblako.push({});assert.equal((await c.Oblako.push({})).status,'busy');assert.equal(c.calls.length,1);finish({data:{ok:true,rev:1}});await p});
test('sign out clears pending writes and switches storage; failed logout is surfaced',async()=>{let c=await cloud();await c.Oblako.pull();c.Oblako.accept();c.Oblako.touch();await c.Oblako.signOut();assert.equal(c.timers.size,0);assert.equal(c.changes.at(-1),'');assert.equal((await c.Oblako.push({})).status,'offline');c=await cloud();c.logout={error:new Error('logout failed')};await assert.rejects(c.Oblako.signOut(),/logout failed/)});
for(const f of ['index.html','reestr.html']){
 const html=read(f);
 test(f+': all inline scripts parse',()=>{for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);});
 test(f+': rejects malicious identifiers and prototype keys',()=>{const src=html.slice(html.indexOf('function checkSafeIds('),html.indexOf('function checkBackup('));const c=vm.createContext({});vm.runInContext(src,c);assert.equal(c.checkSafeIds({items:[{id:'item-123',text:'<b>text</b>'}]},0),null);assert.ok(c.checkSafeIds({items:[{id:'"><img src=x onerror=alert(1)>'}]},0));assert.ok(c.checkSafeIds(JSON.parse('{"__proto__":{}}'),0));});
 function ui(){const c={D:{items:[],works:[],settings:{}},cloudPaint(){},checkBackup:()=>null,confirm:()=>true,toasts:[],toast(t){this.toasts.push(t)},cloudHasLocal:()=>false};c.toast=t=>c.toasts.push(t);c.Oblako={push:async()=>({status:'error',error:'denied'}),pull:async()=>({status:'loaded',remote:{items:[],refs:[{id:'r1'}],settings:{name:'kept'}}}),accept(){},pause(){}};vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function cloudSave('),html.indexOf('function cloudPaint(')),c);return c;}
 test(f+': save failure never shows success toast',async()=>{let c=ui();await c.cloudSave('SUCCESS');assert.deepEqual(c.toasts,['denied'])});
 test(f+': existing empty lists with settings load without cloud overwrite',async()=>{let c=ui(),applied,pushes=0;c.cloudApply=data=>{applied=data;return true};c.Oblako.push=async()=>{pushes++;return {status:'ok'}};await c.cloudFirstPull();assert.equal(pushes,0);assert.equal(applied.settings.name,'kept')});
 test(f+': cancel both dialogs leaves cloud untouched',async()=>{let c=ui(),pushes=0;c.cloudHasLocal=()=>true;c.confirm=()=>false;c.Oblako.push=async()=>{pushes++};await c.cloudFirstPull();assert.equal(pushes,0)});
 test(f+': account A data survives signout but is not visible in account B',()=>{let map=new Map([['base',JSON.stringify({items:[{id:'private'}]})]]);let c={KEY:'base',CLOUD_LOCAL_KEY:'base',D:null,cloudHasLocal:()=>false,localStorage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},load(){c.D=JSON.parse(map.get(c.KEY)||'{"items":[]}')},render(){}};vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function cloudSwitchUser('),html.indexOf('function cloudInit(')),c);c.cloudSwitchUser('a');assert.equal(c.D.items[0].id,'private');c.cloudSwitchUser('');assert.equal(c.D.items.length,0);c.cloudSwitchUser('b');assert.equal(c.D.items.length,0);c.cloudSwitchUser('a');assert.equal(c.D.items[0].id,'private')});
}
test('service worker removes only its own obsolete caches',async()=>{let handlers={},deleted=[];const c={self:{addEventListener:(n,f)=>handlers[n]=f,clients:{claim:async()=>{}}},caches:{keys:async()=>['studkab-v3','studkab-v7','studkab-v8','other-v1'],delete:async k=>deleted.push(k)}};vm.runInNewContext(read('sw.js'),c);let done;handlers.activate({waitUntil:p=>done=p});await done;assert.deepEqual(deleted,['studkab-v3','studkab-v7'])});
test('SIGNED_IN after logout switches storage before allowing cloud writes',async()=>{
 const c=await cloud();await c.Oblako.signOut();c.authEvent('SIGNED_IN',{user:{id:'b',email:'b@test'}});
 for(const fn of [...c.timers.values()])fn();
 assert.equal(c.changes.at(-1),'b');assert.equal((await c.Oblako.push({})).status,'blocked');
});

test('Google login returns to the correct app and does not write data',async()=>{
 for(const app of ['kabinet','reestr']){
  const c=await cloud();c.URL=URL;c.location={href:'https://example.test/studkab/index.html?x=1#home'};c.Oblako.app=app;
  await c.Oblako.signInGoogle();
  assert.equal(c.oauth.provider,'google');
  assert.equal(c.oauth.options.redirectTo,'https://example.test/studkab/'+(app==='reestr'?'reestr.html':''));
  assert.equal(c.calls.length,0);
  c.oauthResult={error:{message:'Provider unavailable'}};
  await assert.rejects(c.Oblako.signInGoogle());assert.equal(c.Oblako.busy,false);
 }
});

test('password login switches identity without authorizing an overwrite; failures release busy',async()=>{
 const c=await cloud();await c.Oblako.pull();c.Oblako.accept();
 c.passwordResult={data:{user:{id:'b',email:'b@test'}}};
 await c.Oblako.signInPassword(' B@test ','password123');
 assert.equal(c.Oblako.email,'b@test');assert.equal(c.changes.at(-1),'b');assert.equal(c.Oblako.busy,false);
 assert.equal((await c.Oblako.push({})).status,'blocked');assert.equal(c.calls.length,0);
 c.passwordResult={error:{message:'bad'}};await assert.rejects(c.Oblako.signInPassword('b@test','wrong'));
 assert.equal(c.Oblako.busy,false);assert.equal(c.changes.at(-1),'b');
});
