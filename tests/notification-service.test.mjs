import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationAction} from '../supabase/functions/studkab-requests/notification-service.mjs';
const user={id:'11111111-1111-4111-8111-111111111111',email:'student@example.test'};
function fixture(member=true){
 const calls=[];
 const deps={isMember:async()=>member,telegramConfigured:true,config:async()=>({executor_email:'owner@example.test'}),
 emailSettings:()=>({host:'smtp.example.test',port:465,username:'user',password:'private',from:'from@example.test',to:'owner@example.test'}),
 db:async(path,method,args)=>{calls.push({path,args});if(path.startsWith('studkab_telegram_setup'))return [{installed:true}];
 if(path.endsWith('link_create'))return {expiresAt:'2030-01-01T00:15:00Z'};
 if(path.endsWith('unlink'))return true;
 return {push:{configured:true},telegram:{configured:false},deliveries:[{kind:'question',channel:'email',status:'accepted',at:'2030-01-01',acceptedAt:'2030-01-02',email:'private@example.test',subscription:{secret:'hidden'}}]};}};
 return {calls,deps};
}
test('notification settings expose only channel state and safe receipt metadata',async()=>{
 const f=fixture(),r=await notificationAction({action:'notification-state'},user,f.deps);
 assert.equal(r.data.email.configured,true);assert.equal(r.data.telegram.configured,false);
 assert.equal(r.data.deliveries[0].status,'sent');assert.equal(r.data.deliveries[0].at,'2030-01-02');
 assert.doesNotMatch(JSON.stringify(r),/private|hidden|subscription|owner@example/);
 assert.equal(f.calls[0].args.p_user,user.id);
});
test('personal Telegram link stores hash, not bearer token, and does not claim binding',async()=>{
 const f=fixture(),r=await notificationAction({action:'telegram-link',userId:'other'},user,f.deps);
 const value=new URL(r.data.url).searchParams.get('start').slice(5);
 assert.match(value,/^[a-f0-9]{64}$/);const call=f.calls.find(c=>c.path.endsWith('link_create'));
 assert.equal(call.args.p_user,user.id);assert.notEqual(call.args.p_hash,value);assert.match(call.args.p_hash,/^[a-f0-9]{64}$/);
 assert.equal(r.data.configured,undefined);
});
test('unapproved member and unavailable configured bot cannot create link',async()=>{
 const denied=fixture(false);assert.equal((await notificationAction({action:'telegram-link'},user,denied.deps)).status,403);assert.equal(denied.calls.length,0);
 const unavailable=fixture();unavailable.deps.telegramConfigured=false;
 assert.equal((await notificationAction({action:'telegram-link'},user,unavailable.deps)).status,503);
 assert.equal(unavailable.calls.some(c=>c.path.endsWith('link_create')),false);
});
test('unlink uses authenticated actor and demands committed result',async()=>{
 const f=fixture();assert.deepEqual((await notificationAction({action:'telegram-unlink',userId:'other'},user,f.deps)).data,{unlinked:true});assert.equal(f.calls[0].args.p_user,user.id);
 f.deps.db=async()=>false;await assert.rejects(notificationAction({action:'telegram-unlink'},user,f.deps),/UNLINK_UNCONFIRMED/);
});
