import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setupSQL,actor,items,fingerprint,plan,input,legacyRequest} from './material-revision-fixture.mjs';

let db;
before(async()=>{db=new PGlite();await db.exec(setupSQL());await db.exec('set role service_role');});
after(async()=>{await db?.close();});
const query=(sql,args=[])=>db.query(sql,args);
const one=async(sql,args=[])=>Object.values((await query(sql,args)).rows[0]||{})[0];
const rpc=(name,args)=>one('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
const state=(q,who=actor.executor)=>rpc('studkab_material_revision_state',[q,who]);
const revision=q=>one('select revision from studkab_requests where id=$1',[q]);
const open=async(q,cycle=randomUUID(),who=actor.executor,expected)=>rpc('studkab_material_revision_open',[q,who,cycle,'Нужны дополнительные исходные данные',expected??await revision(q)]);
const complete=async(q,cycle,who=actor.student,expected)=>rpc('studkab_material_revision_complete',[q,who,cycle,expected??await revision(q)]);
const save=async(q,fp=fingerprint,expected)=>rpc('studkab_requirement_passport_save',[q,actor.executor,'Синтетическая проверка','Учебный сценарий',items,fp,expected??await revision(q)]);
const approve=async(q,p,expected)=>rpc('studkab_requirement_passport_approve',[q,p.id,actor.executor,p.items,p.source_fingerprint,expected??await revision(q)]);
const unwrap=value=>value?.materials||value;
async function denied(action){
 let value,error;try{value=await action();}catch(e){error=e;}
 assert.ok(error||value?.error||value?.conflict||value?.locked||value?.missing,'Operation must be rejected, got '+JSON.stringify(value));
 return error||value;
}
async function attachment(q,{id=randomUUID(),supersedes=null,category='assignment',owner=actor.student,hash,cycleId}={}){
 hash??=id.replaceAll('-','').padEnd(64,'0');
 if(cycleId===undefined)cycleId=await one('select id from studkab_material_revisions where request_id=$1 and closed_at is null',[q])??null;
 await query(`insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text,supersedes,material_revision_id)
 values($1,$2,$3,$4,'synthetic.txt','text/plain',3,$5,$1::uuid::text,'Учебные материалы',$6,$7)`,[id,q,owner,category,hash,supersedes,cycleId]);
 return id;
}
async function fixture({approved=true}={}){
 const q=randomUUID();await query("insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,$1::uuid::text,$3)",[q,actor.student,{id:q,t:'Synthetic material revision',rq:'Original requirements preserved'}]);
 const a=await attachment(q);const p=await save(q);if(approved)await approve(q,p);
 return {q,a,p};
}
const start=(q,p)=>rpc('studkab_gen_start',[actor.executor,q,input,plan,p.id,'coursework',250000]);
const doc=p=>({topic:'Synthetic',reviewContext:{passportId:p.id,sourceFingerprint:p.source_fingerprint,fingerprint:'b'.repeat(64)}});
const prepare=(q,p,v=randomUUID())=>rpc('prepare_studkab_result',[q,v,actor.student,doc(p),Buffer.from('PK\x03\x04synthetic').toString('base64')]);

test('C096 independent: roles, foreign student, direct RPC and private audit',async()=>{
 const {q}=await fixture(),cycle=randomUUID();
 assert.equal(unwrap(await state(q)).canReopen,true);
 assert.equal(unwrap(await state(q,actor.student)).canReopen,false);
 await denied(()=>state(q,actor.other));await denied(()=>open(q,cycle,actor.student));await denied(()=>open(q,cycle,actor.other));
 await open(q,cycle);await denied(()=>complete(q,cycle,actor.executor));await denied(()=>complete(q,cycle,actor.other));
 assert.equal(unwrap(await state(q,actor.student)).canComplete,true);
 for(const role of ['anon','authenticated']){
  await db.exec('reset role;set role '+role);
  await denied(()=>state(q));await denied(()=>open(q,cycle));await denied(()=>complete(q,cycle));
  await denied(()=>query('select * from studkab_material_revisions'));
  await db.exec('reset role;set role service_role');
 }
 assert.equal(await one("select relrowsecurity from pg_class where relname='studkab_material_revisions'"),true);
 await complete(q,cycle);
});

test('C096 independent: open invalidates every old passport but preserves exact history and inputs',async()=>{
 const {q,a,p}=await fixture();await save(q);const before=(await query('select * from studkab_requirement_passports where request_id=$1 order by revision',[q])).rows;
 const payload=await one('select payload from studkab_requests where id=$1',[q]),cycle=randomUUID();
 await open(q,cycle);
 const after=(await query('select * from studkab_requirement_passports where request_id=$1 order by revision',[q])).rows;
 assert.equal(after.length,before.length);
 for(let i=0;i<before.length;i++)assert.deepEqual(after[i],{...before[i],status:'stale'});
 assert.deepEqual(await one('select payload from studkab_requests where id=$1',[q]),payload);
 assert.equal(await one('select count(*)::int from studkab_request_attachments where id=$1',[a]),1);
 await denied(()=>save(q));await denied(()=>approve(q,p));
 await denied(()=>query("update studkab_requirement_passports set status='approved' where id=$1",[p.id]));
 await denied(()=>start(q,p));await denied(()=>prepare(q,p));
 const newer=await attachment(q,{supersedes:a});
 assert.equal(await one('select count(*)::int from studkab_request_attachments where request_id=$1',[q]),2);
 assert.equal(await one('select supersedes from studkab_request_attachments where id=$1',[newer]),a);
 await complete(q,cycle);await denied(()=>approve(q,p));await denied(()=>prepare(q,p));await denied(()=>start(q,p));
 const fresh=await save(q,'c'.repeat(64));assert.equal((await approve(q,fresh)).status,'approved');
 assert.equal(await one('select count(*)::int from studkab_requirement_passports where request_id=$1',[q]),3);
 assert.equal((await prepare(q,fresh)).recipientId,actor.student);
});

test('C096 independent: CAS, competing cycles and network retries cannot reopen a completed cycle',async()=>{
 const {q,a}=await fixture(),cycle=randomUUID(),rev=await revision(q);
 await denied(()=>open(q,cycle,actor.executor,rev-1));
 await open(q,cycle,actor.executor,rev);await open(q,cycle,actor.executor,rev);
 assert.equal(await one('select count(*)::int from studkab_material_revisions where request_id=$1',[q]),1);
 await denied(()=>open(q,randomUUID()));
 const r=await revision(q);await attachment(q,{supersedes:a});
 await denied(()=>complete(q,cycle,actor.student,r));
 assert.equal(unwrap(await state(q)).state,'open');
 const latest=await revision(q);await complete(q,cycle,actor.student,latest);await complete(q,cycle,actor.student,latest);
 await open(q,cycle,actor.executor,rev);
 assert.notEqual(unwrap(await state(q)).state,'open');
 assert.equal(await one('select count(*)::int from studkab_material_revisions where request_id=$1',[q]),1);
 await denied(()=>query("update studkab_material_revisions set reason='Changed historical explanation' where id=$1",[cycle]));
 await denied(()=>query('delete from studkab_material_revisions where id=$1',[cycle]));
});

test('C096 independent: every generation status blocks reopening, including cancelled/stale/complete',async()=>{
 for(const status of ['queued','running','unknown','budget','complete','cancelled','stale']){
  const {q,p}=await fixture();const job=await start(q,p);assert.ok(job);
  await query('update studkab_gen_jobs set status=$2 where id=$1',[job,status]);
  const before=await revision(q);await denied(()=>open(q));
  assert.equal(await revision(q),before);
  assert.equal(await one('select status from studkab_requirement_passports where id=$1',[p.id]),'approved');
  assert.equal(unwrap(await state(q)).canReopen,false);
 }
});

test('C096 independent: even an unreviewed result blocks reopening and leaves exact bytes unchanged',async()=>{
 const {q,p}=await fixture(),v=randomUUID();const prepared=await prepare(q,p,v);assert.ok(prepared.fileHash);
 const before=await one('select row_to_json(v) from studkab_result_versions v where id=$1',[v]);
 await denied(()=>open(q));assert.equal(unwrap(await state(q)).canReopen,false);
 assert.deepEqual(await one('select row_to_json(v) from studkab_result_versions v where id=$1',[v]),before);
});

test('C096 independent: historical delivery without result_version also blocks reopening and survives upgrade',async()=>{
 const before=await one('select row_to_json(r) from studkab_results r where request_id=$1',[legacyRequest]);
 assert.equal(before.version_id,null);
 assert.equal(await one('select count(*)::int from studkab_result_versions where request_id=$1',[legacyRequest]),0);
 await denied(()=>open(legacyRequest));assert.equal(unwrap(await state(legacyRequest)).canReopen,false);
 assert.deepEqual(await one('select row_to_json(r) from studkab_results r where request_id=$1',[legacyRequest]),before);
});

test('C096 independent: upload-close order never changes a closed snapshot, categories and owner remain strict',async()=>{
 const {q,a}=await fixture(),cycle=randomUUID();await open(q,cycle);
 await denied(()=>attachment(q,{category:'sources',owner:actor.other}));
 await denied(()=>attachment(q));
 await denied(()=>attachment(q,{supersedes:a,category:'sources'}));
 const r=await revision(q);await complete(q,cycle,actor.student,r);
 await denied(()=>attachment(q,{supersedes:a}));
 assert.equal(await one('select count(*)::int from studkab_request_attachments where request_id=$1',[q]),1);
 assert.notEqual(unwrap(await state(q)).state,'open');
});

test('C096 independent: direct stale Word/generation inserts and mutable payload cannot bypass material gate',async()=>{
 const {q,p}=await fixture(),cycle=randomUUID();await open(q,cycle);
 await denied(()=>query(`insert into studkab_gen_jobs(owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd)
 values($1,$2,'forged','{}',$3,'coursework',250000)`,[actor.executor,q,p.id]));
 const old=await one('select payload from studkab_requests where id=$1',[q]);
 await denied(()=>rpc('update_studkab_request',[q,actor.student,old,{...old,t:'Unexpected field change'}]));
 assert.deepEqual(await one('select payload from studkab_requests where id=$1',[q]),old);
 assert.equal(await one('select count(*)::int from studkab_gen_jobs where request_id=$1',[q]),0);
 assert.equal(await one('select count(*)::int from studkab_result_versions where request_id=$1',[q]),0);
});

test('C096 independent: stale editor after open-close cannot save or approve, including old RPC arities',async()=>{
 const {q,p}=await fixture(),oldRevision=await revision(q),cycle=randomUUID();
 await open(q,cycle);await complete(q,cycle);
 await denied(()=>save(q,fingerprint,oldRevision));await denied(()=>approve(q,p,oldRevision));
 await denied(()=>rpc('studkab_requirement_passport_save',[q,actor.executor,'Old client','',items,fingerprint]));
 await denied(()=>rpc('studkab_requirement_passport_approve',[q,p.id,actor.executor,p.items,p.source_fingerprint]));
 assert.equal(await one('select count(*)::int from studkab_requirement_passports where request_id=$1',[q]),1);
 const fresh=await save(q,'d'.repeat(64));assert.equal(fresh.status,'draft');
 await denied(()=>approve(q,fresh,oldRevision));
 assert.equal((await approve(q,fresh)).status,'approved');
});

test('C096 independent: delayed upload from a closed cycle cannot enter a later open cycle (ABA)',async()=>{
 const {q,a}=await fixture(),oldCycle=randomUUID(),newCycle=randomUUID();
 await open(q,oldCycle);await complete(q,oldCycle);await open(q,newCycle);
 const before=await revision(q);
 await denied(()=>attachment(q,{supersedes:a,cycleId:oldCycle}));
 await denied(()=>attachment(q,{supersedes:a,cycleId:null}));
 assert.equal(await revision(q),before);
 assert.equal(await one('select count(*)::int from studkab_request_attachments where request_id=$1',[q]),1);
 const current=await attachment(q,{supersedes:a,cycleId:newCycle});
 assert.equal(await one('select material_revision_id from studkab_request_attachments where id=$1',[current]),newCycle);
 assert.equal(unwrap(await state(q)).cycleId,newCycle);
});
