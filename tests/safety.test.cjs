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
 c.supabase={createClient:()=>({auth:{onAuthStateChange(fn){c.authEvent=fn},getSession:async()=>({data:{session:{user:c.user}}}),signOut:async()=>c.logout||{},signInWithPassword:async args=>{c.passwordArgs=args;return c.passwordResult||{data:{user:c.user}}},updateUser:async args=>{c.passwordUpdate=args;if(c.passwordThrow)throw c.passwordThrow;return c.passwordResponse||{data:{user:c.user}}},signInWithOAuth:async args=>{c.oauth=args;return c.oauthResult||{}},verifyOtp:async()=>({data:{user:c.user}})},from:()=>q,rpc:(name,args)=>{c.calls.push({name,args});return Promise.resolve(c.nextWrite)}})};
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
 test(f+': account A data survives signout but is not visible in account B',()=>{let map=new Map([['base',JSON.stringify({items:[{id:'private'}]})]]);let c={KEY:'base',CLOUD_LOCAL_KEY:'base',D:null,Oblako:{snapshot:x=>JSON.stringify(x)},cloudHasLocal:()=>false,cloudIsEmpty:x=>!x?.items?.length,localStorage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},load(){c.D=JSON.parse(map.get(c.KEY)||'{"items":[]}')},render(){}};vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function cloudSwitchUser('),html.indexOf('function cloudInit(')),c);c.cloudSwitchUser('a');assert.equal(c.D.items[0].id,'private');c.cloudSwitchUser('');assert.equal(c.D.items.length,0);c.cloudSwitchUser('b');assert.equal(c.D.items.length,0);c.cloudSwitchUser('a');assert.equal(c.D.items[0].id,'private')});
}
test('service worker removes only its own obsolete caches',async()=>{let handlers={},deleted=[];const c={self:{addEventListener:(n,f)=>handlers[n]=f,clients:{claim:async()=>{}}},caches:{keys:async()=>['studkab-v3','studkab-v7','studkab-v8','studkab-v9','studkab-v10','studkab-v11','studkab-v12','studkab-v13','studkab-v14','studkab-v15','studkab-v16','studkab-v17','studkab-v18','studkab-v19','studkab-v20','studkab-v21','studkab-v22','other-v1'],delete:async k=>deleted.push(k)}};vm.runInNewContext(read('sw.js'),c);let done;handlers.activate({waitUntil:p=>done=p});await done;assert.deepEqual(deleted,['studkab-v3','studkab-v7','studkab-v8','studkab-v9','studkab-v10','studkab-v11','studkab-v12','studkab-v13','studkab-v14','studkab-v15','studkab-v16','studkab-v17','studkab-v18','studkab-v19','studkab-v20','studkab-v21'])});
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

test('reading cloud data never reports a write timestamp',async()=>{const c=await cloud();c.nextRead={data:{rev:2,data:{items:[]}}};await c.Oblako.pull();c.Oblako.accept();assert.equal(c.Oblako.lastSaved,null);assert.ok(c.Oblako.lastLoaded);assert.match(c.Oblako.statusText(),/загружены/);await c.Oblako.push({items:[]});assert.match(c.Oblako.statusText(),/сохранены/);});
test('per-account baseline changes only on accepted data or successful writes',async()=>{const c=await cloud(),data=new Map();c.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};await c.Oblako.pull();c.Oblako.accept({items:[]});const original=c.Oblako.baseline();c.nextRead={data:{rev:2,data:{items:[{id:'remote'}]}}};await c.Oblako.pull();assert.equal(c.Oblako.baseline(),original);c.Oblako.accept();c.nextWrite={error:{message:'NetworkError'}};await c.Oblako.push({items:[{id:'unsent'}]});assert.equal(c.Oblako.baseline(),original);});

test('password failures explain service rejection without leaking raw details or changing data',async()=>{
 const c=await cloud();
 for(const [code,pattern] of [['same_password',/уже установлен/],['weak_password',/недостаточно/],['reauthentication_needed',/подтвердить вход/],['unexpected_failure',/unexpected_failure/]]){
  c.passwordResponse={error:{code,status:422,message:'secret server details'}};
  await assert.rejects(c.Oblako.setPassword('test-only-password'),e=>pattern.test(e.message)&&!e.message.includes('secret'));
  assert.equal(c.Oblako.busy,false);assert.equal(c.calls.length,0);
 }
 c.passwordResponse={data:{user:c.user}};await c.Oblako.setPassword('test-only-password');assert.equal(c.Oblako.busy,false);
 c.passwordThrow={name:'AuthRetryableFetchError'};await assert.rejects(c.Oblako.setPassword('test-only-password'),/интернет/);assert.equal(c.Oblako.busy,false);
});

test('password update rejects missing acknowledgement and a session from another account',async()=>{
 const c=await cloud();c.passwordResponse={};
 await assert.rejects(c.Oblako.setPassword('test-only-password'),/не подтвердил/);
 c.passwordUpdate=null;c.user={id:'another',email:'other@test'};
 await assert.rejects(c.Oblako.setPassword('test-only-password'),/Сеанс/);
 assert.equal(c.passwordUpdate,null);assert.equal(c.Oblako.busy,false);
});
