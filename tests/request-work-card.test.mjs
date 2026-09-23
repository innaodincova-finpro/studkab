import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {requestWorkCard,appendRequestWorkCard} from '../scripts/request-work-card.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const payload={v:1,id:'rq_synthetic',t:'Учебный реферат',k:'Реферат',d:'',u:'',fc:'',kf:'',ct:'',n:'',g:'',pr:'',fo:'',co:'',s:'',dl:'2026-10-26',rq:'',org:'Синтетические данные',mn:'12–15 страниц. AI не использовать. Предусмотрен маршрут готового Word.',cn:'synthetic@example.test',fm:{mt:20,mr:15,mb:20,ml:30,fn:'Times New Roman',sz:14,sp:1.5,ind:1.25}};
const request={id:'11111111-1111-4111-8111-111111111111',number:4,client_id:payload.id,created_at:'2026-09-22T10:20:30Z',payload};
const make=()=>requestWorkCard(request,'w_recovered',{attachmentCount:2});
function ui(data){
 const ctx={D:structuredClone(data),KEY:'test',storageOk:true,localStorage:{getItem:()=>null},applyTheme:()=>{},save:()=>{},ruDate:x=>x,requestLink:()=>''};vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('var CHAPTERS ='),html.indexOf('function emptyData(){')),ctx);
 vm.runInContext(html.slice(html.indexOf('function requestPayload(w){'),html.indexOf('var FIELD_LIMITS')),ctx);
 vm.runInContext(html.slice(html.indexOf('function requestText(w, withLink){'),html.indexOf('var REQUEST_FILE_TYPES')),ctx);
 vm.runInContext(html.slice(html.indexOf('function load(){'),html.indexOf('function save(){')),ctx);
 return ctx;
}
test('C100 recovered card roundtrips exact submission after load and profile update, including blank identity',()=>{
 const card=make(),data={settings:{name:'Имя нового профиля',group:'Другая группа',univ:'Другой вуз',contact:'other@example.test'},works:[card]};
 const ctx=ui(data);ctx.load();ctx.applyProfileToBlankWorks(ctx.D);
 const round=JSON.parse(JSON.stringify(ctx.requestPayload(ctx.D.works[0])));
 assert.deepEqual(round,payload);
 assert.doesNotMatch(ctx.requestText(ctx.D.works[0],false),/Имя нового профиля|Другая группа/);
 assert.notEqual(card.id,card.req.id);assert.notEqual(card.id,card.req.serverId);
 assert.equal(card.req.serverId,request.id);assert.equal(card.req.number,4);assert.equal(card.req.id,payload.id);
 assert.equal(card.req.sent,'2026-09-22');assert.equal(card.req.sentBy,'direct');assert.equal(card.req.attachments,2);
 assert.deepEqual(Object.keys(card.structure),Array.from(ctx.CHAPTERS,x=>x.id));
 assert.ok(Object.values(card.structure).every(c=>c.text===''&&c.status==='draft'));
 assert.match(html,/req:\{ id:r.id, serverId:r.serverId, preserveSubmittedFields:r.preserveSubmittedFields,/);
});
test('C100 preparation appends exactly one card without mutating five works or unrelated cloud keys',()=>{
 const source={works:[],settings:{name:'Source'}},target={works:Array.from({length:5},(_,i)=>({id:'existing'+i,topic:'Existing '+i,req:{id:'rq'+i,serverId:'server'+i},custom:{keep:i}})),settings:{name:'Target'},tasks:[{id:'task'}],templates:[{id:'template'}],events:[],icsSeq:{retain:9},custom:{nested:['keep']}};
 const before=structuredClone(target),oldSource=structuredClone(source),card=make();
 const result=appendRequestWorkCard(target,card);
 assert.deepEqual(target,before);assert.deepEqual(source,oldSource);assert.equal(result.works.length,6);assert.deepEqual(result.works.slice(0,5),before.works);
 for(const key of Object.keys(before).filter(k=>k!=='works'))assert.deepEqual(result[key],before[key]);
 assert.throws(()=>appendRequestWorkCard(result,card),/Existing/);
 for(const collision of [{id:card.id},{req:{id:card.req.id}},{req:{serverId:card.req.serverId}}])assert.throws(()=>appendRequestWorkCard({...target,works:[collision]},card),/Existing/);
});
test('C100 unrelated cards retain profile defaults, while missing format or ambiguous IDs fail preparation',()=>{
 const ctx=ui({settings:{name:'Обычный профиль',group:'Группа'},works:[{student:'',group:'',format:{},req:{id:'new'}}]});
 ctx.applyProfileToBlankWorks(ctx.D);assert.equal(ctx.D.works[0].student,'Обычный профиль');assert.equal(ctx.requestPayload(ctx.D.works[0]).g,'Группа');
 assert.throws(()=>requestWorkCard({...request,payload:{...payload,fm:{}}},'w_exact',{attachmentCount:2}),/format/);
 assert.throws(()=>requestWorkCard(request,payload.id,{attachmentCount:2}),/identifier/);
 assert.throws(()=>requestWorkCard(request,'w_exact'),/attachment count/);
 assert.deepEqual(request.payload,payload);
});
