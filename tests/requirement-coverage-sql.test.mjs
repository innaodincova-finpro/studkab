import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {reassignmentSetupSQL} from './request-reassignment-fixture.mjs';
import {actor,items,fingerprint} from './material-revision-fixture.mjs';

test('current passport items need independent, version-bound evidence before any positive delivery',async()=>{
 const db=new PGlite();
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const rpc=async(name,args)=>(await one('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).result;
 try{
  await db.exec(reassignmentSetupSQL());
  for(const file of ['20260923144056_c101_answered_reassignment.sql','20260923153452_c102_quality_evidence.sql','20260924150000_c104_originality_policy.sql','20260924150100_originality_threshold_without_service.sql','20260924170000_c109_result_passport_binding.sql','20260928054546_c156_ai_review_gate.sql','20260928070000_c157_review_dispatch_unknown.sql'])
   await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  const request=randomUUID(),version=randomUUID(),source=randomUUID();
  await db.exec('set role service_role');
  await db.query('insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,$1::uuid::text,$3)',[request,actor.student,{rq:'Синтетическое задание',n:'Студент'}]);
  await db.query("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text) values($1,$2,$3,'assignment','task.txt','text/plain',3,$4,$1::uuid::text,'Учебное условие')",[source,request,actor.student,'c'.repeat(64)]);
  const manifest={basis:'Задание',requirements:[{id:'task',label:'Задание',required:true,attachment_ids:[],answer_ids:[],payload_fields:['rq'],not_applicable_reason:''}]};
  const requirements=items.map((i,n)=>i.id==='ANTIPLAGIARISM'
   ?{...i,source:'Задание, раздел '+(n+1),source_attachment_id:source,text:'Оригинальность: не менее 70% в системе Учебная система.',originality:{mode:'university_threshold',service:'Учебная система',thresholdPercent:70}}
   :{...i,source:'Задание, раздел '+(n+1),source_attachment_id:source});
  const p=await rpc('studkab_requirement_passport_save',[request,actor.executor,'Паспорт','',requirements,fingerprint,null,manifest]);
  await rpc('studkab_requirement_passport_approve',[request,p.id,actor.executor,requirements,fingerprint,null,manifest]);
  const doc={topic:'Тест',reviewContext:{passportId:p.id,sourceFingerprint:fingerprint,fingerprint:'b'.repeat(64)}};
  const receipt=await rpc('prepare_studkab_result',[request,version,actor.student,doc,'UEsDBHRlc3Q=']);
  await db.exec('reset role');
  await db.exec(readFileSync(new URL('../supabase/migrations/20260929062054_c177_passport_coverage.sql',import.meta.url),'utf8'));
  await db.exec('set role service_role');
  let coverage=await rpc('studkab_requirement_coverage_check',[request,version]);
  assert.equal(coverage.eligible,false);
  assert.equal(coverage.blockingCodes.length,requirements.length);
  assert.equal((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('requirement_coverage'),true);
  const criteria=Object.fromEntries(Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']).map(k=>[k,{status:'pass',evidence:'Сверено с Word'}]));
  await assert.rejects(()=>db.query('insert into studkab_result_reviews(id,version_id,reviewer_id,criteria) values($1,$2,$3,$4)',[randomUUID(),version,actor.executor,criteria]),/QUALITY_EVIDENCE_REQUIRED/);
  await assert.rejects(()=>rpc('studkab_requirement_evidence_record',[request,version,actor.other,'WORK_TYPE','pass',source,'Word, раздел 1','']),/FORBIDDEN/);
  await assert.rejects(()=>rpc('studkab_requirement_evidence_record',[request,version,actor.executor,'WORK_TYPE','pass',source,'','']),/REQUIREMENT_EVIDENCE_INVALID/);
  for(const [index,item] of requirements.entries()){
   await rpc('studkab_requirement_evidence_record',[request,version,actor.executor,item.id,'pass',source,'Word, раздел '+(index+1),'Проверено']);
  }
  coverage=await rpc('studkab_requirement_coverage_check',[request,version]);
  assert.equal(coverage.eligible,true);
  assert.equal(Object.keys(coverage.evidenceIds).length,requirements.length);
  await rpc('studkab_requirement_evidence_record',[request,version,actor.executor,'WORK_TYPE','fail',source,'Word, раздел 1','Несовпадение']);
  assert.deepEqual((await rpc('studkab_requirement_coverage_check',[request,version])).blockingCodes,['WORK_TYPE']);
  assert.equal((await rpc('studkab_quality_check',[request,version])).eligible,false);
  assert.equal((await one('select count(*)::int n from studkab_result_requirement_snapshots where version_id=$1',[version])).n,1);
  assert.equal((await one('select file_hash from studkab_result_requirement_snapshots where version_id=$1',[version])).file_hash,receipt.fileHash);
  const job=randomUUID(),reviewRows=requirements.map((item,index)=>({id:item.id,
   status:item.id==='ANTIPLAGIARISM'?'not_checked':'pass',sourceId:source,
   sourceQuote:'Точное основание из материала '+(index+1),wordQuote:'Проверяемый фрагмент точного Word '+(index+1),
   wordLocator:'раздел '+(index+1),explanation:'Сверено с исходным материалом и текущим Word'}));
  const snapshot={input:{review_target:{versionId:version,fileHash:receipt.fileHash,passportId:p.id}}};
  await db.query("insert into studkab_gen_jobs(id,owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd,status) values($1,$2,$3,$4,$5,$6,'coursework',250000,'complete')",[job,actor.executor,request,randomUUID(),snapshot,p.id]);
  await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state,result) values($1,0,'{\"id\":\"quality_review\"}','done',$2)",[job,JSON.stringify({requirements:reviewRows})]);
  await assert.rejects(()=>rpc('studkab_requirement_review_ingest',[request,version,job,actor.other,reviewRows]),/FORBIDDEN/);
  await assert.rejects(()=>rpc('studkab_requirement_review_ingest',[request,version,job,actor.executor,reviewRows.slice(1)]),/REQUIREMENT_REVIEW_STALE/);
  assert.equal((await rpc('studkab_requirement_review_ingest',[request,version,job,actor.executor,reviewRows])).items,requirements.length);
  await rpc('studkab_requirement_review_ingest',[request,version,job,actor.executor,reviewRows]);
  assert.equal((await one('select count(*)::int n from studkab_result_requirement_evidence where review_job_id=$1',[job])).n,requirements.length);
  assert.deepEqual((await rpc('studkab_requirement_coverage_check',[request,version])).blockingCodes,['ANTIPLAGIARISM']);
  await db.exec('reset role');
  assert.equal((await one("select has_table_privilege('service_role','public.studkab_result_requirement_evidence','INSERT') allowed")).allowed,false);
  assert.equal((await one("select has_function_privilege('authenticated','public.studkab_requirement_evidence_record(uuid,uuid,uuid,text,text,text,text,text)','EXECUTE') allowed")).allowed,false);
  await db.exec('set role service_role');
  await db.exec("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
  await rpc('prepare_studkab_request_delete',[request]);
  await rpc('delete_studkab_request',[request,actor.executor,'Удаление синтетического графа и свидетельств']);
  assert.equal((await one('select count(*)::int n from studkab_result_requirement_snapshots where version_id=$1',[version])).n,0);
  assert.equal((await one('select count(*)::int n from studkab_result_requirement_evidence')).n,0);
 }finally{await db.close();}
});
