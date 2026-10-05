// ROUTE-03, R3-C: «Взять в работу», готовый файл, «Передать студенту», скачивание студентом.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {schema,submissionExtension,student,other,apiDatabase} from './intake-fixture.mjs';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
const read=n=>fs.readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
const r3a=read('20261005090000_route03_a_request_form.sql');
const DETAILS={k:'Практические задания',d:'Математика',u:'ММУ',fo:'Очно-заочная',g:'1 курс, 26Т101а',n:'Иванова Мария Петровна'};
const EXEC='executor@example.invalid',STUDENT='student@example.invalid';
const DOCX=Buffer.from([80,75,3,4,9,9,9]);
async function body(name,bytes,type){return {fileName:name,contentType:type,sizeBytes:bytes.length,fileHash:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),base64:bytes.toString('base64')};}
async function fixture({route='r3'}={}){
 const db=new PGlite();
 await db.exec(schema()+submissionExtension()+read('20261001162253_route02_receive_before_analysis.sql')+r3a.slice(r3a.indexOf('-- R3-A: регистрация заявки по форме'))+read('20261005120000_route03_c_work.sql')+read('20261006090000_route03_d_hand_return.sql'));
 await db.exec('set role service_role');
 const api=apiDatabase(db),rpc=async(name,args)=>(await db.query('select '+name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r;
 const draft=await rpc('studkab_intake_open',{p_student:student});
 const snap=await rpc('studkab_intake_receive_snapshot',{p_student:student,p_draft:draft.id});
 const receipt=await rpc('studkab_intake_receive_form',{p_student:student,p_draft:draft.id,p_revision:snap.revision,p_deadline:'2027-01-25',p_description:'',p_contact:STUDENT,p_details:JSON.stringify(DETAILS),p_link:'https://disk.yandex.ru/d/x'});
 if(route!=='r3'){await db.exec('reset role');await db.query("update studkab_requests set payload=jsonb_set(payload,'{route}','\"received\"') where id=$1",[receipt.id]);await db.exec('set role service_role');}
 const saved=new Map(),removed=[];let who={id:other,email:EXEC};
 const db2=async(path,method,b)=>{
  if(path.startsWith('rpc/studkab_r3_'))return rpc(path.slice(4),b);
  if(path.startsWith('studkab_r3_work?')){const q=new URLSearchParams(path.split('?')[1]);return (await db.query('select * from studkab_r3_work where request_id=$1',[q.get('request_id').slice(3)])).rows.map(r=>({...r,taken_at:r.taken_at?.toISOString?.()??r.taken_at,delivered_at:r.delivered_at?.toISOString?.()??r.delivered_at,result_at:r.result_at?.toISOString?.()??r.result_at,downloaded_at:r.downloaded_at?.toISOString?.()??r.downloaded_at}));}
  const iso=r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Date?v.toISOString():v]));
  const qs=()=>new URLSearchParams(path.split('?')[1]),eq=v=>v&&v.slice(3);
  if(path.startsWith('studkab_r3_versions?'))return (await db.query('select n,name,size,delivered_at from studkab_r3_versions where request_id=$1 order by n',[eq(qs().get('request_id'))])).rows.map(iso);
  if(path.startsWith('studkab_r3_returns?')){const q=qs();return (await db.query('select n,comment,created_at from studkab_r3_returns where request_id=$1 order by n '+(q.get('order')==='n.desc'?'desc':'asc'),[eq(q.get('request_id'))])).rows.map(iso);}
  if(path.startsWith('studkab_r3_return_files?')){const q=qs(),args=[eq(q.get('request_id'))];let w='request_id=$1';
   if(q.get('return_n')){args.push(+eq(q.get('return_n')));w+=' and return_n=$'+args.length;}if(q.get('id')){args.push(eq(q.get('id')));w+=' and id=$'+args.length;}
   return (await db.query('select id,return_n,name,size,type,path from studkab_r3_return_files where '+w+' order by created_at',args)).rows.map(iso);}
  if(path.startsWith('studkab_requests?')){const q=new URLSearchParams(path.split('?')[1]);return (await db.query('select id,student_id,ready_at,payload from studkab_requests where id=$1 and deleting_at is null',[q.get('id').slice(3)])).rows;}
  if(path.startsWith('studkab_clarifications?'))return [];
  return api(path,method,b);
 };
 const app=handler({db:db2,auth:async()=>({...who,email_confirmed_at:'2026-01-01'}),isMember:async()=>true,config:async()=>({executor_email:EXEC}),
  download:async(path,name)=>({url:'https://storage.example/'+path,fileName:name,expiresIn:300}),saveResult:async(path,type,bytes,hash)=>{saved.set(path,{type,bytes,hash});},remove:async path=>{removed.push(path);}});
 const call=async b=>{const r=await app(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer t'},body:JSON.stringify(b)}));return {status:r.status,...await r.json()};};
 return {db,rpc,receipt,saved,removed,call,as(id,email){who={id,email};}};
}
test('R3-C: executor takes the request, attaches a result, delivers it; student downloads only the delivered file',async()=>{
 const f=await fixture();try{
  const id=f.receipt.id;
  assert.equal((await f.call({action:'r3-state',id})).work.takenAt,null);
  assert.equal((await f.call({action:'r3-result-upload',id,...await body('Работа.docx',DOCX,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})).status,409);
  const taken=(await f.call({action:'r3-take',id})).work;assert.ok(taken.takenAt);
  assert.equal((await f.call({action:'r3-take',id})).work.takenAt,taken.takenAt);
  assert.equal((await f.call({action:'r3-deliver',id,fileHash:'a'.repeat(64)})).status,409);
  assert.equal((await f.call({action:'r3-result-upload',id,...await body('Работа.txt',Buffer.from('text'),'text/plain')})).status,400);
  const b=await body('Иванова_Математика.docx',DOCX,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const up=(await f.call({action:'r3-result-upload',id,...b})).work;assert.equal(up.result.name,'Иванова_Математика.docx');assert.ok(f.saved.has('r3-results/'+id+'/'+b.fileHash));
  // Студент не видит рабочий файл до передачи.
  f.as(student,STUDENT);
  assert.equal((await f.call({action:'r3-state',id})).work.result,null);assert.equal((await f.call({action:'r3-download',id})).status,404);
  assert.equal((await f.call({action:'r3-take',id})).status,403);
  const progress=await f.call({action:'student-progress',id});assert.equal(progress.stage,'r3_in_work');
  f.as(other,EXEC);
  assert.equal((await f.call({action:'r3-deliver',id,fileHash:'b'.repeat(64)})).status,409);
  const sent=await f.call({action:'r3-deliver',id,fileHash:b.fileHash});assert.equal(sent.status,200);assert.equal(sent.work.delivered.name,'Иванова_Математика.docx');
  assert.equal((await f.call({action:'r3-deliver',id,fileHash:b.fileHash})).duplicate,true);
  f.as(student,STUDENT);
  const ready=await f.call({action:'student-progress',id});assert.equal(ready.stage,'r3_ready');assert.equal(ready.result.name,'Иванова_Математика.docx');assert.equal(ready.result.downloadedAt,null);
  const link=await f.call({action:'r3-download',id});assert.equal(link.url,'https://storage.example/r3-results/'+id+'/'+b.fileHash);
  assert.ok((await f.call({action:'student-progress',id})).result.downloadedAt);
  // Новый рабочий файл не меняет переданный, пока его не передадут отдельно.
  f.as(other,EXEC);const b2=await body('Версия2.pdf',Buffer.from('%PDF-1.4 v2'),'application/pdf');
  await f.call({action:'r3-result-upload',id,...b2});
  f.as(student,STUDENT);assert.equal((await f.call({action:'r3-download',id})).fileName,'Иванова_Математика.docx');
  f.as(other,EXEC);await f.call({action:'r3-deliver',id,fileHash:b2.fileHash});
  f.as(student,STUDENT);const again=await f.call({action:'student-progress',id});assert.equal(again.result.name,'Версия2.pdf');assert.equal(again.result.downloadedAt,null);
 }finally{await f.db.close();}
});
test('R3-C: another student and requests outside the form route are refused; functions are closed to browsers',async()=>{
 const f=await fixture();try{
  f.as('33333333-3333-4333-8333-333333333333','stranger@example.invalid');
  assert.equal((await f.call({action:'r3-state',id:f.receipt.id})).status,404);
  for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(()=>f.db.query('select studkab_r3_take($1)',[f.receipt.id]),/permission denied/);await assert.rejects(()=>f.db.query('select * from studkab_r3_work'),/permission denied/);}
 }finally{await f.db.close();}
 const g=await fixture({route:'received'});try{assert.equal((await g.call({action:'r3-take',id:g.receipt.id})).status,404);assert.deepEqual(await g.rpc('studkab_r3_take',{p_request:g.receipt.id}),{missing:true});}finally{await g.db.close();}
});

const JPG=Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4]);
test('R3-D: student hands in, returns with remarks and files; executor sees the return and delivers version 2',async()=>{
 const f=await fixture();try{
  const id=f.receipt.id,docx='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  f.as(student,STUDENT);
  assert.equal((await f.call({action:'r3-hand',id})).status,409);
  f.as(other,EXEC);await f.call({action:'r3-take',id});
  const v1=await body('Работа.docx',DOCX,docx);await f.call({action:'r3-result-upload',id,...v1});await f.call({action:'r3-deliver',id,fileHash:v1.fileHash});
  assert.equal((await f.call({action:'r3-hand',id})).status,403);
  f.as(student,STUDENT);
  const pic=await body('Замечания.jpg',JPG,'image/jpeg');
  assert.equal((await f.call({action:'r3-return-upload',id,...pic})).status,409);
  assert.equal((await f.call({action:'r3-return',id,comment:'Задание 3 подробно'})).status,409);
  const handed=await f.call({action:'r3-hand',id});assert.ok(handed.work.handedAt);
  assert.equal((await f.call({action:'student-progress',id})).stage,'r3_handed');
  const up=await f.call({action:'r3-return-upload',id,...pic});assert.equal(up.work.pendingFiles.length,1);assert.ok(f.saved.has('r3-returns/'+id+'/'+pic.fileHash));
  assert.equal((await f.call({action:'r3-return-upload',id,...pic})).work.pendingFiles.length,1);
  const extra=await body('Лишний.pdf',Buffer.from('%PDF-1.4 x'),'application/pdf');
  const two=await f.call({action:'r3-return-upload',id,...extra});assert.equal(two.work.pendingFiles.length,2);
  const rm=await f.call({action:'r3-return-file-remove',id,fileId:two.fileId});assert.equal(rm.work.pendingFiles.length,1);assert.deepEqual(f.removed,['r3-returns/'+id+'/'+extra.fileHash]);
  assert.equal((await f.call({action:'r3-return-upload',id,...await body('Вирус.exe',Buffer.from('MZ'),'application/octet-stream')})).status,400);
  assert.equal((await f.call({action:'r3-return',id,comment:'  '})).status,400);
  const ret=await f.call({action:'r3-return',id,comment:'Задание 3: показать решение подробно.'});assert.equal(ret.n,1);
  const p=await f.call({action:'student-progress',id});
  assert.equal(p.stage,'r3_in_work');assert.equal(p.returns,1);assert.equal(p.lastReturn.n,1);assert.deepEqual(p.lastReturn.files,['Замечания.jpg']);assert.equal(p.result,undefined);
  assert.equal((await f.call({action:'r3-hand',id})).status,409);
  // Исполнитель видит замечания и файл, скачивает его; передаёт версию 2.
  f.as(other,EXEC);
  const st=(await f.call({action:'r3-state',id})).work;
  assert.equal(st.returns,1);assert.equal(st.returnList[0].comment,'Задание 3: показать решение подробно.');assert.equal(st.returnList[0].files[0].name,'Замечания.jpg');assert.equal(st.versions.length,1);
  const dl=await f.call({action:'r3-return-file-download',id,fileId:st.returnList[0].files[0].id});assert.equal(dl.url,'https://storage.example/r3-returns/'+id+'/'+pic.fileHash);
  const v2=await body('Работа_исправленная.pdf',Buffer.from('%PDF-1.4 v2'),'application/pdf');
  await f.call({action:'r3-result-upload',id,...v2});const sent=await f.call({action:'r3-deliver',id,fileHash:v2.fileHash});assert.equal(sent.work.versions.length,2);
  f.as(student,STUDENT);
  const again=await f.call({action:'student-progress',id});assert.equal(again.stage,'r3_ready');assert.equal(again.returns,1);assert.equal(again.result.name,'Работа_исправленная.pdf');assert.equal(again.result.handedAt,null);
  assert.ok((await f.call({action:'r3-hand',id})).work.handedAt);
  // Удаление заявки находит все файлы работы, версий и замечаний.
  await f.db.exec('reset role;alter table studkab_gen_jobs add column if not exists id uuid;alter table studkab_gen_attempts add column if not exists job_id uuid');await f.db.exec("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
  const plan=(await f.db.query('select prepare_studkab_request_delete($1) r',[id])).rows[0].r;
  for(const path of ['r3-results/'+id+'/'+v1.fileHash,'r3-results/'+id+'/'+v2.fileHash,'r3-returns/'+id+'/'+pic.fileHash])assert.ok(plan.paths.includes(path),path);
 }finally{await f.db.close();}
});
test('R3-D: another student cannot hand in or return; new tables and functions are closed to browsers',async()=>{
 const f=await fixture();try{
  f.as('33333333-3333-4333-8333-333333333333','stranger@example.invalid');
  assert.equal((await f.call({action:'r3-hand',id:f.receipt.id})).status,404);
  assert.deepEqual(await f.rpc('studkab_r3_hand',{p_request:f.receipt.id,p_student:'33333333-3333-4333-8333-333333333333'}),{missing:true});
  for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);
   for(const t of ['studkab_r3_versions','studkab_r3_returns','studkab_r3_return_files'])await assert.rejects(()=>f.db.query('select * from '+t),/permission denied/);
   await assert.rejects(()=>f.db.query('select studkab_r3_return($1,$2,$3)',[f.receipt.id,student,'xxx']),/permission denied/);}
 }finally{await f.db.close();}
});
