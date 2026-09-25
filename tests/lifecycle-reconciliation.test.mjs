import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const studentHtml=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const registryHtml=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
const id='11111111-1111-4111-8111-111111111111';

function studentDelete({state,serverId=id}){
 const code=studentHtml.slice(studentHtml.indexOf('if (act === "delete-work")'),studentHtml.indexOf('if (act === "send-request")'));
 const work={id:'local-work',req:{serverId}},D={works:[work]},messages=[];
 let confirmations=0;
 const context={act:'delete-work',id:work.id,D,window:{Oblako:{}},Oblako:{identity:()=>1,requestApi:async()=>{if(state==='missing')throw Object.assign(new Error('Заявка не найдена'),{status:404});if(state==='offline')throw new Error('Сервис недоступен');return {payload:{}};}},work:()=>work,confirm:()=>{confirmations++;return true;},change:fn=>fn(),render:()=>{},toast:s=>messages.push(s),openWorkId:work.id,tab:'works'};
 vm.createContext(context);
 return Promise.resolve(vm.runInContext('(function(){'+code+'})()',context)).then(()=>({context,confirmations,messages}));
}

test('student cannot silently remove a submitted server request; unavailable server also preserves it',async()=>{
 for(const state of ['present','offline']){
  const {context,confirmations,messages}=await studentDelete({state});
  assert.equal(context.D.works.length,1);assert.equal(confirmations,0);
  assert.match(messages.join(' '),state==='present'?/остаётся в реестре/:/Не удалось проверить/);
 }
});

test('after confirmed server absence the student may remove their local copy',async()=>{
 const {context,confirmations}=await studentDelete({state:'missing'});
 assert.equal(confirmations,1);assert.equal(context.D.works.length,0);
});

test('request API exposes HTTP status to distinguish confirmed absence from connectivity failure',async()=>{
 const user={id,email:'student@example.test'},session={access_token:'token',user};
 const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})}};
 const storage={getItem:()=>null,setItem:()=>{}};
 const window={OBLAKO_CONFIG:{url:'https://example.test',key:'public'},supabase:{createClient:()=>client},localStorage:storage,addEventListener:()=>{}};
 const context={window,fetch:async()=>({ok:false,status:404,json:async()=>({error:'Заявка не найдена'})}),AbortSignal:{timeout:()=>undefined},setTimeout,clearTimeout,Date,JSON,Promise};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../oblako.js',import.meta.url),'utf8'),context);
 await window.Oblako.init({app:'kabinet',getData:()=>({})});
 await assert.rejects(window.Oblako.requestApi({action:'request-state',id}),e=>e.status===404&&e.message==='Заявка не найдена');
});

test('full registry refresh flags missing server cards without destroying local notes or manual entries',async()=>{
 const serverCard={id,requestNumber:5,note:'Private note',doc:{text:'keep'},topic:'Old'},manual={id:'rq-local',topic:'Local'};
 const D={items:[serverCard,manual]},messages=[];
 const code=registryHtml.slice(registryHtml.indexOf('async function receiveInbox('),registryHtml.indexOf('function viewList('));
 const context={inboxBusy:false,D,window:{Oblako:{}},Oblako:{identity:()=>1,requestApi:async()=>({rows:[],next:null})},location:{hash:'',pathname:'/reestr.html',search:''},item:key=>D.items.find(x=>x.id===key),save:()=>true,render:()=>{},toast:s=>messages.push(s)};
 vm.createContext(context);vm.runInContext(code,context);await context.receiveInbox();
 assert.equal(serverCard.serverMissing,true);assert.equal(serverCard.note,'Private note');assert.deepEqual(serverCard.doc,{text:'keep'});
 assert.equal(manual.serverMissing,undefined);assert.equal(D.items.length,2);
 const workflowCode=registryHtml.slice(registryHtml.indexOf('function requestWorkflow('),registryHtml.indexOf('function workflowSteps('));
 const w=vm.createContext({RequestWorkflow:{steps:[]}});vm.runInContext(workflowCode,w);
 assert.equal(w.requestWorkflow(serverCard).key,'cancelled');assert.equal(w.requestWorkflow(serverCard).action,null);
});

test('addressed registry refresh does not mark unrelated cards missing',async()=>{
 const serverCard={id,requestNumber:5};const D={items:[serverCard]};
 const code=registryHtml.slice(registryHtml.indexOf('async function receiveInbox('),registryHtml.indexOf('function viewList('));
 const context={inboxBusy:false,D,window:{Oblako:{}},Oblako:{identity:()=>1,requestApi:async()=>({rows:[],next:null})},location:{hash:'#request=22222222-2222-4222-8222-222222222222',pathname:'/reestr.html',search:''},item:()=>null,save:()=>true,render:()=>{},toast:()=>{},history:{replaceState:()=>{}}};
 vm.createContext(context);vm.runInContext(code,context);await context.receiveInbox();
 assert.equal(serverCard.serverMissing,undefined);
});
