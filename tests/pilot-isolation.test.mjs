import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';

const executor={id:'00000000-0000-4000-8000-000000000001',email:'pilot-executor@example.test',email_confirmed_at:'yes'};
const students=['A','B','C'].map((mark,index)=>({id:`10000000-0000-4000-8000-00000000000${index+1}`,email:`pilot-${mark.toLowerCase()}@example.test`,email_confirmed_at:'yes',mark:`PILOT-STUDENT-${mark}`}));
const ids=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
const call=body=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(body)});

test('three synthetic students remain isolated across submit, sign-in and Word retrieval',async()=>{
 let current=students[0],nextNumber=1,resultReads=0;
 const rows=[],results=new Map();
 const db=async(path,method,body)=>{
  if(path==='rpc/submit_studkab_request'){
   const index=rows.length;
   rows.push({id:ids[index],number:nextNumber++,student_id:body.student,payload:body.content,created_at:'2026-09-13T00:00:00Z'});
   results.set(ids[index],{delivery_id:`30000000-0000-4000-8000-00000000000${index+1}`,document:{topic:body.content.t},created_at:'2026-09-13T00:00:00Z',version_id:null});
   return {id:ids[index],number:index+1};
  }
  if(path.startsWith('studkab_requests?select=id,student_id,payload')){
   const id=path.match(/&id=eq\.([^&]+)/)?.[1];
   return rows.filter(row=>row.id===id).map(({id,student_id,payload})=>({id,student_id,payload}));
  }
  if(path.startsWith('studkab_results?')){
   resultReads++;
   const id=path.match(/request_id=eq\.([^&]+)/)?.[1];
   return results.has(id)?[results.get(id)]:[];
  }
  if(path.startsWith('studkab_requests?select=id,number,payload,created_at'))return rows;
  throw Error(`Unexpected synthetic path: ${path} ${method||''}`);
 };
 const app=handler({auth:async()=>current,config:async()=>({executor_email:executor.email}),db});
 for(let i=0;i<students.length;i++){
  current=students[i];
  const response=await app(call({action:'submit',student_id:executor.id,payload:{id:`pilot-${i+1}`,t:`${current.mark}: синтетическая тема`,cn:'SYNTHETIC',fm:{sz:14}}}));
  assert.equal(response.status,200);assert.equal(rows[i].student_id,current.id);
 }
 for(let i=0;i<students.length;i++){
  current=students[i];
  const own=await app(call({action:'result',id:ids[i]}));
  assert.equal(own.status,200);assert.equal((await own.json()).result.document.topic,`${current.mark}: синтетическая тема`);
  for(let j=0;j<students.length;j++)if(j!==i){
   const before=resultReads,foreign=await app(call({action:'result',id:ids[j]}));
   assert.equal(foreign.status,404);assert.deepEqual(await foreign.json(),{error:'Заявка не найдена'});assert.equal(resultReads,before);
  }
 }
 current=executor;
 const inbox=await app(call({action:'inbox'}));
 assert.equal(inbox.status,200);assert.deepEqual((await inbox.json()).rows.map(row=>row.student_id),students.map(student=>student.id));
 current=students[0];
 const repeat=await app(call({action:'result',id:ids[0]}));
 assert.equal(repeat.status,200);assert.equal((await repeat.json()).result.document.topic,'PILOT-STUDENT-A: синтетическая тема');
});

test('twenty concurrent synthetic students do not mix requests or results',async()=>{
 const count=20;
 const loadStudents=Array.from({length:count},(_,i)=>({
  id:`40000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
  email:`load-student-${i+1}@example.test`,email_confirmed_at:'yes'
 }));
 const rows=[],results=new Map();let resultReads=0;
 const db=async(path,method,body)=>{
  if(path==='rpc/submit_studkab_request'){
   await Promise.resolve();
   const number=rows.length+1,id=`50000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
   rows.push({id,number,student_id:body.student,payload:body.content,created_at:'2026-09-14T00:00:00Z'});
   results.set(id,{delivery_id:`60000000-0000-4000-8000-${String(number).padStart(12,'0')}`,document:{topic:body.content.t},created_at:'2026-09-14T00:00:00Z',version_id:null});
   return {id,number};
  }
  if(path.startsWith('studkab_requests?select=id,student_id,payload')){
   const id=path.match(/&id=eq\.([^&]+)/)?.[1];
   return rows.filter(row=>row.id===id).map(({id,student_id,payload})=>({id,student_id,payload}));
  }
  if(path.startsWith('studkab_results?')){
   resultReads++;
   const id=path.match(/request_id=eq\.([^&]+)/)?.[1];
   return results.has(id)?[results.get(id)]:[];
  }
  if(path.startsWith('studkab_requests?select=id,number,payload,created_at'))return [...rows].sort((a,b)=>a.number-b.number);
  throw Error(`Unexpected load path: ${path} ${method||''}`);
 };
 const apps=loadStudents.map(student=>handler({auth:async()=>student,config:async()=>({executor_email:executor.email}),db}));
 const submitted=await Promise.all(apps.map((app,i)=>app(call({action:'submit',student_id:executor.id,payload:{id:`load-${i+1}`,t:`LOAD-STUDENT-${i+1}`,cn:'SYNTHETIC',fm:{sz:14}}}))));
 assert.ok(submitted.every(response=>response.status===200));
 assert.equal(rows.length,count);assert.equal(new Set(rows.map(row=>row.id)).size,count);assert.equal(new Set(rows.map(row=>row.student_id)).size,count);
 for(let i=0;i<count;i++)assert.equal(rows.find(row=>row.payload.id===`load-${i+1}`)?.student_id,loadStudents[i].id);

 const own=await Promise.all(apps.map((app,i)=>app(call({action:'result',id:rows.find(row=>row.student_id===loadStudents[i].id).id}))));
 assert.ok(own.every(response=>response.status===200));
 const foreignReadsBefore=resultReads;
 const foreign=await Promise.all(apps.map((app,i)=>app(call({action:'result',id:rows.find(row=>row.student_id===loadStudents[(i+1)%count].id).id}))));
 assert.ok(foreign.every(response=>response.status===404));assert.equal(resultReads,foreignReadsBefore);

 const reopened=loadStudents.map(student=>handler({auth:async()=>student,config:async()=>({executor_email:executor.email}),db}));
 const restored=await Promise.all(reopened.map((app,i)=>app(call({action:'result',id:rows.find(row=>row.student_id===loadStudents[i].id).id}))));
 assert.ok(restored.every(response=>response.status===200));
 const registry=handler({auth:async()=>executor,config:async()=>({executor_email:executor.email}),db});
 const inbox=await registry(call({action:'inbox'}));assert.equal(inbox.status,200);assert.equal((await inbox.json()).rows.length,count);
});
