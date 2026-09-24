import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {validateReviewNotes,validateReview,resultAction,validateResult} from '../supabase/functions/studkab-requests/results.mjs';
const notes={C12:{status:'manual',evidence:'Сверить фактические страницы',section:'Основной текст'}};
test('C089 notes require location and blocker, never qualify as approval',()=>{
 assert.deepEqual(validateReviewNotes(notes),notes);
 assert.throws(()=>validateReview(notes));
 for(const value of [{},{C12:{...notes.C12,section:''}},{C12:{...notes.C12,status:'pass'}},{X01:notes.C12}])assert.throws(()=>validateReviewNotes(value));
});
test('C089 immutable notes: service role, retry, latest review, changed Word and client isolation',async()=>{
 const db=new PGlite();
 try{
 await db.exec('create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);grant usage on schema public,auth to service_role;grant select on auth.users to service_role;');
 for(const path of ['request-delivery.sql','result-delivery.sql','supabase/migrations/20260912094701_studkab_versioned_delivery.sql','supabase/migrations/20260914105509_studkab_requirement_passports.sql','supabase/migrations/20260918130000_review_statuses.sql','supabase/migrations/20260919124300_result_review_context_guard.sql','supabase/migrations/20260922032858_c089_review_notes.sql'])await db.exec(fs.readFileSync(path,'utf8'));
 const id=n=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12);
 const [u,q,p,v,r,n,r2,v2]=[1,2,3,4,5,6,7,8].map(id);
 await db.query('insert into auth.users values($1)',[u]);
 await db.query("insert into studkab_requests(id,student_id,client_id,payload) values($1,$2,'test','{}')",[q,u]);
 await db.query("insert into studkab_requirement_passports(id,request_id,revision,status,title,items,source_fingerprint,created_by) values($1,$2,1,'approved','Test','[]',$3,$4)",[p,q,'a'.repeat(64),u]);
 const doc={topic:'Synthetic',reviewContext:{passportId:p,sourceFingerprint:'a'.repeat(64),fingerprint:'b'.repeat(64)}};
 const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result;
 await db.exec('set role service_role');
 const prepared=await rpc('prepare_studkab_result',[q,v,u,doc,Buffer.from('PK\x03\x04test').toString('base64')]);
 const codes=Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']);const criteria=Object.fromEntries(codes.map(c=>[c,{status:'pass',evidence:'Synthetic evidence page 1'}]));
 await rpc('review_studkab_result',[q,v,r,u,u,prepared.fileHash,prepared.documentHash,criteria]);
 const args=[q,v,n,u,u,prepared.fileHash,prepared.documentHash,notes];
 const saved=await rpc('record_studkab_review_notes',args);assert.equal(saved.reviewId,n);
 assert.deepEqual(await rpc('record_studkab_review_notes',args),saved);
 assert.equal((await rpc('record_studkab_review_notes',[...args.slice(0,7),{C12:{...notes.C12,evidence:'Другое замечание по объёму'}}])).error,'conflict');
 assert.equal((await db.query('select criteria from studkab_result_reviews where id=$1',[n])).rows[0].criteria.C12.section,'Основной текст');
 await assert.rejects(()=>rpc('deliver_reviewed_studkab_result',[q,q,v,r,u,prepared.fileHash,prepared.documentHash]),/Latest version review required/);
 assert.equal((await rpc('deliver_reviewed_studkab_result',[q,q,v,n,u,prepared.fileHash,prepared.documentHash])).error,'review_required');
 await assert.rejects(()=>db.query("update studkab_result_reviews set criteria='{}' where id=$1",[n]),/permission denied|Immutable/);
 await rpc('review_studkab_result',[q,v,r2,u,u,prepared.fileHash,prepared.documentHash,criteria]);
 const prepared2=await rpc('prepare_studkab_result',[q,v2,u,{...doc,topic:'Corrected'},Buffer.from('PK\x03\x04changed').toString('base64')]);
 assert.equal((await rpc('record_studkab_review_notes',args)).error,'stale');
 assert.equal((await rpc('deliver_reviewed_studkab_result',[q,q,v2,r2,u,prepared2.fileHash,prepared2.documentHash])).error,'review_required');
 assert.equal((await db.query('select count(*)::int n from studkab_result_reviews where version_id=$1',[v])).rows[0].n,3);
 for(const role of ['anon','authenticated']){
 await db.exec('reset role;set role '+role);
 await assert.rejects(()=>rpc('record_studkab_review_notes',args),/permission denied/);
 await assert.rejects(()=>db.query('select * from studkab_result_reviews'),/permission denied/);
 }
 }finally{await db.close();}
});

test('C089 API restores negative review, returns version history only to executor',async()=>{
 const id=n=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12);
 const [u,q,p,v,r]=[1,2,3,4,5].map(id),document=validateResult({topic:'Test',chapters:[{id:'intro',name:'Intro'}],structure:{intro:{text:'Synthetic document'}},reviewContext:{passportId:p,sourceFingerprint:'a'.repeat(64),fingerprint:'b'.repeat(64)}});
 const config=async()=>({executor_email:'executor@example.test'}),user={id:u,email:'executor@example.test'},review={id:r,version_id:v,criteria:notes,created_at:'2026-09-22'};
 const paths=[];
 const db=async path=>{paths.push(path);
  if(path.startsWith('studkab_requests?'))return [{id:q,student_id:u}];
  if(path==='rpc/studkab_result_context_version')return 2;
  if(path.startsWith('studkab_requirement_passports?'))return [{id:p,status:'approved',source_fingerprint:'a'.repeat(64)}];
  if(path.startsWith('studkab_result_versions?'))return [{id:v,recipient_id:u,document,file_hash:'c'.repeat(64),document_hash:'d'.repeat(64),docx_base64:'UEsDBHRlc3Q='}];
  if(path.startsWith('studkab_result_passport_bindings?'))return [{id:v,document_fingerprint:'b'.repeat(64)}];
  if(path.startsWith('studkab_results?'))return [];
  if(path.startsWith('studkab_result_reviews?'))return [review];
  throw Error(path);
 };
 const state=await resultAction({action:'result-review-state',id:q,document},user,{db,config});
 assert.equal(state.data.state,'changes_requested');assert.deepEqual(state.data.review.criteria,notes);
 const history=await resultAction({action:'result-review-history',id:q},user,{db,config});assert.equal(history.data.reviews[0].id,r);
 assert.ok(paths.some(p=>p.includes('studkab_result_versions.request_id=eq.'+q)));
 const count=paths.length;
 assert.equal((await resultAction({action:'result-review-history',id:q},{id:u,email:'student@example.test'},{db,config})).status,403);
 assert.equal(paths.length,count);
});
