import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const files=[
 'supabase/migrations/20260911195103_studkab_generation_storage_v1.sql',
 'supabase/migrations/20260912123246_studkab_budget_reconciliation.sql',
 'supabase/migrations/20260914105509_studkab_requirement_passports.sql',
 'supabase/migrations/20260915070508_mandatory_passport_generation_limits.sql',
 'supabase/migrations/20260915072854_add_gen_job_passport_index.sql',
 'supabase/migrations/20260915130000_studkab_generation_stop.sql',
 'supabase/migrations/20260915130100_studkab_production_drift_recorded.sql',
 'supabase/migrations/20260915130200_studkab_unknown_fully_retained.sql',
 'supabase/migrations/20260917150000_studkab_preparation_diagnostics.sql'
];

test('preparation failure is atomic, diagnostic and terminal under maintenance',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema auth;create table auth.users(id uuid primary key);
   create table public.studkab_requests(id uuid primary key,student_id uuid,payload jsonb);`);
  for(const file of files)await db.exec(fs.readFileSync(file,'utf8'));
  const owner='11111111-1111-4111-8111-111111111111',request='22222222-2222-4222-8222-222222222222';
  await db.query('insert into auth.users(id) values($1)',[owner]);
  await db.query("insert into studkab_gen_jobs(owner_id,request_id,version,snapshot,status) values($1,$2,'v','{}','running')",[owner,request]);
  const job=(await db.query('select id from studkab_gen_jobs')).rows[0].id;
  const claim='33333333-3333-4333-8333-333333333333';
  await db.query("insert into studkab_gen_parts(job_id,ordinal,spec,state,claim,lease_until) values($1,0,'{}','claimed',$2,now()+interval '5 minutes')",[job,claim]);
  assert.equal((await db.query("select studkab_gen_fail_preparation($1,0,$2,'CONTEXT_TOO_BIG') value",[job,claim])).rows[0].value,'CONTEXT_TOO_BIG');
  const part=(await db.query('select state,failure_stage,failure_reason,failure_count,failure_at is not null as dated from studkab_gen_parts')).rows[0];
  assert.deepEqual(part,{state:'unknown',failure_stage:'preparation',failure_reason:'CONTEXT_TOO_BIG',failure_count:1,dated:true});
  assert.equal((await db.query('select studkab_gen_maintenance() value')).rows[0].value.vozobnovleno_chastey,0);
  assert.equal((await db.query('select count(*)::int n from studkab_gen_recoveries')).rows[0].n,0);
  assert.equal((await db.query('select status from studkab_gen_jobs')).rows[0].status,'unknown');
  await assert.rejects(db.query("select studkab_gen_fail_preparation($1,0,$2,'PRIVATE_ERROR')",[job,claim]),/INVALID_PREPARATION_REASON/);
 }finally{await db.close();}
});
