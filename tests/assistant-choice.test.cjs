const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('reestr.html','utf8');
function fixture(){
 const x={id:'request',r3:{result:{hash:'old'}},attachments:[{id:'original'}],claude:{startedAt:'confirmed'}};
 let identity='one',saved=true,renders=0;const calls=[];
 const c={Map,Promise,KEY:'owner',D:{items:[x]},esc:String,item:id=>id===x.id?x:null,save:()=>saved,render:()=>renders++,toast:()=>{},r3ActionKey:q=>c.KEY+'|'+identity+'|'+q.id,Oblako:{identity:()=>identity,generationApi:async d=>{calls.push(d);return {enabled:true,budgetAvailable:true};}}};
 vm.createContext(c);vm.runInContext(html.slice(html.indexOf('var r3AssistantChecks='),html.indexOf('function r3Card(')),c);
 return {c,x,calls,owner:()=>identity='other',failSave:()=>saved=false,renders:()=>renders};
}
test('switching assistant only saves the choice and preserves active Claude, original files and results',()=>{
 const f=fixture(),before=JSON.stringify(f.x);f.c.selectR3Assistant(f.x,'chatgpt');f.c.selectR3Assistant(f.x,'deepseek');
 assert.equal(f.x.preparationMethod,'deepseek');delete f.x.preparationMethod;assert.equal(JSON.stringify(f.x),before);assert.equal(f.calls.length,0);
 f.c.selectR3Assistant(f.x,'unsupported');assert.equal(f.x.preparationMethod,undefined);
 f.failSave();f.c.selectR3Assistant(f.x,'chatgpt');assert.equal(f.x.preparationMethod,undefined);
});
test('DeepSeek check is read-only, double-click guarded and no availability survives an error',async()=>{
 const f=fixture();let resolve;f.c.Oblako.generationApi=d=>{f.calls.push(d);return new Promise(r=>resolve=r);};
 const pending=f.c.checkR3Deepseek(f.x);await f.c.checkR3Deepseek(f.x);assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'capabilities');
 resolve({enabled:true,budgetAvailable:true});await pending;assert.equal(f.c.r3AssistantChecks.get(f.c.r3ActionKey(f.x)).available,true);
 f.c.Oblako.generationApi=async()=>{throw Error('network');};await f.c.checkR3Deepseek(f.x);assert.equal(f.c.r3AssistantChecks.get(f.c.r3ActionKey(f.x)).available,false);
});
test('capability reply for a departed owner never enables the new account or rerenders it',async()=>{
 const f=fixture();let resolve;f.c.Oblako.generationApi=()=>new Promise(r=>resolve=r);const pending=f.c.checkR3Deepseek(f.x),before=f.renders();f.owner();resolve({enabled:true,budgetAvailable:true});await pending;
 assert.equal(f.renders(),before);assert.equal(f.c.r3AssistantChecks.get(f.c.r3ActionKey(f.x)),undefined);
});
test('manual chat keeps existing requirement blockers before copying or opening an external window',()=>{
 const f=fixture();let copied=0,opened=0,modal='';f.c.preparationBlockers=()=>['ИИ запрещён'];f.c.copyText=()=>copied++;f.c.window={open:()=>opened++};f.c.openModal=h=>modal=h;
 f.c.openR3Chatgpt(f.x);assert.match(modal,/ИИ запрещён/);assert.equal(copied,0);assert.equal(opened,0);assert.equal(f.calls.length,0);
});
test('approved manual chat copies a prompt and opens chat without queueing work or transferring files',async()=>{
 const f=fixture();let copied='',opened='',modal='',status={textContent:''};const before=JSON.stringify(f.x);
 f.c.preparationBlockers=()=>[];f.c.buildChatgptPrompt=()=> 'Verified request';f.c.copyText=async text=>{copied=text;return true;};f.c.window={open:url=>{opened=url;}};f.c.openModal=h=>{modal=h;return {isConnected:true,querySelector:()=>status,addEventListener:()=>{}};};
 f.c.openR3Chatgpt(f.x);await Promise.resolve();await Promise.resolve();
 assert.equal(copied,'Verified request');assert.equal(opened,'https://chatgpt.com/');assert.match(modal,/readonly/);assert.match(modal,/приложите скачанные материалы вручную/);assert.match(status.textContent,/Запрос скопирован/);assert.equal(f.calls.length,0);assert.equal(JSON.stringify(f.x),before);
});

for(const [provider,url] of [['claude','https://claude.ai/'],['chatgpt','https://chatgpt.com/'],['deepseek','https://chat.deepseek.com/']])test(provider+' manual route needs no connection or API request and preserves the existing result',async()=>{
 const f=fixture();let opened='',modal='',status={textContent:''};const before=JSON.stringify(f.x);
 f.c.preparationBlockers=()=>[];f.c.buildChatgptPrompt=()=> 'Verified request';f.c.copyText=async()=>true;f.c.window={open:u=>opened=u};f.c.openModal=h=>{modal=h;return {isConnected:true,querySelector:()=>status,addEventListener:()=>{}};};
 f.c.openR3Chat(f.x,provider);await Promise.resolve();await Promise.resolve();
 assert.equal(opened,url);assert.match(modal,/data-chat-bundle/);assert.match(modal,/data-r3-result-file="request"/);assert.match(modal,/не отправляет документы в чат/);assert.equal(f.calls.length,0);assert.equal(JSON.stringify(f.x),before);
});
test('every manual provider obeys the same preparation blockers and unknown providers cannot open a URL',()=>{
 const f=fixture();let opened=0,copied=0;f.c.window={open:()=>opened++};f.c.copyText=()=>copied++;f.c.openModal=()=>{};f.c.preparationBlockers=()=>['ИИ запрещён'];
 for(const p of ['claude','chatgpt','deepseek','unsupported','__proto__'])f.c.openR3Chat(f.x,p);
 assert.equal(opened,0);assert.equal(copied,0);assert.equal(f.calls.length,0);
});

