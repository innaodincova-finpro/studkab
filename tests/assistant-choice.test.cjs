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
 f.c.preparationBlockers=()=>[];f.c.buildChatgptPrompt=()=> 'Verified request';f.c.copyText=async text=>{copied=text;return true;};f.c.window={open:url=>{opened=url;}};f.c.openModal=h=>{modal=h;return {isConnected:true,querySelector:()=>status};};
 f.c.openR3Chatgpt(f.x);await Promise.resolve();await Promise.resolve();
 assert.equal(copied,'Verified request');assert.equal(opened,'https://chatgpt.com/');assert.match(modal,/readonly/);assert.match(modal,/приложите скачанные материалы вручную/);assert.match(status.textContent,/Запрос скопирован/);assert.equal(f.calls.length,0);assert.equal(JSON.stringify(f.x),before);
});
