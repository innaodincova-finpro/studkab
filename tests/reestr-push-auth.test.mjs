import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../oblako.js',import.meta.url),'utf8');
for(const app of ['reestr','kabinet'])test('signed-in '+app+' can call the push service',async()=>{
 const user={id:'user-1',email:'owner@example.test'};
 const session={user,access_token:'synthetic-token'};
 const calls=[];
 const auth={onAuthStateChange(){},async getSession(){return {data:{session}};}};
 const window={OBLAKO_CONFIG:{url:'https://example.test',key:'public-key'},supabase:{createClient:()=>({auth})},localStorage:{getItem:()=>null},addEventListener(){}};
 const context={window,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({publicKey:'test-key'})};},AbortSignal,setTimeout,clearTimeout};
 vm.runInNewContext(source,context);
 await window.Oblako.init({app,getData:()=>({}),setData(){},onChange(){},switchUser(){}});
 const result=await window.Oblako.pushRequest({action:'key'});
 assert.equal(result.publicKey,'test-key');
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://example.test/functions/v1/studkab-push');
 assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic-token');
});
