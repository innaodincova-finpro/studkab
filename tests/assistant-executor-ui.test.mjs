import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createAssistantSession,executorProjection} from '../assistant-executor-ui.mjs';

const stamp='2026-10-09T10:00:00Z';
const caps={providers:['claude','chatgpt','deepseek'].map(provider=>({provider,available:false,reason:'not_connected'}))};
const make=(api,extra={})=>createAssistantSession({api,active:()=>true,onChange:()=>{},newOperation:()=> 'operation-one',...extra});

test('availability is checked server evidence and unavailable providers never start',async()=>{
 const calls=[];const session=make(async input=>{calls.push(input);return input.action==='assistant-capabilities'?caps:{job:null};});
 await session.refresh();for(const p of caps.providers)await session.start(p.provider);
 assert.equal(session.state.capabilities.length,3);assert.equal(calls.filter(x=>x.action==='assistant-start').length,0);
 assert.match(session.state.message,/недоступна/);
});
test('a connected provider cannot start without a concrete confirmed quote',async()=>{
 const calls=[];const session=make(async input=>{calls.push(input);return input.action==='assistant-capabilities'?{providers:[{provider:'deepseek',available:true}]}:{job:null};});
 await session.refresh();await session.start('deepseek');assert.equal(calls.filter(x=>x.action==='assistant-start').length,0);assert.match(session.state.message,/Стоимость/);
});
test('unpaid kit check synchronously becomes busy, blocks double action and does not claim AI execution',async()=>{
 let resolve,attempts=0;const promise=new Promise(r=>resolve=r);const paints=[];
 const session=make(async input=>{if(input.action==='assistant-prepare'){attempts++;return promise;}return caps;},{onChange:s=>paints.push({busy:s.busy,message:s.message})});
 const pending=session.prepare('claude');assert.equal(session.state.busy,true);await session.prepare('claude');assert.equal(attempts,1);
 resolve({state:'prepared',jobId:'job-one',acceptedAt:stamp,receipt:{operationId:'operation-one',provider:'claude',fingerprint:'a'.repeat(64),revision:1,files:[],acceptedAt:stamp}});await pending;
 assert.equal(session.state.busy,false);assert.match(session.state.message,/Комплект принят системой/);assert.doesNotMatch(session.state.message,/выполняется|Claude готовит/i);assert.equal(paints[0].busy,true);
});
test('lost acceptance response blocks repeats and only matching receipt resolves uncertainty',async()=>{
 let attempts=0,matching=false;
 const session=make(async input=>{if(input.action==='assistant-prepare'){attempts++;throw Error('network');}if(input.action==='assistant-capabilities')return caps;return {job:{operationId:matching?'operation-one':'other-operation',state:'prepared',acceptedAt:stamp}};});
 await session.prepare('deepseek');assert.equal(session.state.unknown,true);await session.prepare('deepseek');assert.equal(attempts,1);
 await session.refresh();assert.equal(session.state.unknown,true);matching=true;await session.refresh();assert.equal(session.state.unknown,false);assert.equal(attempts,1);
});
test('late callback from changed account cannot publish or accept results',async()=>{
 let active=true,resolve;const paints=[];const promise=new Promise(r=>resolve=r);
 const session=make(()=>promise,{active:()=>active,onChange:s=>paints.push(s.message)});const pending=session.prepare('claude');active=false;
 resolve({state:'prepared',jobId:'job-one',acceptedAt:stamp,receipt:{operationId:'operation-one',provider:'claude',fingerprint:'a'.repeat(64),revision:1,files:[],acceptedAt:stamp}});await pending;assert.equal(paints.length,1);assert.equal(session.state.receipt,null);
});
test('projection keeps file semantics and internally accepted kit never invents provider execution',()=>{
 const request={r3Loaded:true,r3:{takenAt:stamp},r3ConfirmedAt:stamp};
 const result=executorProjection(request,{job:{id:'job-one',state:'prepared',acceptedAt:stamp}});
 assert.equal(result.label,'Комплект принят системой');assert.equal(result.state,'kit_prepared');assert.equal(result.provider,null);assert.equal(result.file,null);
 const invalid=executorProjection(request,{job:{state:'working'}});assert.equal(invalid.state,'unknown');
 const file=executorProjection({...request,r3:{takenAt:stamp,result:{name:'Работа.docx',size:2000,at:stamp,hash:'a'.repeat(64)}}},{job:{id:'job-one',state:'prepared',acceptedAt:stamp}});
 assert.equal(file.state,'file_prepared');assert.equal(file.nextAction,'review_result');
});

