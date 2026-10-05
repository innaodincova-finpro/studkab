import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {schema,submissionExtension,student,other,apiDatabase} from './intake-fixture.mjs';
import {intakeAction} from '../supabase/functions/studkab-requests/intake.mjs';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
const migration=fs.readFileSync(new URL('../supabase/migrations/20261001162253_route02_receive_before_analysis.sql',import.meta.url),'utf8');
// R3-A: регистрация по форме (сведения для титульного листа и ссылка на облако).
const r3=fs.readFileSync(new URL('../supabase/migrations/20261005090000_route03_a_request_form.sql',import.meta.url),'utf8');
const formFunction=r3.slice(r3.indexOf('-- R3-A: регистрация заявки по форме'));
const details={k:'Практические задания',d:'Математика',u:'Московский международный университет',fo:'Очно-заочная',g:'1 курс, 26М214в',n:'Зеленская Анастасия Анатольевна'};
async function fixture(){
 const db=new PGlite();await db.exec(schema()+submissionExtension()+migration+formFunction);await db.exec('set role service_role');
 const api=apiDatabase(db),rpc=(name,args)=>api('rpc/studkab_intake_'+name,'POST',args);
 const draft=await rpc('open',{p_student:student}),files=[];
 for(let i=0;i<3;i++){
  const {file}=await rpc('reserve',{p_student:student,p_draft:draft.id,p_name:'Original'+i+'.pdf',p_type:'application/pdf',p_size:10,p_hash:'abc'[i].repeat(64),p_supersedes:null});
  await rpc('finish',{p_student:student,p_draft:draft.id,p_file:file.id,p_hash:file.file_hash});files.push(file);
 }
 const snap=()=>rpc('receive_snapshot',{p_student:student,p_draft:draft.id}),user={id:student,email:'student@example.invalid',email_confirmed_at:'2026-01-01'};
 const input={action:'intake-receive',id:draft.id,revision:(await snap()).revision,deadline:'2026-10-30',description:'',details,link:''},copied=[];
 // R3-B: облако подменено; настоящая сеть в тестах не используется.
 const cloud={status:200};const fetchCloud=async()=>new Response(JSON.stringify({type:'dir',_embedded:{items:[],total:0}}),{status:cloud.status});
 const deps={db:api,isMember:async()=>true,transferIntake:async f=>copied.push(f),fetchCloud};
 const action=(body=input,who=user,extra={})=>intakeAction(body,who,{...deps,...extra});
 const receive=(extra={})=>rpc('receive_form',{p_student:student,p_draft:draft.id,p_revision:input.revision,p_deadline:input.deadline,p_description:'',p_contact:user.email,p_details:JSON.stringify(details),p_link:'',...extra});
 return {db,api,rpc,draft,files,snap,user,input,copied,deps,action,receive,cloud};
}
test('R3-A: receipt accepts unread originals with disabled analysis; title-page details come only from the form; one request and preserved hashes',async()=>{
 const f=await fixture();try{
  assert.equal(f.draft.reception_version,2);assert.equal((await f.action({...f.input,action:'intake-receive-state'})).data.submission.canReceive,true);
  const r=(await f.action()).data.submission;assert.equal(r.submitted,true);assert.equal(r.stage,'received');assert.equal(r.payload.route,'r3');assert.equal(r.payload.t,'');assert.equal(r.payload.n,details.n);assert.equal(r.payload.u,details.u);assert.equal(r.payload.lk,'');assert.equal(r.payload.cn,f.user.email);
  const rows=(await f.db.query('select * from studkab_request_attachments')).rows;assert.equal(rows.length,3);assert.ok(rows.every(a=>a.category==='unclassified'&&a.extracted_text===null&&f.files.some(i=>i.id===a.id&&i.file_hash===a.file_hash)));
  assert.equal((await f.db.query('select count(*) n from studkab_intake_analysis_jobs')).rows[0].n,0);assert.equal((await f.db.query('select reserved_microusd from studkab_gen_budget')).rows[0].reserved_microusd,0);
  assert.equal((await f.action()).data.submission.id,r.id);assert.equal(f.copied.length,3);assert.ok((await f.db.query('select ready_at from studkab_requests')).rows[0].ready_at);
  await assert.rejects(()=>f.db.query("insert into studkab_requirement_passports(request_id,status) values($1,'approved')",[r.id]),/INTAKE_STUDY_REQUIRED/);
 }finally{await f.db.close();}
});
test('partial copy failure creates no visible request; originals retained; saved receipt recovers lost HTTP reply',async()=>{
 const f=await fixture();try{
  let n=0;await assert.rejects(()=>f.action(f.input,f.user,{transferIntake:async()=>{if(++n===2)throw Error('storage lost');}}),/storage lost/);
  assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,0);assert.equal((await f.db.query('select count(*) n from studkab_intake_files')).rows[0].n,3);
  let lost=true;const db=async(...args)=>{const r=await f.api(...args);if(args[0]==='rpc/studkab_intake_receive_form'&&lost){lost=false;throw Error('HTTP reply lost');}return r;};
  const h=handler({...f.deps,db,auth:async()=>f.user}),req=()=>new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer valid'},body:JSON.stringify({...f.input,student:other,payload:{t:'FORGED'}})});
  assert.equal((await h(req())).status,503);const retry=await h(req());assert.equal(retry.status,200);assert.equal((await retry.json()).submission.payload.t,'');assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('pending replacements and changed revision block publication, calendar dates validated before copying',async()=>{
 const f=await fixture();try{
  for(const deadline of ['', '2026-02-30','invalid'])assert.equal((await f.action({...f.input,deadline})).status,400);
  assert.equal(f.copied.length,0);
  const replacement=await f.rpc('reserve',{p_student:student,p_draft:f.draft.id,p_name:'replacement.pdf',p_type:'application/pdf',p_size:10,p_hash:'d'.repeat(64),p_supersedes:f.files[0].id});
  assert.equal((await f.snap()).canReceive,false);assert.equal((await f.receive()).conflict,true);
  await f.rpc('finish',{p_student:student,p_draft:f.draft.id,p_file:replacement.file.id,p_hash:replacement.file.file_hash});
  const src=await f.snap();assert.equal(src.files.length,3);
  const r=await f.action({...f.input,revision:src.revision},f.user,{transferIntake:async()=>{await f.rpc('notes',{p_student:student,p_draft:f.draft.id,p_revision:(await f.snap()).revision,p_notes:'changed'});}});
  assert.equal(r.status,409);assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('SQL repeats, daily cap, deleted/reassigned receipt and browser/foreign account cannot create or disclose a request',async()=>{
 const f=await fixture();try{
  assert.equal((await f.action(f.input,{...f.user,id:other})).status,404);assert.equal((await f.action(f.input,f.user,{isMember:async()=>false})).status,403);
  assert.equal((await f.receive({p_deadline:'2026-02-30'})).invalid,true);
  const first=await f.receive();assert.equal((await f.receive()).id,first.id);
  await f.db.exec('reset role');await f.db.query('update studkab_requests set student_id=$2 where id=$1',[first.id,other]);await f.db.exec('set role service_role');
  assert.equal((await f.snap()).gone,true);assert.equal((await f.receive()).gone,true);
  for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(()=>f.snap(),/permission denied/);await assert.rejects(()=>f.receive(),/permission denied/);}
 }finally{await f.db.close();}
 const capped=await fixture();try{await capped.db.exec('reset role');await capped.db.query("insert into studkab_requests(student_id,client_id,payload) select $1,'old_'||n,'{}' from generate_series(1,30) n",[student]);await capped.db.exec('set role service_role');assert.equal((await capped.receive()).limited,true);assert.equal((await capped.db.query('select count(*) n from studkab_request_attachments')).rows[0].n,0);}finally{await capped.db.close();}
});
test('failed attachment transaction rolls back the entire receipt; membership lost during copying prevents publication',async()=>{
 const f=await fixture();try{
  await f.db.exec("reset role;create function refuse_second_original() returns trigger language plpgsql as $$ begin if new.file_name='Original1.pdf' then raise exception 'TRANSACTION_FAILURE'; end if;return new;end $$;create trigger refuse_second_original before insert on studkab_request_attachments for each row execute function refuse_second_original();set role service_role;");
  await assert.rejects(()=>f.receive(),/TRANSACTION_FAILURE/);
  assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,0);assert.equal((await f.db.query('select count(*) n from studkab_request_attachments')).rows[0].n,0);assert.equal((await f.snap()).canReceive,true);
  await f.db.exec('reset role;drop trigger refuse_second_original on studkab_request_attachments;set role service_role;');
  let revoked=false;const result=await f.action(f.input,f.user,{transferIntake:async()=>{if(!revoked){revoked=true;await f.db.exec('reset role');await f.db.query('delete from studkab_members where user_id=$1',[student]);await f.db.exec('set role service_role');}}});
  assert.equal(result.status,404);assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,0);assert.equal((await f.db.query('select count(*) n from studkab_intake_files')).rows[0].n,3);
 }finally{await f.db.close();}
});
test('R3-A: form checks run before copying — required details, cloud link host, files or link',async()=>{
 const f=await fixture();try{
  const bad=[{details:{...details,n:''}},{details:{...details,zz:'x'}},{details:'text'},{link:'http://disk.yandex.ru/d/x'},{link:'https://example.com/d/x'},{description:'x'.repeat(501)}];
  for(const change of bad)assert.equal((await f.action({...f.input,...change})).status,400,JSON.stringify(change));
  assert.equal(f.copied.length,0);assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,0);
  const r=(await f.action({...f.input,link:' https://disk.yandex.ru/d/Mt7abc '})).data.submission;assert.equal(r.payload.lk,'https://disk.yandex.ru/d/Mt7abc');
 }finally{await f.db.close();}
});
test('R3-B: closed or deleted cloud folder is refused before copying; unknown cloud answer does not block',async()=>{
 const f=await fixture();try{
  const link='https://disk.yandex.ru/d/Mt7abc';
  f.cloud.status=403;let r=await f.action({...f.input,link});assert.equal(r.status,400);assert.match(r.data.error,/закрыта/);
  f.cloud.status=404;r=await f.action({...f.input,link});assert.equal(r.status,400);assert.match(r.data.error,/не найдена/);
  assert.equal(f.copied.length,0);
  f.cloud.status=500;r=await f.action({...f.input,link});assert.equal(r.data.submission.submitted,true);assert.equal(r.data.submission.payload.lk,link);
 }finally{await f.db.close();}
});
