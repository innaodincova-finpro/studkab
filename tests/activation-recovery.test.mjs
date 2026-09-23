import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../activate.html',import.meta.url),'utf8');
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('verifyOtp'));
function screen(options={}){
 const nodes=new Map(), calls={session:0,verify:0,update:0,signout:0,clean:0,redirect:0};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'Example-only-123',disabled:false,insertAdjacentHTML(){},addEventListener(_,fn){this.submit=fn;}});return nodes.get(id);};
 const auth={async getSession(){calls.session++;return {data:{session:options.session||null},error:options.sessionError};},async verifyOtp(args){calls.verify++;assert.equal(args.type,options.type||'recovery');if(options.throwVerify)throw options.throwVerify;return options.verify||{data:{user:{email:'synthetic@example.test'}}};},async updateUser(){calls.update++;return {error:calls.update===1?options.updateError:null};},async signOut(){calls.signout++;return {};}};
 const context={URLSearchParams,document:{getElementById:node,querySelector:node},window:{supabase:{createClient:()=>({auth})}},Onboarding:{passwordField:()=>'',passwordError:(a,b)=>a===b?'':'Пароли не совпадают.'},location:{hash:'#token=SECRET_TOKEN&email=synthetic%40example.test&type='+ (options.type||'recovery'),pathname:'/activate.html',replace(){calls.redirect++;}},history:{replaceState(){calls.clean++;}}};
 vm.runInNewContext(script,context);
 return {calls,node,async submit(){await node('activate').submit({preventDefault(){}});assert.equal(node('submit').disabled,false);assert.doesNotMatch(node('status').textContent,/SECRET_TOKEN|synthetic@|RAW_SECRET|Example-only/);},status:()=>node('status').textContent};
}
test('existing session never verifies link or updates password',async()=>{const s=screen({session:{}});await s.submit();assert.match(s.status(),/уже выполнен вход/);assert.equal(s.calls.verify,0);assert.equal(s.calls.update,0);});
for(const code of ['otp_expired','invite_not_found'])test(code+' alone identifies expired link',async()=>{const s=screen({verify:{error:{code,message:'RAW_SECRET'}}});await s.submit();assert.match(s.status(),/Ссылка истекла/);assert.equal(s.calls.update,0);});
for(const error of [{name:'AuthRetryableFetchError',status:0},{status:503},{code:'request_timeout'}])test('temporary verify failure '+JSON.stringify(error),async()=>{const s=screen({verify:{error}});await s.submit();assert.match(s.status(),/временно недоступен/);assert.doesNotMatch(s.status(),/Ссылка истекла/);assert.equal(s.calls.update,0);});
test('thrown retryable network failure',async()=>{const s=screen({throwVerify:{name:'AuthRetryableFetchError'}});await s.submit();assert.match(s.status(),/временно недоступен/);});
test('429 requests waiting without reclassifying link',async()=>{const s=screen({verify:{error:{status:429,message:'RAW_SECRET'}}});await s.submit();assert.match(s.status(),/Подождите/);assert.doesNotMatch(s.status(),/истекла/);});
test('unknown error is not expiry and raw message remains private',async()=>{const s=screen({verify:{error:{code:'unrecognized',message:'RAW_SECRET'}}});await s.submit();assert.match(s.status(),/Причина не определена/);assert.doesNotMatch(s.status(),/истекла/);});
test('failed password update can retry without consuming link again',async()=>{const s=screen({updateError:{status:500,message:'RAW_SECRET'}});await s.submit();assert.match(s.status(),/пароль не сохранён/);assert.equal(s.calls.redirect,0);await s.submit();assert.equal(s.calls.session,1);assert.equal(s.calls.verify,1);assert.equal(s.calls.update,2);assert.equal(s.calls.clean,1);assert.equal(s.calls.redirect,1);});
for(const type of ['invite','recovery'])test(type+' success clears fragment and redirects',async()=>{const s=screen({type});await s.submit();assert.equal(s.calls.verify,1);assert.equal(s.calls.update,1);assert.equal(s.calls.clean,1);assert.equal(s.calls.redirect,1);});
test('verified email mismatch signs out locally and never updates',async()=>{const s=screen({verify:{data:{user:{email:'other@example.test'}}}});await s.submit();assert.match(s.status(),/не совпадает/);assert.equal(s.calls.signout,1);assert.equal(s.calls.update,0);assert.equal(s.calls.redirect,0);});
test('password mismatch never contacts Auth',async()=>{const s=screen();s.node('repeat').value='different';await s.submit();assert.match(s.status(),/не совпадают/);assert.equal(s.calls.session,0);assert.equal(s.calls.verify,0);assert.equal(s.calls.update,0);});
