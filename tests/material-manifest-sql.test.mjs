import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setupSQL,actor,items,fingerprint,plan,input} from './material-revision-fixture.mjs';
const migration='20260923082944_c098_material_manifest.sql';
let db,legacy;
const criteria=Object.fromEntries(['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12','C13','S01','S02','S03'].map(k=>[k,{status:'pass',evidence:'Проверено по синтетическому примеру'}]));
before(async()=>{db=new PGlite();await db.exec(setupSQL());await db.exec('set role service_role');
 const q=await request(),p=await rpc('studkab_requirement_passport_save',[q,actor.executor,'Исторический','',items,fingerprint,null]);await rpc('studkab_requirement_passport_approve',[q,p.id,actor.executor,items,fingerprint,null]);await start(q,p);const version=randomUUID();const receipt=await rpc('prepare_studkab_result',[q,version,actor.student,{topic:'Historical'},'UEsDBHRlc3Q=']);const review=randomUUID();await rpc('review_studkab_result',[q,version,review,actor.executor,actor.student,receipt.fileHash,receipt.documentHash,criteria]);legacy={q,p,version,review,receipt};await db.exec('reset role');
 await db.exec(readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));await db.exec('set role service_role');});
after(async()=>await db?.close());
const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
const rpc=(name,args)=>one('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
const manifest=(change={})=>({basis:'Состав по заданию автора',requirements:[{id:'assignment',label:'Исходное задание',required:true,attachment_ids:[],answer_ids:[],payload_fields:['rq'],not_applicable_reason:'',...change}]});
async function request(){const q=randomUUID();await db.query('insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,$1::uuid::text,$3)',[q,actor.student,{id:q,rq:'Текст конкретного задания'}]);return q;}
const save=(q,m)=>rpc('studkab_requirement_passport_save',[q,actor.executor,'Паспорт','',items,fingerprint,null,m]);
const approve=(q,p,m=p.material_manifest)=>rpc('studkab_requirement_passport_approve',[q,p.id,actor.executor,p.items,fingerprint,null,m]);
const start=(q,p)=>rpc('studkab_gen_start',[actor.executor,q,input,plan,p.id,'coursework',250000]);
const check=(q,p)=>rpc('studkab_material_manifest_check',[q,p?.id??null]);
test('incomplete draft saves, but old approve signature cannot bypass manifest',async()=>{const q=await request(),p=await save(q,null);await assert.rejects(()=>approve(q,p),/MATERIAL_MANIFEST_REQUIRED/);});
test('actual textual requirement approves and starts, immutable manifest and CAS',async()=>{const q=await request(),p=await save(q,manifest());assert.deepEqual(await check(q,p),{valid:true});await assert.rejects(()=>approve(q,p,manifest({label:'Другое'})),/MATERIAL_MANIFEST_CHANGED/);await approve(q,p);await start(q,p);await assert.rejects(()=>db.query('update studkab_requirement_passports set material_manifest=$1 where id=$2',[manifest({label:'Другое'}),p.id]),/IMMUTABLE/);});
for(const [label,m,code] of [
 ['empty list',{basis:'Задание',requirements:[]},'REQUIRED'],
 ['missing basis',{...manifest(),basis:''},'REQUIRED'],
 ['no evidence',manifest({payload_fields:[]}),'MISSING'],
 ['unsupported field',manifest({payload_fields:['t']}),'INVALID'],
 ['empty actual field',manifest({payload_fields:['mn']}),'INVALID'],
 ['foreign attachment',manifest({attachment_ids:[randomUUID()]}),'INVALID'],
 ['foreign answer',manifest({answer_ids:[randomUUID()]}),'INVALID'],
 ['optional without reason',manifest({required:false,payload_fields:[]}), 'MISSING']
])test(label+' blocks approve',async()=>{const q=await request(),p=await save(q,m);assert.match((await check(q,p)).code,new RegExp(code));await assert.rejects(()=>approve(q,p),new RegExp('MATERIAL_'));});
test('explicit not applicable is accepted without dummy files',async()=>{const q=await request(),p=await save(q,manifest({required:false,payload_fields:[],not_applicable_reason:'Отдельные исходные таблицы не предусмотрены заданием'}));await approve(q,p);});
test('superseded attachment cannot support approval',async()=>{const q=await request(),a=randomUUID(),b=randomUUID();const insert=(id,prev)=>db.query("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text,supersedes) values($1,$2,$3,'assignment','test.txt','text/plain',3,$4,$1::uuid::text,'Текст',$5)",[id,q,actor.student,id.replaceAll('-','').padEnd(64,'0'),prev]);await insert(a,null);await insert(b,a);const p=await save(q,manifest({payload_fields:[],attachment_ids:[a]}));await assert.rejects(()=>approve(q,p),/INVALID/);const current=await save(q,manifest({payload_fields:[],attachment_ids:[b]}));await approve(q,current);});
test('direct Word without context is blocked even without revision cycles',async()=>{const q=await request(),p=await save(q,manifest());await approve(q,p);await assert.rejects(()=>rpc('prepare_studkab_result',[q,randomUUID(),actor.student,{topic:'test'},'UEsDBHRlc3Q=']),/Review passport changed/);});
test('new draft prevents repeated Start returning an older job',async()=>{const q=await request(),p=await save(q,manifest());await approve(q,p);await start(q,p);await save(q,null);await assert.rejects(()=>start(q,p),/MATERIAL_MANIFEST_REQUIRED/);});

test('legacy approved without manifest blocks repeated Start and delivery; old versions remain readable',async()=>{
 const {q,p,version,review,receipt}=legacy;await assert.rejects(()=>start(q,p),/MATERIAL_MANIFEST_REQUIRED/);
 await assert.rejects(()=>rpc('deliver_reviewed_studkab_result',[q,randomUUID(),version,review,actor.student,receipt.fileHash,receipt.documentHash]),/MATERIAL_MANIFEST_REQUIRED/);
 assert.equal(await one('select count(*)::int from studkab_result_versions where id=$1',[version]),1);
 const fresh=await save(q,manifest());await approve(q,fresh);
 await assert.rejects(()=>rpc('review_studkab_result',[q,version,randomUUID(),actor.executor,actor.student,receipt.fileHash,receipt.documentHash,criteria]),/Review passport changed/);
 await assert.rejects(()=>rpc('deliver_reviewed_studkab_result',[q,randomUUID(),version,review,actor.student,receipt.fileHash,receipt.documentHash]),/Review passport changed/);
 await assert.rejects(()=>db.query('insert into studkab_result_reviews(id,version_id,reviewer_id,criteria) values($1,$2,$3,$4)',[randomUUID(),version,actor.executor,criteria]),/Review passport changed/);
 await assert.rejects(()=>db.query('insert into studkab_results(request_id,delivery_id,version_id,review_id,document) values($1,$2,$3,$4,$5)',[q,randomUUID(),version,review,{topic:'Historical'}]),/Review passport changed/);
});
test('valid manifest and context support new prepare, positive review and delivery',async()=>{
 const q=await request(),p=await save(q,manifest());await approve(q,p);const version=randomUUID(),review=randomUUID();
 const document={topic:'Synthetic',reviewContext:{passportId:p.id,sourceFingerprint:fingerprint,fingerprint:'b'.repeat(64)}};
 const r=await rpc('prepare_studkab_result',[q,version,actor.student,document,'UEsDBHRlc3Q=']);assert.equal(r.versionId,version);
 const v=await rpc('review_studkab_result',[q,version,review,actor.executor,actor.student,r.fileHash,r.documentHash,criteria]);assert.equal(v.reviewId,review);
 const d=await rpc('deliver_reviewed_studkab_result',[q,randomUUID(),version,review,actor.student,r.fileHash,r.documentHash]);assert.ok(!d.error,JSON.stringify(d));
});
test('existing foreign files and answers, unanswered and wrong-author answers are rejected',async()=>{
 const own=await request(),foreign=await request(),a=randomUUID();
 await db.query("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text) values($1,$2,$3,'assignment','test.txt','text/plain',3,$4,$1::uuid::text,'Текст')",[a,foreign,actor.student,'c'.repeat(64)]);
 const p=await save(own,manifest({attachment_ids:[a]}));assert.equal((await check(own,p)).code,'MATERIAL_EVIDENCE_INVALID');
 const answer=async(q,author,content)=>{const id=randomUUID();await db.query("insert into studkab_clarifications(id,request_id,item_id,question,asked_by,answer,answer_source,answered_by,answered_at) values($1,$2,'STRUCTURE','Уточните задание',$3,$4,$5,$6,$7)",[id,q,actor.executor,content,content?'Ответ автора':null,content?author:null,content?new Date():null]);return id;};
 const foreignAnswer=await answer(foreign,actor.student,'Чужие исходные данные');
 const unanswered=await answer(own,null,null),wrongAuthor=await answer(own,actor.other,'Не ответ автора заявки');
 for(const id of [foreignAnswer,unanswered,wrongAuthor]){const v=await save(own,manifest({answer_ids:[id]}));assert.equal((await check(own,v)).code,'MATERIAL_EVIDENCE_INVALID');}
 const valid=await answer(own,actor.student,'Подтверждённые исходные данные'),v=await save(own,manifest({payload_fields:[],answer_ids:[valid]}));assert.deepEqual(await check(own,v),{valid:true});
});
test('material reopen after approval makes Start unavailable without changing history',async()=>{
 const q=await request(),p=await save(q,manifest());await approve(q,p);const before=await one('select material_manifest from studkab_requirement_passports where id=$1',[p.id]);
 await rpc('studkab_material_revision_open',[q,actor.executor,randomUUID(),'Необходимы новые исходные материалы',await one('select revision from studkab_requests where id=$1',[q])]);
 await assert.rejects(()=>start(q,p),/MATERIAL_REVISION_OPEN/);assert.deepEqual(await one('select material_manifest from studkab_requirement_passports where id=$1',[p.id]),before);
});
