import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {reassignmentSetupSQL} from './request-reassignment-fixture.mjs';
import {requestWorkCard} from '../scripts/request-work-card.mjs';
import {actor,items,fingerprint} from './material-revision-fixture.mjs';
let db;
before(async()=>{db=new PGlite();await db.exec(reassignmentSetupSQL());});
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
test('admin-only transfer preserves history and existing cloud; duplicate operation does not copy twice',async()=>{const f=await fixture();for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>transfer(f),/permission denied/);await db.exec('reset role');}const r=await transfer(f);assert.equal(r.reassigned,true);assert.equal((await transfer(f)).duplicate,true);const saved=await one("select data from app_data where user_id=$1 and app='kabinet'",[f.to]);assert.deepEqual(saved,{...f.target,works:[...f.target.works,f.work]});assert.deepEqual(await one("select data from app_data where user_id=$1 and app='kabinet'",[f.from]),f.source);assert.equal(await one('select student_id from studkab_request_attachments where id=$1',[f.a]),f.from);assert.equal(await one('select status from studkab_requirement_passports where id=$1',[f.p.id]),'stale');assert.deepEqual(await one('select payload from studkab_requests where id=$1',[f.id]),f.payload);});
test('CAS, missing permission, changed work and operation conflicts fail atomically',async()=>{const f=await fixture();for(const change of [{revision:f.revision+1},{targetRev:2},{sourceRev:2},{work:{...f.work,student:'Подмена'}}])await assert.rejects(()=>transfer(f,change),/REASSIGNMENT_/);assert.equal(await one('select student_id from studkab_requests where id=$1',[f.id]),f.from);assert.equal(await one('select count(*)::int from studkab_request_reassignments where request_id=$1',[f.id]),0);await q('update studkab_request_reassignment_permissions set revoked_at=now() where request_id=$1',[f.id]);await assert.rejects(()=>transfer(f),/NOT_ALLOWED/);});
test('post-transfer stale editor and payload updates blocked; new owner replaces through exact provenance',async()=>{const f=await fixture();await transfer(f);await db.exec('set role service_role');const missing=await rpc('studkab_requirement_passport_save',[f.id,actor.executor,'Старая форма','',items,fingerprint,null,manifest]);assert.ok(missing.error);const stale=await rpc('studkab_requirement_passport_save',[f.id,actor.executor,'Старая форма','',items,fingerprint,f.revision,manifest]);assert.ok(stale.error);assert.equal((await rpc('update_studkab_request',[f.id,f.to,f.payload,{...f.payload,t:'Другой текст'}])).locked,true);const initial=await rpc('studkab_material_revision_state',[f.id,actor.executor]);assert.equal(initial.materials.state,'locked');assert.equal(initial.materials.canReopen,true);
 await assert.rejects(()=>q("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text,supersedes) values($1,$2,$3,'assignment','bad.txt','text/plain',3,$4,$1::uuid::text,'Текст',$5)",[randomUUID(),f.id,f.to,'c'.repeat(64),f.a]),/Preparation already started/);
 const revision=await one('select revision from studkab_requests where id=$1',[f.id]),cycle=randomUUID();await rpc('studkab_material_revision_open',[f.id,actor.executor,cycle,'Дополнить исходные материалы',revision]);const id=randomUUID();await q("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text,supersedes,material_revision_id) values($1,$2,$3,'assignment','new.txt','text/plain',3,$4,$1::uuid::text,'Новый текст',$5,$6)",[id,f.id,f.to,'b'.repeat(64),f.a,cycle]);assert.equal(await one('select student_id from studkab_request_attachments where id=$1',[f.a]),f.from);await db.exec('reset role');});
test('any material cycle blocks transfer; audit cannot be edited',async()=>{const f=await fixture();await rpc('studkab_material_revision_open',[f.id,actor.executor,randomUUID(),'Нужно дополнение материалов',f.revision]);await assert.rejects(async()=>transfer(f,{revision:await one('select revision from studkab_requests where id=$1',[f.id])}),/HISTORY/);const other=await fixture();await transfer(other);await assert.rejects(()=>q('update studkab_request_reassignments set reason=reason where request_id=$1',[other.id]),/IMMUTABLE/);});

test('existing clarification, output and grant history block transfer before any mutation',async()=>{
 for(const kind of ['clarification','version','grant']){
  const f=await fixture();
  if(kind==='clarification')await q("insert into studkab_clarifications(id,request_id,item_id,question,asked_by) values($1,$2,'STRUCTURE','Уточните структуру',$3)",[randomUUID(),f.id,actor.executor]);
  if(kind==='grant')await q("insert into studkab_test_request_grants(request_id,recipient_id,reason) values($1,$2,'Прежний допуск к тестовой передаче')",[f.id,f.from]);
  if(kind==='version')await rpc('prepare_studkab_result',[f.id,randomUUID(),f.from,{topic:'Synthetic',reviewContext:{passportId:f.p.id,sourceFingerprint:fingerprint,fingerprint:'b'.repeat(64)}},'UEsDBHRlc3Q=']);
  await assert.rejects(()=>transfer(f),/HISTORY/);assert.equal(await one('select student_id from studkab_requests where id=$1',[f.id]),f.from);
 }
});
test('cloud collision rejects, and prepared deletion counts and removes transfer history',async()=>{
 const f=await fixture();await q("update app_data set data=jsonb_set(data,'{works}',data->'works'||$2::jsonb) where user_id=$1",[f.to,JSON.stringify([f.work])]);await assert.rejects(()=>transfer(f),/WORK_CONFLICT/);
 const clean=await fixture();await transfer(clean);await db.exec("set role service_role;select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");await rpc('prepare_studkab_request_delete',[clean.id]);const r=await rpc('delete_studkab_request',[clean.id,actor.executor,'Удалить синтетическую проверку']);assert.equal(r.deleted,true);assert.equal(r.counts.reassignments,1);assert.equal(r.counts.reassignmentPermissions,1);await db.exec('reset role');
});
