import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {Jobs,tick} from '../../server/durable-jobs.mjs';

const specs=[{id:'ch1.1',prompt:'First part',maxCost:10},{id:'ch1.2',prompt:'Second part',maxCost:10}];
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'studkab-jobs-')), path=join(dir,'jobs.db');
 let clock=0;
 const j=new Jobs(path,{now:()=>clock,leaseMs:100});
 t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true});});
 return {j,path,advance:()=>{clock+=101;}};
}
test('double Start returns one job, concurrent handlers dispatch only once',async t=>{
 const {j,path}=fixture(t), other=new Jobs(path,{now:()=>0,leaseMs:100});
 t.after(()=>other.close());
 const id=j.start('owner','request',{text:'v1'},specs,20);
 assert.equal(other.start('owner','request',{text:'v1'},specs,20),id);
 let release,calls=0;
 const pending=tick(j,async()=>{calls++;await new Promise(r=>release=r);return {text:'saved'};});
 assert.equal(await tick(other,async()=>{calls++;return {text:'duplicate'};}),false);
 release();await pending;
 assert.equal(calls,1);assert.equal(j.read('owner',id).parts[0].text,'saved');
});
test('crash before dispatch recovers with a fenced claim',t=>{
 const {j,advance}=fixture(t);j.start('o','r',{},specs,20);
 const old=j.claim();advance();const fresh=j.claim();
 assert.throws(()=>j.dispatch(old),/STALE_CLAIM/);
 assert.ok(j.dispatch(fresh));
});
test('lost response and repeated Start never repeat an ambiguous paid request',async t=>{
 const {j}=fixture(t), id=j.start('o','r',{},specs,20);let calls=0;
 await tick(j,async()=>{calls++;throw Error('socket lost after billing');});
 for(let i=0;i<5;i++){assert.equal(j.start('o','r',{},specs,20),id);await tick(j,async()=>{calls++;});}
 const state=j.read('o',id);assert.equal(state.status,'unknown');assert.equal(state.reserved,10);assert.equal(calls,1);
});
test('edited materials create a separate immutable version',async t=>{
 const {j}=fixture(t), a=j.start('o','r',{material:'old'},specs,20);
 await tick(j,async()=>({text:'old-version result'}));
 const b=j.start('o','r',{material:'new'},specs,20);
 assert.notEqual(a,b);assert.equal(j.read('o',a).parts[0].text,'old-version result');
 assert.equal(j.read('o',b).parts[0].text,null);
 assert.notEqual(j.read('o',a).version,j.read('o',b).version);
 assert.throws(()=>j.read('different-owner',a),/NOT_FOUND/);
});
test('budget reserves maximum charge, never sends beyond authorized cap',async t=>{
 const {j}=fixture(t),id=j.start('o','r',{},specs,10);let calls=0;
 const provider=async()=>{calls++;return {text:'part'};};
 await tick(j,provider);await tick(j,provider);
 assert.equal(calls,1);assert.equal(j.read('o',id).status,'budget');
});
test('SIGKILL after dispatch: saved part survives process restart; ambiguous part is not repeated',async t=>{
 const {j,path,advance}=fixture(t),id=j.start('o','r',{},specs,20);
 await tick(j,async()=>({text:'checkpoint one'}));
 const moduleUrl=new URL('../../server/durable-jobs.mjs',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import {Jobs} from ${JSON.stringify(moduleUrl)};
 const j=new Jobs(process.argv[1],{now:()=>0,leaseMs:100});const c=j.claim();j.dispatch(c);
 console.log('DISPATCH_COMMITTED');setInterval(()=>{},1000);`,path],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('child failed '+code));});});
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
 advance();j.recover();const state=j.read('o',id);
 assert.equal(state.parts[0].text,'checkpoint one');assert.equal(state.parts[1].status,'unknown');
 assert.equal(await tick(j,async()=>{throw Error('must not dispatch');}),false);
});
test('late response cannot overwrite a recovered ambiguous request',t=>{
 const {j,advance}=fixture(t),id=j.start('o','r',{},specs,20);
 const c=j.claim();j.dispatch(c);advance();j.recover();
 assert.throws(()=>j.settle(c,{text:'late'}),/STALE_RESULT/);
 assert.equal(j.read('o',id).parts[0].text,null);
});
