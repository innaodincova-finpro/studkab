import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setupSQL,actor,items,fingerprint} from './material-revision-fixture.mjs';

test('C096 production baseline: draft intake corrections survive; any cycle freezes payload',async()=>{
 const db=new PGlite();try{
  await db.exec(setupSQL());await db.exec('set role service_role');
  const q=randomUUID(),initial={id:q,t:'Synthetic draft'},changed={id:q,t:'Synthetic correction'};
  const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
  await db.query('insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,$1::uuid::text,$3)',[q,actor.student,initial]);
  const p=await one("select studkab_requirement_passport_save($1,$2,'Requirements','',$3,$4)",[q,actor.executor,items,fingerprint]);
  const state=await one('select studkab_material_revision_state($1,$2)',[q,actor.student]);
  assert.equal(state.materials.state,'initial');assert.equal(state.materials.canUpload,true);
  const first=randomUUID();await db.query("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text) values($1,$2,$3,'data','draft.txt','text/plain',3,$4,$1::uuid::text,'abc')",[first,q,actor.student,'f'.repeat(64)]);
  assert.equal((await one('select update_studkab_request($1,$2,$3,$4)',[q,actor.student,initial,changed])).id,q);
  const rev=await one('select revision from studkab_requests where id=$1',[q]);
  await one('select studkab_requirement_passport_approve($1,$2,$3,$4,$5,$6)',[q,p.id,actor.executor,p.items,fingerprint,rev]);
  const cycle=randomUUID();await one('select studkab_material_revision_open($1,$2,$3,$4,$5)',[q,actor.executor,cycle,'Additional synthetic material',rev]);
  assert.equal((await one('select update_studkab_request($1,$2,$3,$4)',[q,actor.student,changed,{...changed,t:'Forbidden open edit'}])).locked,true);
  await one('select studkab_material_revision_complete($1,$2,$3,$4)',[q,actor.student,cycle,rev+1]);
  assert.equal((await one('select update_studkab_request($1,$2,$3,$4)',[q,actor.student,changed,{...changed,t:'Forbidden closed edit'}])).locked,true);
  assert.deepEqual(await one('select payload from studkab_requests where id=$1',[q]),changed);
 }finally{await db.close();}
});

test('C096 production baseline: prepared deletion removes cycle audit with FK triggers enabled',async()=>{
 const db=new PGlite();try{
  await db.exec(setupSQL());await db.exec('set role service_role');
  const q=randomUUID(),cycle=randomUUID(),attachment=randomUUID();
  const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
  await db.query('insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,$1::uuid::text,$3)',[q,actor.student,{id:q,t:'Synthetic deletion'}]);
  let p=await one("select studkab_requirement_passport_save($1,$2,'Requirements','',$3,$4)",[q,actor.executor,items,fingerprint]);
  await one('select studkab_requirement_passport_approve($1,$2,$3,$4,$5)',[q,p.id,actor.executor,p.items,fingerprint]);
  await one('select studkab_material_revision_open($1,$2,$3,$4,$5)',[q,actor.executor,cycle,'Additional synthetic material',0]);
  await db.query("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text,material_revision_id) values($1,$2,$3,'data','cycle.txt','text/plain',3,$4,$1::uuid::text,'abc',$5)",[attachment,q,actor.student,'e'.repeat(64),cycle]);
  await one('select studkab_material_revision_complete($1,$2,$3,$4)',[q,actor.student,cycle,2]);
  p=await one("select studkab_requirement_passport_save($1,$2,'Requirements','',$3,$4,3)",[q,actor.executor,items,fingerprint]);
  await one('select studkab_requirement_passport_approve($1,$2,$3,$4,$5,3)',[q,p.id,actor.executor,p.items,fingerprint]);
  await one('select prepare_studkab_result($1,$2,$3,$4,$5)',[q,randomUUID(),actor.student,{topic:'Synthetic',reviewContext:{passportId:p.id,sourceFingerprint:fingerprint,fingerprint:'b'.repeat(64)}},Buffer.from('PK\x03\x04synthetic').toString('base64')]);
  await assert.rejects(db.query('delete from studkab_material_revisions where id=$1',[cycle]),/permission denied|Immutable/);
  const definition=await one("select pg_get_functiondef('public.delete_studkab_request(uuid,uuid,text)'::regprocedure)");
  assert.doesNotMatch(definition,/session_replication_role/);
  await db.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
  await one('select prepare_studkab_request_delete($1)',[q]);
  const result=await one('select delete_studkab_request($1,$2,$3)',[q,actor.executor,'Delete synthetic fixture only']);
  assert.equal(result.deleted,true);assert.equal(result.counts.material_revisions,1);assert.equal(result.counts.attachments,1);
  for(const table of ['studkab_requests','studkab_request_attachments','studkab_material_revisions','studkab_requirement_passports','studkab_result_versions']){
   assert.equal(await one('select count(*)::int from '+table+' where '+(table==='studkab_requests'?'id':'request_id')+'=$1',[q]),0,table);
  }
  assert.equal(await one('show session_replication_role'),'origin');
 }finally{await db.close();}
});
