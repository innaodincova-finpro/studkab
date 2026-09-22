import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {clarificationAction} from '../supabase/functions/studkab-requests/clarifications.mjs';
import {requirementAction,defaultPassport,validatePassport} from '../supabase/functions/studkab-requests/requirements.mjs';
const id='44444444-4444-4444-8444-444444444444',questionId='55555555-5555-4555-8555-555555555555';
const student={id:'11111111-1111-4111-8111-111111111111',email:'student@example.test'},executor={id:'22222222-2222-4222-8222-222222222222',email:'executor@example.test'};
function editorFixture({fail=false,switchAccount=false}={}){
 const html=readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
 const fresh=[{id:questionId,item_id:'VOLUME',question:'Объём?',answer:'25–30 страниц',answer_source:'Уточнение'}];
 const x={clarifications:[{...fresh[0],answer:null}],passports:[{status:'approved',revision:3,items:[{id:'VOLUME',text:'25–30 страниц',source:'Уточнение',verified:true,answer_ids:[questionId]}]}]};
 let identity='executor',opened=0;
 const context=vm.createContext({Oblako:{identity:()=>identity,requestApi:async()=>{if(fail)throw Error('offline');if(switchAccount)identity='other';return {questions:fresh};}},toast:()=>{},esc:s=>s||'',PASSPORT_ITEM_LABEL:{},PASSPORT_CATEGORY:{},passportUnresolved:()=>[],lab:s=>s,passportItemView:()=>'',openModal:()=>{opened++;return {addEventListener(){}};}});
 vm.runInContext(html.slice(html.indexOf('async function editPassport('),html.indexOf('\nfunction viewItem(',html.indexOf('async function editPassport('))),context);
 vm.runInContext(html.slice(html.indexOf('function passportContent('),html.indexOf('\nfunction passportCard(',html.indexOf('function passportContent('))),context);
 return {x,fresh,context,opened:()=>opened};
}
test('C095 refreshed answers remove stale warning only when linked to verified passport',async()=>{
 const f=editorFixture();const before=JSON.stringify(f.x.passports);
 assert.match(f.context.passportContent(f.x),/Есть вопросы без ответа/);
 await f.context.editPassport(f.x,true);
 assert.equal(f.opened(),1);assert.equal(f.x.clarifications,f.fresh);
 assert.doesNotMatch(f.context.passportContent(f.x),/Есть вопросы без ответа/);
 assert.equal(JSON.stringify(f.x.passports),before);
 f.x.passports[0].items[0].answer_ids=[];
 assert.match(f.context.passportContent(f.x),/Есть вопросы без ответа/);
});
for(const options of [{fail:true},{switchAccount:true}])test('C095 failed or foreign-account read preserves cached answers '+JSON.stringify(options),async()=>{
 const f=editorFixture(options),before=JSON.stringify(f.x);
 await f.context.editPassport(f.x,true);
 assert.equal(f.opened(),0);assert.equal(JSON.stringify(f.x),before);
});
test('C084 Edge: list only owned requests, executor asks, student answers with source',async()=>{
 const calls=[];const deps={config:async()=>({executor_email:executor.email}),isMember:async()=>true,db:async(path,method,body)=>{calls.push({path,body});if(path.startsWith('studkab_requests?'))return path.includes('student_id=eq.bad')?[]:[{id,student_id:student.id}];if(path.startsWith('studkab_clarifications?'))return [];return {id:questionId};}};
 assert.equal((await clarificationAction({action:'clarification-list',id},{id:'bad',email:'other@test'},deps)).status,404);
 assert.ok(calls[0].path.endsWith('student_id=eq.bad'));
 assert.equal((await clarificationAction({action:'clarification-ask',id,questionId,itemId:'VOLUME',question:'Сколько страниц?'},student,deps)).status,403);
 assert.equal((await clarificationAction({action:'clarification-ask',id,questionId,itemId:'VOLUME',question:'Сколько страниц?'},executor,deps)).data.question.id,questionId);
 assert.equal((await clarificationAction({action:'clarification-answer',id,questionId,answer:'30',source:''},student,deps)).status,400);
 assert.equal((await clarificationAction({action:'clarification-answer',id,questionId,answer:'30',source:'Методичка, с. 3'},executor,deps)).status,403);
 assert.equal((await clarificationAction({action:'clarification-answer',id,questionId,answer:'30',source:'Методичка, с. 3'},student,deps)).data.question.id,questionId);
 assert.equal(calls.at(-1).body.p_actor,student.id);
});
test('C084 approval cannot be reached by changing unknown wording or omitting items',async()=>{
 let rpc=false;const deps={config:async()=>({executor_email:executor.email}),db:async path=>{if(path.startsWith('studkab_requests?'))return [{payload:{}}];rpc=true;throw Error('Unexpected access');}};
 for(const items of [[],[{id:'ANTIPLAGIARISM',category:'method',text:'Порог не задан, ожидается ответ студента',source:'',required:false}]]){
 const r=await requirementAction({action:'passport-approve',id,passportId:questionId,passport:{items}},executor,deps);assert.equal(r.status,409);
 }assert.equal(rpc,false);
});
test('C084 material changes reset verification in a new version, preserving old history',async()=>{
 const items=defaultPassport({}).items.map(x=>({...x,text:'Конкретное условие',verified:true,answer_ids:[questionId]}));const old={id:questionId,revision:1,status:'approved',title:'Требования',items,source_fingerprint:'a'.repeat(64)};
 let written;
 const result=await requirementAction({action:'passport-ensure',id,sourceFingerprint:'b'.repeat(64)},executor,{config:async()=>({executor_email:executor.email}),db:async(path,method,body)=>{if(path.startsWith('studkab_requests?'))return [{payload:{}}];if(path.startsWith('studkab_requirement_passports?'))return [old];written=body;return {items:body.p_items};}});
 assert.equal(result.data.created,true);assert.ok(written.p_items.every(x=>!x.verified&&x.answer_ids.length===0));assert.ok(old.items.every(x=>x.verified));
 assert.equal(validatePassport({items:[{id:'ONE',category:'method',text:'Test',source:'file',verified:'true'}]}).items[0].verified,false);
});
