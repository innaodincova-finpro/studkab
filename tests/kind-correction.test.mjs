import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setupSQL,actor} from './material-revision-fixture.mjs';
import {kindCorrectionAction} from '../supabase/functions/studkab-requests/kind-correction.mjs';

let db;
before(async()=>{
 db=new PGlite();await db.exec(setupSQL());
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260924043558_c105_request_kind_correction.sql',import.meta.url),'utf8'));
 await db.exec('set role service_role');
});
after(async()=>db?.close());
const q=(sql,args=[])=>db.query(sql,args);
const one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]||{})[0];
const rpc=(args)=>one('select studkab_request_kind_correct('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
async function fixture(){
 const request=randomUUID(),assignment=randomUUID();
 await q("insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,$3,$4)",[request,actor.student,request,{id:request,t:'Учебная работа',k:'Контрольная работа'}]);
 await q("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text) values($1,$2,$3,'assignment','Задание.txt','text/plain',10,$4,$5,'Практическая работа: выполнить тестирование')",[assignment,request,actor.student,'a'.repeat(64),assignment]);
 return {request,assignment,revision:await one('select revision from studkab_requests where id=$1',[request])};
}
const args=(f,op=randomUUID(),actorId=actor.executor)=>[op,f.request,actorId,f.assignment,f.revision,'Контрольная работа','Практическая работа','Исправление по приложенному заданию'];

test('C105 requires current assignment and revision; stores history and stales passport',async()=>{
 const f=await fixture(),p=randomUUID();
 await q("insert into studkab_requirement_passports(id,request_id,revision,status,title,items,source_fingerprint,created_by) values($1,$2,1,'approved','Учебный паспорт','[]',$3,$4)",[p,f.request,'a'.repeat(64),actor.executor]);
 const op=randomUUID(),a=args(f,op);
 assert.equal((await rpc([...a.slice(0,3),randomUUID(),...a.slice(4)])).error,'Актуальное задание не подтверждает вид работы');
 await assert.rejects(()=>rpc([...a.slice(0,2),actor.other,...a.slice(3)]),/FORBIDDEN/);
 assert.match((await rpc([...a.slice(0,4),f.revision+1,...a.slice(5)])).error,/изменилась/);
 const result=await rpc(a);assert.equal(result.corrected,true);assert.equal(result.duplicate,false);
 assert.deepEqual(await one('select payload from studkab_request_payload_history where request_id=$1 order by id desc limit 1',[f.request]),{id:f.request,t:'Учебная работа',k:'Контрольная работа'});
 assert.equal(await one("select payload->>'k' from studkab_requests where id=$1",[f.request]),'Практическая работа');
 assert.equal(await one('select status from studkab_requirement_passports where id=$1',[p]),'stale');
 assert.equal((await rpc(a)).duplicate,true);
 assert.equal(await one('select count(*)::int from studkab_request_payload_history where request_id=$1 and correction_operation=$2',[f.request,op]),1);
});

test('C105 rejects superseded assignment',async()=>{
 const f=await fixture(),newAssignment=randomUUID();
 await q("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text,supersedes) values($1,$2,$3,'assignment','Новое задание.txt','text/plain',10,$4,$5,'Контрольная работа',$6)",[newAssignment,f.request,actor.student,'b'.repeat(64),newAssignment,f.assignment]);
 f.revision=await one('select revision from studkab_requests where id=$1',[f.request]);
 assert.match((await rpc(args(f))).error,/задание/);
});

test('C105 API binds actor to session and rejects malformed or foreign requests',async()=>{
 const f=await fixture(),calls=[];
 const deps={config:async()=>({executor_email:'executor@example.test'}),db:async(path,method,body)=>{calls.push(body);return {corrected:true,revision:f.revision+1};}};
 const input={action:'request-kind-correct',id:f.request,operationId:randomUUID(),assignmentId:f.assignment,expectedRevision:f.revision,expectedKind:'Контрольная работа',newKind:'Практическая работа',reason:'Исправление по приложенному заданию',actorId:actor.other};
 assert.equal((await kindCorrectionAction(input,{id:actor.other,email:'other@example.test'},deps)).status,403);
 assert.equal((await kindCorrectionAction({...input,assignmentId:'invalid'},{id:actor.executor,email:'executor@example.test'},deps)).status,400);
 assert.equal((await kindCorrectionAction(input,{id:actor.executor,email:'executor@example.test'},deps)).status,200);
 assert.equal(calls[0].p_actor,actor.executor);
});
