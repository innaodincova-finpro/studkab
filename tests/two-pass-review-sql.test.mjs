import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {reassignmentSetupSQL} from './request-reassignment-fixture.mjs';
import {actor,items,fingerprint} from './material-revision-fixture.mjs';

test('two saved passes are required for positive evidence and neither can hide an open finding',async()=>{
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
  await db.exec(readFileSync(new URL('../supabase/migrations/20260928112143_c162_ai_visual_scope.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260917150000_studkab_preparation_diagnostics.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930095451_c177_two_pass_review.sql',import.meta.url),'utf8'));
  await db.exec('set role service_role');
  let coverage=await rpc('studkab_requirement_coverage_check',[request,version]);
  assert.equal(coverage.eligible,false);
  assert.equal(coverage.blockingCodes.length,requirements.length);
  assert.equal((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('requirement_coverage'),true);
  const external={service:'Учебная система',checkId:'offline-1',checkedAt:'2026-01-01T00:00:00Z',
   thresholdItemId:'ANTIPLAGIARISM',thresholdBasis:requirements.find(i=>i.id==='ANTIPLAGIARISM').text,
   thresholdMode:'university_threshold',thresholdPercent:70,actualPercent:80,requirementConfirmed:true,
   wordBindingConfirmed:true,reportName:'report.pdf',disposition:'pass',notes:'Сверен отчёт с точной версией Word'};
  const report=Buffer.from('%PDF-1.7\nsynthetic\n%%EOF').toString('base64');
  const saveExternal=async(payload)=>rpc('studkab_quality_save',[request,version,randomUUID(),actor.executor,
   actor.student,p.id,receipt.fileHash,receipt.documentHash,fingerprint,'external_originality',payload,report]);
  const accepted=await saveExternal(external);
  coverage=await rpc('studkab_requirement_coverage_check',[request,version]);
  assert.equal(coverage.blockingCodes.includes('ANTIPLAGIARISM'),false);
  assert.equal(coverage.evidenceIds.ANTIPLAGIARISM,accepted.id);
  await saveExternal({...external,disposition:'fail',actualPercent:50});
  coverage=await rpc('studkab_requirement_coverage_check',[request,version]);
  assert.equal(coverage.blockingCodes.includes('ANTIPLAGIARISM'),true);
  await saveExternal(external);
  const criteria=Object.fromEntries(Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']).map(k=>[k,{status:'pass',evidence:'Сверено с Word'}]));
  await assert.rejects(()=>db.query('insert into studkab_result_reviews(id,version_id,reviewer_id,criteria) values($1,$2,$3,$4)',[randomUUID(),version,actor.executor,criteria]),/QUALITY_EVIDENCE_REQUIRED/);
  await assert.rejects(()=>rpc('studkab_requirement_evidence_record',[request,version,actor.other,'WORK_TYPE','pass',source,'Word, раздел 1','']),/FORBIDDEN/);
  await assert.rejects(()=>rpc('studkab_requirement_evidence_record',[request,version,actor.executor,'WORK_TYPE','pass',source,'','']),/REQUIREMENT_EVIDENCE_INVALID/);
  await assert.rejects(()=>rpc('studkab_requirement_evidence_record',[request,version,actor.executor,'WORK_TYPE','pass',source,'Word, раздел 1','Проверено']),/REQUIREMENT_EVIDENCE_INVALID/);
  const job=randomUUID(),reviewRows=requirements.map((item,index)=>({id:item.id,
   status:item.id==='ANTIPLAGIARISM'?'not_checked':'pass',sourceId:source,
   sourceQuote:'Точное основание из материала '+(index+1),wordQuote:'Проверяемый фрагмент точного Word '+(index+1),
   wordLocator:'раздел '+(index+1),explanation:'Сверено с исходным материалом и текущим Word'}));
  const snapshot={input:{review_protocol:2,review_target:{versionId:version,fileHash:receipt.fileHash,passportId:p.id}}};
  await db.query("insert into studkab_gen_jobs(id,owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd,status) values($1,$2,$3,$4,$5,$6,'coursework',250000,'complete')",[job,actor.executor,request,randomUUID(),snapshot,p.id]);
  const codes=['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12','C13','S01','S02','S03'];
  const result={wordHash:receipt.fileHash,findings:[],coverage:{checked:[],notChecked:codes},requirements:reviewRows};
  await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state,result) values($1,1,'{\"id\":\"quality_review\"}','done',$2)",[job,JSON.stringify(result)]);
  await assert.rejects(()=>rpc('studkab_requirement_review_ingest',[request,version,job,actor.executor,reviewRows]),/TWO_PASS_REQUIRED/);
  await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state,result) values($1,0,'{\"id\":\"quality_evidence\"}','done',$2)",[job,JSON.stringify(result)]);
  const negative={...result,requirements:reviewRows.map((r,index)=>index? r:{...r,status:'not_checked'})};
  assert.equal(await rpc('studkab_two_pass_consistent',[JSON.stringify(negative),JSON.stringify(result),receipt.fileHash]),false);
  assert.equal(await rpc('studkab_two_pass_consistent',['invalid',JSON.stringify(result),receipt.fileHash]),false);
  assert.equal(await rpc('studkab_two_pass_consistent',[JSON.stringify(result),JSON.stringify(result),'f'.repeat(64)]),false);
  assert.equal(await rpc('studkab_two_pass_job_clear',[job,receipt.fileHash]),true);
  assert.equal((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('ai_review_required'),false);
  const makeJob=async(protocol,first,final,firstState='done',jobState='complete')=>{
   const id=randomUUID(),snap={input:{...snapshot.input,review_protocol:protocol}};
   await db.query("insert into studkab_gen_jobs(id,owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd,status) values($1,$2,$3,$4,$5,$6,'coursework',250000,$7)",[id,actor.executor,request,randomUUID(),snap,p.id,jobState]);
   await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state,result) values($1,1,'{\"id\":\"quality_review\"}','done',$2)",[id,JSON.stringify(final)]);
   if(first)await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state,result) values($1,0,'{\"id\":\"quality_evidence\"}',$2,$3)",[id,firstState,JSON.stringify(first)]);
   return id;
  };
  const blockedJob=randomUUID(),claim=randomUUID();
  await db.query("insert into studkab_gen_jobs(id,owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd,status) values($1,$2,$3,$4,$5,$6,'coursework',250000,'running')",[blockedJob,actor.executor,request,randomUUID(),snapshot,p.id]);
  await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state,result) values($1,0,'{\"id\":\"quality_evidence\"}','done',$2)",[blockedJob,JSON.stringify(result)]);
  await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state,claim,lease_until) values($1,1,'{\"id\":\"quality_review\"}','claimed',$2,now()+interval '5 minutes')",[blockedJob,claim]);
  assert.equal(await rpc('studkab_gen_fail_preparation',[blockedJob,1,claim,'REVIEW_FIRST_INVALID']),'REVIEW_FIRST_INVALID');
  assert.equal((await one('select failure_stage,failure_reason from studkab_gen_parts where job_id=$1 and ordinal=1',[blockedJob])).failure_stage,'preparation');
  assert.equal((await one('select count(*)::int n from studkab_gen_attempts where job_id=$1',[blockedJob])).n,0);
  const legacy=await makeJob(null,null,result);
  assert.equal(await rpc('studkab_two_pass_job_clear',[legacy,receipt.fileHash]),false);
  await assert.rejects(()=>rpc('studkab_requirement_review_ingest',[request,version,legacy,actor.executor,reviewRows]),/TWO_PASS_REQUIRED/);
  const mismatch=await makeJob(2,negative,result);
  await assert.rejects(()=>rpc('studkab_requirement_review_ingest',[request,version,mismatch,actor.executor,reviewRows]),/TWO_PASS_REQUIRED/);
  const hiddenFinding={code:'C05',status:'fail',location:'Глава 2',requirement:'Задание',observation:'Нет обоснованного вывода'};
  const hidden=await makeJob(2,{...result,findings:[hiddenFinding]},result);
  assert.equal(await rpc('studkab_two_pass_job_clear',[hidden,receipt.fileHash]),false);
  const firstFailed={...result,requirements:reviewRows.map((r,index)=>index?r:{...r,status:'fail'})};
  const bothOpen=await makeJob(2,firstFailed,negative);
  assert.equal(await rpc('studkab_two_pass_job_clear',[bothOpen,receipt.fileHash]),false);
  const unknown=await makeJob(2,result,result,'unknown');
  assert.equal(await rpc('studkab_two_pass_job_clear',[unknown,receipt.fileHash]),false);
  await assert.rejects(()=>rpc('studkab_requirement_review_ingest',[request,version,unknown,actor.executor,reviewRows]),/TWO_PASS_REQUIRED/);
  assert.equal((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('ai_review_open'),true);
  const retained=await makeJob(2,result,result,'done','unknown');
  await db.exec('reset role');
  assert.equal(await rpc('studkab_gen_recover_unknown',[]),0);
  assert.equal((await one('select status from studkab_gen_jobs where id=$1',[retained])).status,'unknown');
  assert.equal((await one('select state from studkab_gen_parts where job_id=$1 and ordinal=0',[unknown])).state,'unknown');
  await db.exec('set role service_role');

  await assert.rejects(()=>rpc('studkab_requirement_review_ingest',[request,version,job,actor.other,reviewRows]),/FORBIDDEN/);
  await assert.rejects(()=>rpc('studkab_requirement_review_ingest',[request,version,job,actor.executor,reviewRows.slice(1)]),/REQUIREMENT_REVIEW_STALE/);
  assert.equal((await rpc('studkab_requirement_review_ingest',[request,version,job,actor.executor,reviewRows])).items,requirements.length);
  await rpc('studkab_requirement_review_ingest',[request,version,job,actor.executor,reviewRows]);
  assert.equal((await one('select count(*)::int n from studkab_result_requirement_evidence where review_job_id=$1',[job])).n,requirements.length);
  coverage=await rpc('studkab_requirement_coverage_check',[request,version]);
  assert.equal(coverage.eligible,true);
  assert.equal(Object.keys(coverage.evidenceIds).length,requirements.length);
  const proposal={_mode:'passport_coverage_v1',bindingId:coverage.bindingId,evidenceIds:coverage.evidenceIds};
  assert.equal(await rpc('studkab_valid_result_review',[request,version,proposal]),true);
  assert.equal(await rpc('studkab_valid_result_review',[request,version,{...proposal,evidenceIds:{}}]),false);
  assert.equal(await rpc('studkab_valid_result_review',[request,version,criteria]),false);
  await rpc('studkab_requirement_evidence_record',[request,version,actor.executor,'WORK_TYPE','fail',source,'Word, раздел 1','Несовпадение']);
  coverage=await rpc('studkab_requirement_coverage_check',[request,version]);
  assert.deepEqual(coverage.blockingCodes,['WORK_TYPE']);
  assert.equal(await rpc('studkab_valid_result_review',[request,version,proposal]),false);
  assert.equal((await rpc('studkab_quality_check',[request,version])).eligible,false);
  assert.equal((await one('select count(*)::int n from studkab_result_requirement_snapshots where version_id=$1',[version])).n,1);
  assert.equal((await one('select file_hash from studkab_result_requirement_snapshots where version_id=$1',[version])).file_hash,receipt.fileHash);
  await db.exec('reset role');
  assert.equal((await one("select has_function_privilege('authenticated','public.studkab_two_pass_job_clear(uuid,text)','EXECUTE') allowed")).allowed,false);
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