const source=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('each provider offers manual chat independently of blocked API launch',()=>{
 const context={esc:escape,r3Projection:()=>({}),r3AutomaticSession:()=>({state:{capabilities:caps.providers,busy:false}})};vm.createContext(context);
 vm.runInContext(section('function r3AssistantChoice(x){','async function refreshR3Automatic'),context);
 const html=vm.runInContext("r3AssistantChoice({id:'request-one'})",context);
 assert.equal((html.match(/data-act="r3-assistant-run"/g)||[]).length,3);assert.equal((html.match(/ disabled/g)||[]).length,0);
 assert.equal((html.match(/data-act="r3-assistant-chat"/g)||[]).length,3);assert.match(html,/Через API/);assert.match(html,/Через чат/);assert.match(html,/отдельной оплатой/);assert.doesNotMatch(html,/aria-pressed/);assert.match(html,/Подготовить работу/);
});
test('actual prepared-file card offers review before delivery and keeps secondary actions',()=>{
 const x={id:'request-one',r3Loaded:true,r3:{result:{hash:'a'.repeat(64),name:'Работа.docx',size:2000,at:stamp}}};
 const context={esc:escape,window:{},requestWorkflow:()=>({step:3,title:'Подготовка',copy:'',rework:0}),r3Projection:()=>({state:'file_prepared',label:'Файл подготовлен'}),r3ActionKey:()=> 'one',r3Actions:new Map(),r3CurrentLabel:()=> 'В работе',r3Assistant:()=> 'claude',r3Links:()=> 'secondary-links',r3Name:s=>s,r3Size:s=>String(s),r3When:s=>s};vm.createContext(context);
 vm.runInContext(section('function r3Card(x,route){','// «Скачать задание'),context);context.x=x;
 const html=vm.runInContext('r3Card(x,true)',context);assert.match(html,/data-act="r3-result-review"/);assert.doesNotMatch(html,/data-act="r3-deliver"/);assert.match(html,/Другие действия/);assert.match(html,/secondary-links/);
 context.r3Actions.set('one',{busy:true,message:'Передаём студенту…'});const pending=vm.runInContext('r3Card(x,true)',context);assert.match(pending,/<fieldset disabled/);assert.match(pending,/Работа.docx/);assert.match(pending,/Другие действия/);assert.match(pending,/secondary-links/);
});

test('empty success does not invent acceptance; known HTTP rejection permits correction',async()=>{
 const empty=make(async()=>({}));await empty.prepare('claude');assert.equal(empty.state.unknown,true);assert.equal(empty.state.receipt,null);
 let count=0;const rejected=make(async()=>{count++;throw Object.assign(Error('PLAN_REQUIRED'),{status:409});});await rejected.prepare('claude');assert.equal(rejected.state.unknown,false);await rejected.prepare('claude');assert.equal(count,2);
});
test('authoritative null clears old job, failed reads mark it stale and aliases reconcile uncertainty',async()=>{
 let mode='lost';const session=make(async i=>{if(i.action==='assistant-capabilities')return caps;if(i.action==='assistant-prepare')throw Error('network');if(mode==='lost')throw Error('network');if(mode==='alias')return {accepted:true,job:{id:'older-job',operationId:'original-operation',state:'prepared',acceptedAt:stamp}};return {accepted:false,job:null};});
 await session.prepare('claude');await session.refresh();assert.equal(session.state.stale,true);mode='alias';await session.refresh();assert.equal(session.state.unknown,false);assert.equal(session.state.stale,false);assert.equal(session.state.job.id,'older-job');mode='empty';await session.refresh();assert.equal(session.state.job,null);
});

test('empty dispatch response remains unknown and cannot authorize a second dispatch',async()=>{
 let starts=0;const session=make(async i=>{if(i.action==='assistant-capabilities')return {providers:[{provider:'deepseek',available:true,priceMicrousd:10000,quoteId:'quote-one'}]};if(i.action==='assistant-preflight')return {jobId:'job-one',state:'prepared',acceptedAt:stamp,receipt:{operationId:'operation-one',provider:'deepseek',acceptedAt:stamp,revision:1,fingerprint:'a'.repeat(64),files:[]},requiresConfirmation:true,quoteId:'quote-one',priceMicrousd:10000};if(i.action==='assistant-start'){starts++;return {};}return {job:null};});await session.refresh();await session.preflight('deepseek');await session.start('deepseek','quote-one');assert.equal(session.state.unknown,true);await session.start('deepseek','quote-one');assert.equal(starts,1);
});

test('per-request price confirmation keeps accepted operation and amount through queueing',async()=>{
 const calls=[],receipt={operationId:'operation-one',provider:'deepseek',acceptedAt:stamp,revision:1,fingerprint:'a'.repeat(64),files:[]};let queued=false;
 const s=make(async i=>{calls.push(i);if(i.action==='assistant-capabilities')return {providers:[{provider:'deepseek',available:true,reason:'ready'}]};if(i.action==='assistant-preflight')return {jobId:'job-one',state:'prepared',receipt,quoteId:'real-quote',priceMicrousd:21000,requiresConfirmation:true};if(i.action==='assistant-start'){queued=true;return {jobId:'job-one',state:'queued',queued:true,receipt};}return {accepted:queued,job:queued?{id:'job-one',state:'queued',operationId:'operation-one',acceptedAt:stamp,queuedAt:stamp}:null};});
 await s.refresh();const quote=await s.preflight('deepseek');assert.equal(quote.priceMicrousd,21000);assert.equal(calls.filter(c=>c.action==='assistant-start').length,0);await s.start('deepseek','wrong-quote');assert.equal(calls.filter(c=>c.action==='assistant-start').length,0);await s.start('deepseek',quote.quoteId);
 const sent=calls.find(c=>c.action==='assistant-start');assert.equal(sent.operation,receipt.operationId);assert.equal(sent.confirmedMicrousd,21000);assert.equal(sent.confirmed,true);assert.equal(s.state.job.state,'queued');assert.equal(s.state.unknown,false);
});

