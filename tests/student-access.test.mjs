import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
import {accessLink} from '../supabase/functions/studkab-requests/access-links.mjs';
import {memberAllowed} from '../supabase/functions/studkab-push/access.mjs';
// C-054, замечания 4 и 5: заявки, уведомления и восстановление — только для допущенных студентов.
const owner={id:'00000000-0000-4000-8000-000000000001',email:'owner@example.test',email_confirmed_at:'yes'};
const stranger={id:'00000000-0000-4000-8000-000000000009',email:'tochka@example.test',email_confirmed_at:'yes'};
const payload={id:'rq-test',t:'Тема',cn:'Контакт',dl:'2026-10-12',fm:{sz:14}};
const call=body=>new Request('https://x.test',{method:'POST',headers:{authorization:'Bearer t'},body:JSON.stringify(body)});

test('C-054: пользователь без допуска не может подать заявку',async()=>{
 let submitted=0;
 const app=handler({auth:async()=>stranger,config:async()=>({executor_email:owner.email}),isMember:async id=>id!==stranger.id,db:async(p)=>{if(p==='rpc/submit_studkab_request')submitted++;return {id:'r'};}});
 const r=await app(call({action:'submit',payload}));
 assert.equal(r.status,403);assert.match((await r.json()).error,/исполнител/);
 assert.equal(submitted,0);
});
test('C-054: без проверки допуска подача заявки закрыта',async()=>{
 const app=handler({auth:async()=>stranger,config:async()=>({executor_email:owner.email}),db:async()=>({id:'r'})});
 assert.equal((await app(call({action:'submit',payload}))).status,403);
});
test('C-054: допущенный студент подаёт заявку',async()=>{
 const app=handler({auth:async()=>stranger,config:async()=>({executor_email:owner.email}),isMember:async()=>true,db:async()=>({id:'r',number:1})});
 assert.equal((await app(call({action:'submit',payload}))).status,200);
});
test('C-054: восстановление не выдаётся аккаунту без допуска, ответ как для отсутствующего',async()=>{
 const calls=[];
 const request=async(url,o)=>{calls.push(url);if(url.includes('/admin/users'))return Response.json({users:[{id:stranger.id,email:stranger.email,email_confirmed_at:'yes'}]});return Response.json({id:stranger.id,hashed_token:'h',verification_type:'recovery'});};
 const r=await accessLink({base:'https://x',key:'k',email:stranger.email,recovery:true,request,isMember:async()=>false});
 assert.deepEqual(r,{missing:true});
 assert.equal(calls.some(u=>u.includes('generate_link')),false);
 const ok=await accessLink({base:'https://x',key:'k',email:stranger.email,recovery:true,request,isMember:async id=>id===stranger.id});
 assert.match(ok.url,/type=recovery/);
});
test('C-054: восстановление без проверки допуска закрыто',async()=>{
 const request=async(url)=>url.includes('/admin/users')?Response.json({users:[{id:stranger.id,email:stranger.email,email_confirmed_at:'yes'}]}):Response.json({hashed_token:'h',verification_type:'recovery'});
 assert.deepEqual(await accessLink({base:'https://x',key:'k',email:stranger.email,recovery:true,request}),{missing:true});
});
test('C-054: приглашение выдаёт допуск и не раскрывает номер аккаунта',async()=>{
 const added=[];
 const app=handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db:async(p,m,b)=>{if(p==='rpc/studkab_member_add')added.push(b.p_user);return null;},
  invite:async(email,recovery)=>({url:'https://link',userId:'00000000-0000-4000-8000-000000000005'})});
 const r=await app(call({action:'invite',email:'new@example.test'}));
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.url,'https://link');assert.equal('userId' in body,false);
 assert.deepEqual(added,['00000000-0000-4000-8000-000000000005']);
});
test('C-054: восстановление не выдаёт допуск заново',async()=>{
 const added=[];
 const app=handler({auth:async()=>owner,config:async()=>({executor_email:owner.email}),db:async(p,m,b)=>{if(p==='rpc/studkab_member_add')added.push(b.p_user);return null;},
  invite:async()=>({url:'https://link',userId:'00000000-0000-4000-8000-000000000005'})});
 assert.equal((await app(call({action:'recover',identityVerified:true,email:'s@example.test'}))).status,200);
 assert.deepEqual(added,[]);
});
test('C-054: приглашение существующего аккаунта возвращает его идентификатор только серверу',async()=>{
 const request=async(url)=>Response.json({users:[{id:stranger.id,email:stranger.email,email_confirmed_at:'yes'}]});
 const r=await accessLink({base:'https://x',key:'k',email:stranger.email,request});
 assert.deepEqual(r,{existing:true,userId:stranger.id});
 const request2=async(url)=>url.includes('/admin/users')?Response.json({users:[]}):Response.json({id:'00000000-0000-4000-8000-000000000007',hashed_token:'h',verification_type:'invite'});
 const n=await accessLink({base:'https://x',key:'k',email:'fresh@example.test',request:request2});
 assert.equal(n.userId,'00000000-0000-4000-8000-000000000007');assert.match(n.url,/token=h/);
});
test('C-054: уведомления — только допущенным',async()=>{
 assert.equal(await memberAllowed(stranger.id,async()=>false),false);
 assert.equal(await memberAllowed(stranger.id,async()=>true),true);
 assert.equal(await memberAllowed('',async()=>true),false);
 assert.equal(await memberAllowed('x&user_id=neq.0',async()=>true),false);
});