function bundleFixture(){
 const f=fixture();let entries=null,downloads=0;Object.assign(f.c,{TextEncoder,Uint8Array,Blob,crypto:require('node:crypto').webcrypto,setTimeout:()=>{},URL:{createObjectURL:()=> 'blob:local',revokeObjectURL:()=>{}},document:{createElement:()=>({click:()=>downloads++})},preparationBlockers:()=>[],buildChatgptPrompt:()=> 'Verified structure and request',r3TitleText:()=> 'Student title',ruDate:String,fetch:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})});
 f.x.attachments=[{id:'original',file_name:'Методичка.docx',size_bytes:3,file_hash:require('node:crypto').createHash('sha256').update(Buffer.from([1,2,3])).digest('hex')}];f.c.Oblako.requestApi=async d=>{f.calls.push(d);return {url:'https://example.invalid/file'};};
 vm.runInContext(html.slice(html.indexOf('var R3_CRC='),html.indexOf('var R3_ROWS=')),f.c);f.c.r3Zip=e=>{entries=e;return new Blob([]);};return {...f,entries:()=>entries,downloads:()=>downloads};
}
for(const p of ['claude','chatgpt','deepseek'])test(p+' export contains original materials and verified prompt without inference',async()=>{
 const f=bundleFixture();await f.c.r3Bundle(f.x,p);assert.equal(f.downloads(),1);assert.equal(f.entries().length,4);assert.equal(f.entries()[0].name,'Методичка.docx');assert.match(f.entries()[3].name,/Запрос для/);assert.equal(new TextDecoder().decode(f.entries()[3].data),'Verified structure and request');assert.deepEqual(f.calls.map(c=>c.action),['attachment-download']);
});
test('export never releases previous-account materials after delayed file fetch',async()=>{
 const f=bundleFixture();let resolve,started;const fetching=new Promise(r=>started=r);f.c.fetch=()=>new Promise(r=>{resolve=r;started();});const pending=f.c.r3Bundle(f.x,'claude');await fetching;f.owner();resolve({ok:true,arrayBuffer:async()=>new Uint8Array([1]).buffer});await assert.rejects(pending,/изменились/);assert.equal(f.downloads(),0);
});
test('changed material binding cannot produce a stale chat bundle',async()=>{
 const f=bundleFixture();f.c.fetch=async()=>{f.x.attachments.push({id:'new',file_name:'new.docx'});return {ok:true,arrayBuffer:async()=>new Uint8Array([1]).buffer};};await assert.rejects(f.c.r3Bundle(f.x,'deepseek'),/изменились/);assert.equal(f.downloads(),0);
});

function requirementsFixture(){
 const f=fixture(),windows=[];let opened=0,loads=0,resolve,reject;
 const body={innerHTML:'',removeAttribute(){}};
 f.c.openModal=html=>{const wrap={html,isConnected:true,querySelector:s=>s==='[data-x]'?{focus(){}}:body,remove(){this.isConnected=false;}};windows.push(wrap);return wrap;};
 f.c.loadPassports=()=>{loads++;return new Promise((yes,no)=>{resolve=yes;reject=no;});};
 f.c.passportContent=()=> 'Draft requirements';f.c.openDocBuilder=()=>opened++;
 return {...f,windows,body,loads:()=>loads,opened:()=>opened,resolve:()=>resolve(),reject:()=>reject(Error('Originals unread'))};
}
test('requirements refusal leaves an inline explanation and routes to materials and retry',async()=>{
 const f=requirementsFixture(),pending=f.c.openR3AssistantDocument(f.x);
 assert.match(f.windows[0].html,/Проверяем требования и материалы/);f.reject();await pending;
 assert.match(f.body.innerHTML,/Originals unread/);assert.match(f.body.innerHTML,/data-key="materials"/);assert.match(f.body.innerHTML,/Повторить проверку/);
 assert.doesNotMatch(f.body.innerHTML,/passport-approve|assistant-start/);assert.equal(f.opened(),0);
});
test('requirements double click makes one request and a closed window cannot open a late editor',async()=>{
 const f=requirementsFixture(),pending=f.c.openR3AssistantDocument(f.x);
 await f.c.openR3AssistantDocument(f.x);assert.equal(f.loads(),1);assert.equal(f.windows.length,1);
 f.windows[0].remove();f.x.passports=[{status:'approved'}];f.resolve();await pending;assert.equal(f.opened(),0);
});
test('requirements reply from a departed owner cannot open or populate their window',async()=>{
 const f=requirementsFixture(),pending=f.c.openR3AssistantDocument(f.x);f.owner();f.resolve();await pending;
 assert.equal(f.windows[0].isConnected,false);assert.equal(f.body.innerHTML,'');assert.equal(f.opened(),0);
});
test('requirements success keeps draft review and only an approved passport opens the editor',async()=>{
 for(const approved of [false,true]){const f=requirementsFixture(),pending=f.c.openR3AssistantDocument(f.x);f.x.passports=approved?[{status:'approved'}]:[];f.resolve();await pending;
 assert.equal(f.opened(),approved?1:0);assert.equal(f.body.innerHTML,approved?'':'Draft requirements');}
});
