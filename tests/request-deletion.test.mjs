import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';

const id='11111111-1111-4111-8111-111111111111';
const owner={id:'22222222-2222-4222-8222-222222222222',email:'owner@example.test',email_confirmed_at:'yes'};
const student={...owner,id:'33333333-3333-4333-8333-333333333333',email:'student@example.test'};
const request=body=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(body)});
const input={action:'delete-request',id,confirmId:id,reason:'Удаление неверной тестовой заявки'};

test('only the confirmed executor may start destructive deletion',async()=>{
 let reads=0,who=student;
 const app=handler({auth:async()=>who,config:async()=>({executor_email:owner.email}),db:async()=>{reads++;return[];}});
 assert.equal((await app(request(input))).status,403);assert.equal(reads,0);
 who=owner;
 for(const body of [{...input,confirmId:'wrong'},{...input,reason:'коротко'},{...input,id:'bad'}]){
  assert.equal((await app(request(body))).status,400);
 }
 assert.equal(reads,0);
});

test('storage is removed before the single database deletion RPC',async()=>{
 const order=[];
 const db=async(path,method,body)=>{
  order.push({path,method,body});
  if(path==='rpc/prepare_studkab_request_delete')return {absent:false,paths:['student/request/a','student/request/b']};
  if(path==='rpc/delete_studkab_request')return {deleted:true,id};
  throw Error('Unexpected '+path);
 };
 const removed=[];
 const response=await handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db,remove:async path=>{removed.push(path);order.push({path:'storage:'+path});}})(request(input));
 assert.equal(response.status,200);assert.deepEqual(removed,['student/request/a','student/request/b']);
 assert.equal(order.at(-1).path,'rpc/delete_studkab_request');
 assert.equal(order.at(-1).body.p_actor,owner.id);assert.equal(order.at(-1).body.p_request,id);
});

test('storage failure keeps database rows for a retry',async()=>{
 const calls=[];
 const db=async path=>{calls.push(path);if(path==='rpc/prepare_studkab_request_delete')return{absent:false,paths:['student/request/a']};throw Error('RPC must not run');};
 const response=await handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db,remove:async()=>{throw Error('storage offline');}})(request(input));
 assert.equal(response.status,503);assert.equal(calls.includes('rpc/delete_studkab_request'),false);
});

test('already absent server request is an idempotent success',async()=>{
 let removed=0;
 const response=await handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db:async path=>path==='rpc/prepare_studkab_request_delete'?{absent:true,paths:[]}:null,remove:async()=>{removed++;}})(request(input));
 assert.deepEqual(await response.json(),{deleted:true,absent:true,id});assert.equal(removed,0);
});

test('migration gates deletion, preserves reconciled accounting and revokes clients',()=>{
 const sql=fs.readFileSync(new URL('../supabase/migrations/20260920111220_c079_request_deletion.sql',import.meta.url),'utf8');
 assert.match(sql,/request\.jwt\.claims/);assert.match(sql,/service_role/);assert.match(sql,/prepare_studkab_request_delete/);
 assert.match(sql,/REQUEST_DELETE_UNRECONCILED_COST/);assert.match(sql,/studkab_gen_reconciliations/);
 assert.match(sql,/session_replication_role','replica'/);assert.match(sql,/session_replication_role','origin'/);
 assert.match(sql,/studkab_request_deletion_audit/);
 assert.match(sql,/revoke all on function public\.delete_studkab_request[\s\S]*public,anon,authenticated/);
});

test('registry uses an in-page confirmation and removes its card only after server success',()=>{
 const html=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
 const block=html.slice(html.indexOf('if (act === "delete")'),html.indexOf('if (act === "paste")'));
 assert.doesNotMatch(block,/\bconfirm\s*\(/);assert.match(block,/action:'delete-request'/);
 assert.ok(block.indexOf("await Oblako.requestApi")<block.indexOf('D.items=D.items.filter'));
 assert.match(block,/Удаление не завершено\. Данные сохранены для повторной попытки/);
});
