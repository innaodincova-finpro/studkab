import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('C-071 database guard rejects changed passport and preserves old deliveries/idempotence',async()=>{
 const db=new PGlite();
 try{
 await db.exec('create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);grant usage on schema public,auth to service_role;');
 for(const path of ['request-delivery.sql','result-delivery.sql','supabase/migrations/20260912094701_studkab_versioned_delivery.sql','supabase/migrations/20260914105509_studkab_requirement_passports.sql','supabase/migrations/20260918130000_review_statuses.sql','supabase/migrations/20260919124300_result_review_context_guard.sql'])await db.exec(fs.readFileSync(path,'utf8'));
 const u='11111111-1111-4111-8111-111111111111',q='22222222-2222-4222-8222-222222222222',p='33333333-3333-4333-8333-333333333333',v='44444444-4444-4444-8444-444444444444',r='55555555-5555-4555-8555-555555555555';
 await db.query('insert into auth.users values($1)',[u]);
 await db.query("insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,'test','{}')",[q,u]);
 await db.query("insert into studkab_requirement_passports(id,request_id,revision,status,title,items,source_fingerprint,created_by) values($1,$2,1,'approved','Test','[]',$3,$4)",[p,q,'a'.repeat(64),u]);
 const doc={topic:'Synthetic',reviewContext:{passportId:p,sourceFingerprint:'a'.repeat(64),fingerprint:'b'.repeat(64)}};
 const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result;
 const prepared=await rpc('prepare_studkab_result',[q,v,u,doc,Buffer.from('PK\x03\x04test').toString('base64')]);
 const codes=Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']);const criteria=Object.fromEntries(codes.map(c=>[c,{status:'pass',evidence:'Synthetic evidence page 1'}]));
 await rpc('review_studkab_result',[q,v,r,u,u,prepared.fileHash,prepared.documentHash,criteria]);
 await db.query("update studkab_requirement_passports set status='stale' where id=$1",[p]);
 const args=[q,v,v,r,u,prepared.fileHash,prepared.documentHash];
 await assert.rejects(()=>rpc('deliver_reviewed_studkab_result',args),/Review passport changed/);
 assert.equal((await db.query('select count(*)::int n from studkab_results')).rows[0].n,0);
 await db.query("update studkab_requirement_passports set status='approved' where id=$1",[p]);
 assert.equal((await rpc('deliver_reviewed_studkab_result',args)).duplicate,false);
 assert.equal((await rpc('deliver_reviewed_studkab_result',args)).duplicate,true);
 await db.query("update studkab_requirement_passports set source_fingerprint=$2 where id=$1",[p,'c'.repeat(64)]);
 await assert.rejects(()=>rpc('deliver_reviewed_studkab_result',[q,q,...args.slice(2)]),/Review passport changed/);
 assert.equal((await db.query('select count(*)::int n from studkab_results')).rows[0].n,1);
 await assert.rejects(()=>db.query("update studkab_result_versions set document='{}' where id=$1",[v]),/Immutable/);
 assert.equal((await db.query('select public.studkab_result_context_version() as version')).rows[0].version,1);
 assert.equal((await db.query("select has_function_privilege('authenticated','public.studkab_result_context_version()','EXECUTE') allowed")).rows[0].allowed,false);
 const rights=await db.query("select has_table_privilege('authenticated','studkab_result_versions','SELECT') allowed");assert.equal(rights.rows[0].allowed,false);
 }finally{await db.close();}
});