test('malformed capability/read success cannot retain a launchable old observation',async()=>{
 let malformed=false,preflights=0;const s=make(async i=>{if(i.action==='assistant-preflight'){preflights++;return {};}if(malformed)return {};return i.action==='assistant-capabilities'?{providers:[{provider:'deepseek',available:true,reason:'ready'}]}:{job:null};});await s.refresh();assert.equal(s.state.capabilities[0].available,true);malformed=true;await s.refresh();assert.equal(s.state.capabilities,null);assert.equal(s.state.stale,true);await s.preflight('deepseek');assert.equal(preflights,0);
});

const legacyRequest={id:'legacy-copy',r3Loaded:true,r3:{takenAt:stamp},claude:{queuedAt:stamp,startedAt:null,readyAt:null,attachedAt:null,error:null}};
test('legacy saved Claude copy permits manual choice without rewriting queued evidence',()=>{
 const p=executorProjection(legacyRequest,{job:null});assert.equal(p.state,'queued');assert.equal(p.legacyChatAvailable,true);assert.equal(p.label,'Материалы получены');assert.equal(p.provider,null);
 for(const observation of [{stale:true},{unknown:true},{job:{id:'active-job',provider:'claude',state:'queued',acceptedAt:stamp,queuedAt:stamp}},{job:{id:'active-job',provider:'claude',state:'dispatched',acceptedAt:stamp,queuedAt:stamp,startedAt:stamp}}])assert.notEqual(executorProjection(legacyRequest,observation).legacyChatAvailable,true);
 for(const change of [{startedAt:stamp},{error:'unconfirmed'},{queuedAt:'invalid'}])assert.notEqual(executorProjection({...legacyRequest,claude:{...legacyRequest.claude,...change}}).legacyChatAvailable,true);
});
test('actual legacy card restores all three chats but refuses API even with available capabilities',async()=>{
 const context={esc:escape,window:{},requestWorkflow:()=>({step:3,title:'Подготовка',copy:'',rework:0}),r3Projection:x=>executorProjection(x,{job:null}),r3ActionKey:()=> 'one',r3Actions:new Map(),r3CurrentLabel:()=> 'В работе',r3Assistant:()=> 'claude',r3Links:()=> 'secondary-links',r3AutomaticSession:()=>({state:{capabilities:caps.providers.map(p=>({...p,available:true})),busy:false},preflight:()=>{throw Error('must not preflight');}})};
 vm.createContext(context);vm.runInContext(section('function r3AssistantChoice(x){','async function refreshR3Automatic'),context);vm.runInContext(section('async function r3StartAssistant(x,provider){','function r3AssistantPrepare'),context);vm.runInContext(section('function r3Card(x,route){','// «Скачать задание'),context);context.x=structuredClone(legacyRequest);context.r3ApiInformation=()=>{};
 const before=JSON.stringify(context.x),html=vm.runInContext('r3Card(x,true)',context);
 assert.equal((html.match(/data-act="r3-assistant-chat"/g)||[]).length,3);assert.equal((html.match(/data-act="r3-assistant-run"[^>]* disabled/g)||[]).length,0);assert.match(html,/Материалы получены/);assert.match(html,/Выберите нейросеть и способ подготовки/);
 await vm.runInContext("r3StartAssistant(x,'deepseek')",context);assert.equal(JSON.stringify(context.x),before);
 context.r3Projection=()=>executorProjection(context.x,{job:{id:'active-job',provider:'claude',state:'queued',acceptedAt:stamp,queuedAt:stamp}});
 assert.doesNotMatch(vm.runInContext('r3Card(x,true)',context),/data-act="r3-assistant-chat"/);
});

test('API reasons distinguish configuration, budget and unresolved dispatch without authorizing launch',()=>{
 const state={busy:false,capabilities:[{provider:'deepseek',available:false,reason:'not_connected'}]},context={esc:escape,r3Projection:()=>({legacyChatAvailable:true}),r3AutomaticSession:()=>({state})};vm.createContext(context);
 vm.runInContext(section('function r3AssistantChoice(x){','async function refreshR3Automatic'),context);
 const check=()=>vm.runInContext("r3ApiAvailability({id:'one'},'deepseek')",context);
 assert.equal(check().label,'API не подключён');assert.equal(check().launchable,false);
 state.capabilities[0].reason='budget_exhausted';assert.equal(check().label,'Лимит подготовки исчерпан');
 state.capabilities[0].available=true;assert.equal(check().label,'Прежняя передача требует проверки');assert.equal(check().launchable,false);
 state.unknown=true;assert.equal(check().label,'Состояние запуска не подтверждено');assert.equal(check().launchable,false);
 state.unknown=false;context.r3Projection=()=>({});assert.equal(check().launchable,true);
});
