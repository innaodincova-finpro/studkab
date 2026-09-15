import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';

const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema auth;create table auth.users(id uuid primary key);
create table public.studkab_requests(id uuid primary key,student_id uuid,payload jsonb);`);
for(const file of [
 'supabase/migrations/20260911195103_studkab_generation_storage_v1.sql',
 'supabase/migrations/20260914105509_studkab_requirement_passports.sql',
 'supabase/migrations/20260915050303_mandatory_passport_generation_limits.sql'
])await db.exec(fs.readFileSync(file,'utf8'));
await db.exec('update studkab_gen_budget set limit_microusd=1000000 where id=true');

const user='11111111-1111-4111-8111-111111111111';
const request='33333333-3333-4333-8333-333333333333';
const fp='a'.repeat(64),items=[{id:'R1'}];
await db.query('insert into auth.users(id) values($1)',[user]);
await db.query("insert into studkab_requests(id,student_id,payload) values($1,$2,'{}')",[request,user]);
const saved=(await db.query("select studkab_requirement_passport_save($1,$2,'T','',$3::jsonb,$4) p",[request,user,JSON.stringify(items),fp])).rows[0].p;
await db.query('select studkab_requirement_passport_approve($1,$2,$3,$4::jsonb,$5)',[request,saved.id,user,JSON.stringify(items),fp]);
const input={system:'s',prompts:{a:'x',b:'y'},material_fingerprint:fp};
const plan=[{id:'a',prompt:'x',max_cost_microusd:250000,max_output_tokens:4000},{id:'b',prompt:'y',max_cost_microusd:250000,max_output_tokens:4000}];
const job=(await db.query('select studkab_gen_start($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7) id',[user,request,JSON.stringify(input),JSON.stringify(plan),saved.id,'coursework',250000])).rows[0].id;
let claim=(await db.query('select studkab_gen_claim() c')).rows[0].c;
const first=(await db.query('select studkab_gen_dispatch($1,$2,$3) id',[job,claim.ordinal,claim.claim])).rows[0].id;
if(!first)throw Error('FIRST_RESERVATION_BLOCKED');
await db.query("select studkab_gen_settle($1,0,$2,$3,'done','{}')",[job,claim.claim,first]);
claim=(await db.query('select studkab_gen_claim() c')).rows[0].c;
const second=(await db.query('select studkab_gen_dispatch($1,$2,$3) id',[job,claim.ordinal,claim.claim])).rows[0].id;
if(!second)throw Error('DYNAMIC_RESERVATION_BLOCKED');
const reserved=(await db.query('select reserved_microusd from studkab_gen_budget where id=true')).rows[0].reserved_microusd;
if(reserved<=0||reserved>=250000)throw Error('FIXED_RESERVATION_REMAINS');
console.log('PASS C-045 PostgreSQL: passport fingerprint accepted; two requests use calculated reserve below the USD 0.25 work ceiling');
await db.close();
