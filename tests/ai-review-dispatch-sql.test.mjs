import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('queued review of superseded Word is stopped before reserve and paid dispatch',async()=>{
 const db=new PGlite();
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.studkab_requests(id uuid primary key,student_id uuid,payload jsonb,deleting_at timestamptz);`);
  for(const name of ['20260911195103_studkab_generation_storage_v1.sql','20260912123246_studkab_budget_reconciliation.sql',
   '20260914105509_studkab_requirement_passports.sql','20260915070508_mandatory_passport_generation_limits.sql',
   '20260915130000_studkab_generation_stop.sql','20260918092405_expose_bounded_job_release_total.sql'])
   await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  await db.exec(`create table public.studkab_result_versions(id uuid primary key,request_id uuid not null,
   revision integer not null,file_hash text not null);
   update public.studkab_gen_budget set limit_microusd=500000 where id=true;`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260928105609_c160_review_dispatch_passport_lock.sql',import.meta.url),'utf8'));
  const user=randomUUID(),request=randomUUID(),versionA=randomUUID(),versionB=randomUUID(),fp='a'.repeat(64),hashA='b'.repeat(64);
  await db.query('insert into auth.users(id) values($1)',[user]);
  await db.query("insert into studkab_requests(id,student_id,payload) values($1,$2,'{\"n\":\"Студент Тестов\"}')",[request,user]);
  const saved=(await one("select studkab_requirement_passport_save($1,$2,'Test','',$3::jsonb,$4) p",[request,user,JSON.stringify([{id:'R1'}]),fp])).p;
  await db.query('select studkab_requirement_passport_approve($1,$2,$3,$4::jsonb,$5)',[request,saved.id,user,JSON.stringify([{id:'R1'}]),fp]);
  const makeJob=async (version,hash=hashA)=>{
   const target={versionId:version,fileHash:hash,passportId:saved.id};
   const input={system:'Test',prompts:{quality_review:'Test'},material_fingerprint:fp,review_target:target};
   const plan=[{id:'quality_review',prompt:'Text',max_cost_microusd:250000,max_output_tokens:4000}];
   return (await one('select studkab_gen_start($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7) id',
    [user,request,JSON.stringify(input),JSON.stringify(plan),saved.id,'coursework',250000])).id;
  };
  await db.query('insert into studkab_result_versions(id,request_id,revision,file_hash) values($1,$2,1,$3)',[versionA,request,hashA]);
  const job=await makeJob(versionA);
  const claim=(await one('select studkab_gen_claim() c')).c;
  await db.query('insert into studkab_result_versions(id,request_id,revision,file_hash) values($1,$2,2,$3)',[versionB,request,'c'.repeat(64)]);
  const dispatched=await one('select studkab_gen_dispatch($1,$2,$3) id',[job,claim.ordinal,claim.claim]);
  assert.equal(dispatched.id,null);
  assert.equal((await one('select status from studkab_gen_jobs where id=$1',[job])).status,'stale');
  assert.equal(Number((await one('select reserved_microusd from studkab_gen_budget')).reserved_microusd),0);
  assert.equal(Number((await one('select count(*)::integer n from studkab_gen_attempts where job_id=$1',[job])).n),0);
  const jobB=await makeJob(versionB,'c'.repeat(64));
  const claimB=(await one('select studkab_gen_claim() c')).c;
  await db.query("update studkab_requests set payload='{}' where id=$1",[request]);
  assert.equal((await one('select studkab_gen_dispatch($1,$2,$3) id',[jobB,claimB.ordinal,claimB.claim])).id,null);
  assert.equal(Number((await one('select reserved_microusd from studkab_gen_budget')).reserved_microusd),0);
  await db.query('update studkab_requests set payload=$2 where id=$1',[request,{n:'Студент Тестов'}]);
  const jobC=await makeJob(versionB,'c'.repeat(64));
  const claimC=(await one('select studkab_gen_claim() c')).c;
  await db.query("update studkab_requirement_passports set status='stale' where id=$1",[saved.id]);
  assert.equal((await one('select studkab_gen_dispatch($1,$2,$3) id',[jobC,claimC.ordinal,claimC.claim])).id,null);
  assert.equal((await one('select status from studkab_gen_jobs where id=$1',[jobC])).status,'stale');
  assert.equal(Number((await one('select reserved_microusd from studkab_gen_budget')).reserved_microusd),0);
 }finally{await db.close();}
});
