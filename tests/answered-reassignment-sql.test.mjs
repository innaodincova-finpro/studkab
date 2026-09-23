import {readFileSync} from 'node:fs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {reassignmentSetupSQL} from './request-reassignment-fixture.mjs';
import {requestWorkCard} from '../scripts/request-work-card.mjs';
import {actor,items,fingerprint} from './material-revision-fixture.mjs';
let db,priorTransfer;
before(async()=>{db=new PGlite();await db.exec(reassignmentSetupSQL());priorTransfer=await fixture();await transfer(priorTransfer);await db.exec(readFileSync(new URL('../supabase/migrations/20260923144056_c101_answered_reassignment.sql',import.meta.url),'utf8'));});
after(async()=>await db?.close());
const q=(s,a=[])=>db.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]||{})[0];
const rpc=(n,a)=>one('select '+n+'('+a.map((_,i)=>'$'+(i+1)).join(',')+')',a);
const manifest={basis:'Задание',requirements:[{id:'task',label:'Задание',required:true,attachment_ids:[],answer_ids:[],payload_fields:['rq'],not_applicable_reason:''}]};
async function fixture(){
 const id=randomUUID(),from=randomUUID(),to=randomUUID();await q("insert into auth.users(id,email) values($1,$3),($2,$4)",[from,to,from+'@example.test',to+'@example.test']);await q('insert into studkab_members values($1),($2)',[from,to]);
 const payload={v:1,id:'rq-synthetic',t:'Синтетическая работа',rq:'Исходное задание',n:'',g:'',dl:'',cn:'Согласованный контакт',org:'Данные',mn:'Методика',k:'Курсовая работа',d:'Дисциплина',u:'',fc:'',kf:'',ct:'',pr:'',fo:'',co:'',s:'',fm:{mt:20,mr:20,mb:20,ml:20,fn:'Arial',sz:12,sp:1.5,ind:1.25}};
 await q('insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,$3,$4)',[id,from,payload.id,payload]);const row=(await q('select * from studkab_requests where id=$1',[id])).rows[0];
 const source={works:[],settings:{name:'Source'}},target={works:[{id:'existing',topic:'Не менять'}],tasks:[{id:'oldtask'}],settings:{name:'Target'}};
 await q("insert into app_data(user_id,app,data) values($1,'kabinet',$3),($2,'kabinet',$4)",[from,to,source,target]);await q("insert into studkab_request_reassignment_permissions values($1,$2,$3,'Разрешение синтетического переноса',null)",[id,from,to]);
 const work=requestWorkCard({...row,created_at:new Date(row.created_at).toISOString()},'w-reassigned',{attachmentCount:1});
 const a=randomUUID();await q("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text) values($1,$2,$3,'assignment','test.txt','text/plain',3,$4,$1::uuid::text,'Текст')",[a,id,from,'a'.repeat(64)]);
 const p=await rpc('studkab_requirement_passport_save',[id,actor.executor,'Паспорт','',items,fingerprint,null,manifest]);await rpc('studkab_requirement_passport_approve',[id,p.id,actor.executor,items,fingerprint,null,manifest]);
 return {id,from,to,source,target,p,a,work,payload,revision:await one('select revision from studkab_requests where id=$1',[id]),operation:randomUUID()};
}
const transfer=(f,over={})=>{const x={...f,...over};return rpc('studkab_reassign_request',[x.operation,x.id,x.from,x.to,actor.executor,'Согласованный адресный перенос',x.revision,x.sourceRev??1,x.targetRev??1,x.work]);};

