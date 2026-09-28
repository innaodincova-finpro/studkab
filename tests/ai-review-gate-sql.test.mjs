import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {reassignmentSetupSQL} from './request-reassignment-fixture.mjs';
import {actor,items,fingerprint} from './material-revision-fixture.mjs';

test('AI failure blocks positive review and direct delivery on exact Word; old findings do not follow corrected Word',async()=>{
 const db=new PGlite();
 const one=async(s,a=[])=>(await db.query(s,a)).rows[0];
 const rpc=async(name,args)=>(await one('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).result;
 try{
  await db.exec(reassignmentSetupSQL());
  for(const name of ['20260923144056_c101_answered_reassignment.sql','20260923153452_c102_quality_evidence.sql',
   '20260924150000_c104_originality_policy.sql','20260924150100_originality_threshold_without_service.sql',
   '20260924170000_c109_result_passport_binding.sql','20260928054546_c156_ai_review_gate.sql'])
  await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  const c157=readFileSync(new URL('../supabase/migrations/20260928070000_c157_review_dispatch_unknown.sql',import.meta.url),'utf8');
  await db.exec(c157.slice(c157.indexOf('create or replace function public.studkab_quality_check('),c157.lastIndexOf('commit;')));
  await db.exec('set role service_role');
  const request=randomUUID(),attachment=randomUUID();
  await db.query('insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,$1::uuid::text,$3)',[request,actor.student,{rq:'Учебное задание'}]);
  await db.query("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text) values($1,$2,$3,'sources','source.txt','text/plain',3,$4,$1::uuid::text,'Доступный источник')",[attachment,request,actor.student,'c'.repeat(64)]);
  const material={basis:'Задание',requirements:[{id:'task',label:'Задание',required:true,attachment_ids:[],answer_ids:[],payload_fields:['rq'],not_applicable_reason:''}]};
  const requirements=items.map(i=>i.id==='ANTIPLAGIARISM'?{...i,text:'Оригинальность: не менее 70% в системе Учебная система.',originality:{mode:'university_threshold',service:'Учебная система',thresholdPercent:70}}:i);
  let passport=await rpc('studkab_requirement_passport_save',[request,actor.executor,'Паспорт','',requirements,fingerprint,null,material]);
  await rpc('studkab_requirement_passport_approve',[request,passport.id,actor.executor,requirements,fingerprint,null,material]);
  let document={topic:'Synthetic',reviewContext:{passportId:passport.id,sourceFingerprint:fingerprint,fingerprint:'a'.repeat(64)}};
  const prepare=async (version,bytes)=>rpc('prepare_studkab_result',[request,version,actor.student,document,bytes]);
  const version=randomUUID(),receipt=await prepare(version,'UEsDBHRlc3Q=');
  const criteria=Object.fromEntries(Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']).map(code=>[code,{status:'pass',evidence:'Проверено по заданию и Word'}]));
  const save=async (v,r)=>{
   const common=[request,v,randomUUID(),actor.executor,actor.student,passport.id,r.fileHash,r.documentHash,fingerprint];
   await rpc('studkab_quality_save',[...common,'internal_borrowing',{disposition:'pass',notes:'Доступные источники рассмотрены',scan:{fileHash:r.fileHash},scanHash:'d'.repeat(64),sourceBindings:[{id:attachment,fileHash:'c'.repeat(64)}],scanComplete:true,findingIds:[],findingDecisions:[]},null]);
   common[2]=randomUUID();await rpc('studkab_quality_save',[...common,'external_originality',{service:'Учебная система',checkId:'offline-1',checkedAt:'2026-01-01T00:00:00Z',thresholdItemId:'ANTIPLAGIARISM',thresholdBasis:'Оригинальность: не менее 70% в системе Учебная система.',thresholdMode:'university_threshold',thresholdPercent:70,actualPercent:80,requirementConfirmed:true,wordBindingConfirmed:true,disposition:'pass',notes:'Сверен отчёт и точный файл'},Buffer.from('%PDF-1.7\nsynthetic\n%%EOF').toString('base64')]);
  };
  await save(version,receipt);
  const review=async(v,r,id=randomUUID())=>rpc('review_studkab_result',[request,v,id,actor.executor,actor.student,r.fileHash,r.documentHash,criteria]);
  assert.ok((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('ai_review_required'));
  await assert.rejects(()=>review(version,receipt),/QUALITY_EVIDENCE_REQUIRED/);
  const job=randomUUID(),snapshot={input:{review_target:{versionId:version,fileHash:receipt.fileHash,passportId:passport.id}}};
  await db.query("insert into studkab_gen_jobs(id,owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd,status) values($1,$2,$3,$4,$5,$6,'coursework',250000,'running')",[job,actor.executor,request,randomUUID(),snapshot,passport.id]);
  await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state) values($1,0,'{\"id\":\"quality_review\"}','queued')",[job]);
  assert.ok((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('ai_review_open'));
  await assert.rejects(()=>review(version,receipt),/QUALITY_EVIDENCE_REQUIRED/);
  await db.query("update studkab_gen_parts set state='unknown' where job_id=$1",[job]);
  await db.query("update studkab_gen_jobs set status='unknown' where id=$1",[job]);
  assert.ok((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('ai_review_open'));
  await assert.rejects(()=>rpc('deliver_reviewed_studkab_result',[request,randomUUID(),version,randomUUID(),actor.student,receipt.fileHash,receipt.documentHash]),/QUALITY_EVIDENCE_REQUIRED/);
  const codes=Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']);
  const report={wordHash:receipt.fileHash,findings:[{code:'C05',location:'Раздел 2',requirement:'Задание',observation:'Нет вывода',status:'fail'}],coverage:{checked:['C05'],notChecked:codes.filter(c=>c!=='C05')}};
  await db.query("update studkab_gen_parts set state='done',result=$2 where job_id=$1",[job,JSON.stringify(report)]);
  await db.query("update studkab_gen_jobs set status='complete' where id=$1",[job]);
  assert.ok((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('ai_review_open'));
  await assert.rejects(()=>rpc('deliver_reviewed_studkab_result',[request,randomUUID(),version,randomUUID(),actor.student,receipt.fileHash,receipt.documentHash]),/QUALITY_EVIDENCE_REQUIRED/);
  await assert.rejects(()=>db.query('insert into studkab_result_reviews(id,version_id,reviewer_id,criteria) values($1,$2,$3,$4)',[randomUUID(),version,actor.executor,criteria]),/QUALITY_EVIDENCE_REQUIRED/);
  const revised=requirements.map(i=>i.id==='TEACHER'?{...i,text:'Уточнено требование руководителя'}:i);
  passport=await rpc('studkab_requirement_passport_save',[request,actor.executor,'Новый паспорт','',revised,fingerprint,null,material]);
  await rpc('studkab_requirement_passport_approve',[request,passport.id,actor.executor,revised,fingerprint,null,material]);
  const rebound={...document,reviewContext:{passportId:passport.id,sourceFingerprint:fingerprint,fingerprint:'e'.repeat(64)}};
  await rpc('studkab_rebind_result_passport',[request,version,actor.executor,rebound,['TEACHER'],'Сверил изменение требования с этим же точным Word']);
  document=rebound;
  assert.ok((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('ai_review_open'));
  assert.ok((await rpc('studkab_quality_check',[request,version])).blockingCodes.includes('ai_review_required'));
  const corrected=randomUUID(),newReceipt=await prepare(corrected,'UEsDBG5ldyBmaWxl');await save(corrected,newReceipt);
  assert.ok((await rpc('studkab_quality_check',[request,corrected])).blockingCodes.includes('ai_review_required'));
  const cleanJob=randomUUID(),clean={input:{review_target:{versionId:corrected,fileHash:newReceipt.fileHash,passportId:passport.id}}};
  await db.query("insert into studkab_gen_jobs(id,owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd,status) values($1,$2,$3,$4,$5,$6,'coursework',250000,'complete')",[cleanJob,actor.executor,request,randomUUID(),clean,passport.id]);
  await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state,result) values($1,0,'{\"id\":\"quality_review\"}','done',$2)",[cleanJob,JSON.stringify({...report,wordHash:newReceipt.fileHash,findings:[]})]);
  assert.equal((await rpc('studkab_quality_check',[request,corrected])).eligible,true);
  assert.ok((await review(corrected,newReceipt)).reviewId);
  assert.equal(await rpc('studkab_ai_review_clear',[JSON.stringify({...report,findings:[{...report.findings[0],status:'needs_evidence'}]}),receipt.fileHash]),true);
  assert.equal(await rpc('studkab_ai_review_clear',['not-json',receipt.fileHash]),false);
 }finally{await db.close();}
});