async function answered(f,{pending=false}={}){
 const id=randomUUID();await rpc('studkab_clarification_ask',[f.id,actor.executor,id,'ANTIPLAGIARISM','Уточните обязательный порог оригинальности']);
 if(!pending)await rpc('studkab_clarification_answer',[f.id,f.from,id,'Требуется не менее 70 процентов','Ответ автора по заданию']);
 return id;
}
const snapshot=id=>one('select to_jsonb(c) from studkab_clarifications c where id=$1',[id]);
const makeItems=id=>items.map(x=>x.id==='ANTIPLAGIARISM'?{...x,text:'Порог оригинальности не менее 70 процентов',answer_ids:[id]}:x);
const answerManifest=id=>({...manifest,requirements:[{...manifest.requirements[0],payload_fields:[],answer_ids:[id]}]});
test('complete old-owner answer transfers unchanged; audit and historical evidence match exact row',async()=>{
 const f=await fixture(),id=await answered(f),before=await snapshot(id);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>transfer(f),/permission denied/);await db.exec('reset role');}
 const m=answerManifest(id),linked=makeItems(id);
 const old=await rpc('studkab_requirement_passport_save',[f.id,actor.executor,'Уточнённый паспорт','',linked,fingerprint,f.revision,m]);
 await rpc('studkab_requirement_passport_approve',[f.id,old.id,actor.executor,linked,fingerprint,f.revision,m]);
 await transfer(f);assert.equal((await transfer(f)).duplicate,true);assert.equal(await one('select count(*)::int from studkab_request_reassignments where request_id=$1',[f.id]),1);assert.deepEqual(await snapshot(id),before);
 assert.deepEqual(await one('select items from studkab_requirement_passports where id=$1',[old.id]),linked);
 const audit=(await q('select clarification_count,clarification_snapshot from studkab_request_reassignments where request_id=$1',[f.id])).rows[0];assert.equal(audit.clarification_count,1);
 assert.equal(audit.clarification_snapshot[id],await one("select encode(sha256(convert_to((to_jsonb(c)||jsonb_build_object('created_at',extract(epoch from c.created_at),'answered_at',extract(epoch from c.answered_at)))::text,'UTF8')),'hex') from studkab_clarifications c where id=$1",[id]));
 await assert.rejects(()=>rpc('studkab_requirement_passport_approve',[f.id,old.id,actor.executor,linked,fingerprint,f.revision+1,m]),/passport_changed/);
 const incomplete=await rpc('studkab_requirement_passport_save',[f.id,actor.executor,'Новый паспорт','',items,fingerprint,f.revision+1,m]);
 await assert.rejects(()=>rpc('studkab_requirement_passport_approve',[f.id,incomplete.id,actor.executor,items,fingerprint,f.revision+1,m]),/CLARIFICATION_UNREVIEWED/);
 const reviewed=await rpc('studkab_requirement_passport_save',[f.id,actor.executor,'Проверено повторно','',linked,fingerprint,f.revision+1,m]);
 const approved=await rpc('studkab_requirement_passport_approve',[f.id,reviewed.id,actor.executor,linked,fingerprint,f.revision+1,m]);assert.equal(approved.status,'approved');
 await assert.rejects(()=>rpc('studkab_clarification_answer',[f.id,f.from,id,'Подмена старым владельцем','Источник']),/FORBIDDEN/);
 assert.ok((await rpc('studkab_clarification_answer',[f.id,f.to,id,'Подмена новым владельцем','Источник'])).error);assert.deepEqual(await snapshot(id),before);
});
for(const kind of ['pending','foreign_answerer','foreign_asker','invalid_timestamp'])test(kind+' rejects transfer with no partial changes',async()=>{
 const f=await fixture(),id=await answered(f,{pending:kind==='pending'});
 if(kind==='foreign_answerer')await q('update studkab_clarifications set answered_by=$2 where id=$1',[id,actor.other]);
 if(kind==='foreign_asker')await q('update studkab_clarifications set asked_by=$2 where id=$1',[id,actor.other]);
 if(kind==='invalid_timestamp')await q("update studkab_clarifications set answered_at=created_at-interval '1 second' where id=$1",[id]);
 const before=await snapshot(id);await assert.rejects(()=>transfer(f),/CLARIFICATION/);assert.deepEqual(await snapshot(id),before);
 assert.equal(await one('select student_id from studkab_requests where id=$1',[f.id]),f.from);assert.equal(await one('select count(*)::int from studkab_request_reassignments where request_id=$1',[f.id]),0);
});
test('historical material reference rejects mutation, foreign request, and a later old-author row absent from snapshot',async()=>{
 const f=await fixture(),id=await answered(f);await transfer(f);
 const m=answerManifest(id),p=await rpc('studkab_requirement_passport_save',[f.id,actor.executor,'Паспорт','',makeItems(id),fingerprint,f.revision+1,m]);
 await db.exec("set timezone='Europe/Moscow'");assert.equal((await rpc('studkab_material_manifest_check',[f.id,p.id])).valid,true);await db.exec("set timezone='UTC'");
 await q("update studkab_clarifications set answer=answer||' изменено' where id=$1",[id]);assert.equal((await rpc('studkab_material_manifest_check',[f.id,p.id])).code,'MATERIAL_EVIDENCE_INVALID');
 const later=randomUUID();await q("insert into studkab_clarifications(id,request_id,item_id,question,asked_by,answer,answer_source,answered_by,answered_at) values($1,$2,'ANTIPLAGIARISM','Другой вопрос',$3,'Поздний ответ','Источник',$4,now())",[later,f.id,actor.executor,f.from]);
 const another=await rpc('studkab_requirement_passport_save',[f.id,actor.executor,'Другой паспорт','',makeItems(later),fingerprint,f.revision+1,answerManifest(later)]);assert.equal((await rpc('studkab_material_manifest_check',[f.id,another.id])).code,'MATERIAL_EVIDENCE_INVALID');
 const foreign=await fixture(),foreignId=await answered(foreign);const foreignP=await rpc('studkab_requirement_passport_save',[f.id,actor.executor,'Чужой ответ','',makeItems(foreignId),fingerprint,f.revision+1,answerManifest(foreignId)]);assert.equal((await rpc('studkab_material_manifest_check',[f.id,foreignP.id])).code,'MATERIAL_EVIDENCE_INVALID');
});
test('no-answer transfer stays compatible and snapshot is immutable',async()=>{const f=await fixture();await transfer(f);assert.equal(await one('select clarification_count from studkab_request_reassignments where request_id=$1',[f.id]),0);assert.deepEqual(await one('select clarification_snapshot from studkab_request_reassignments where request_id=$1',[f.id]),{});await assert.rejects(()=>q("update studkab_request_reassignments set clarification_snapshot='{}' where request_id=$1",[f.id]),/IMMUTABLE/);});

test('existing C100 audit gets empty snapshot without rewriting its history',async()=>{const a=(await q('select clarification_count,clarification_snapshot,from_student_id,to_student_id from studkab_request_reassignments where request_id=$1',[priorTransfer.id])).rows[0];assert.equal(a.clarification_count,0);assert.deepEqual(a.clarification_snapshot,{});assert.equal(a.from_student_id,priorTransfer.from);assert.equal(a.to_student_id,priorTransfer.to);});
