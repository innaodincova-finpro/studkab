import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const fixture=fileURLToPath(new URL('./a1-fault-injection.sql',import.meta.url));
const worker=fileURLToPath(new URL('./a1-fault-worker.mjs',import.meta.url));
const psql=sql=>execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-Atq','-c',sql],{encoding:'utf8'}).trim();
const start=scenario=>psql(`select studkab_a1_fault.start_run('${scenario}')`);
const expire=run=>psql(`select studkab_a1_fault.expire_lease('${run}'::uuid)`);
const query=(run,expression)=>psql(`select ${expression} from studkab_a1_fault.runs r join studkab_a1_fault.parts p on p.run_id=r.id where r.id='${run}'::uuid`);
const child=(mode,run)=>spawn(process.execPath,[worker,mode,run],{stdio:['ignore','pipe','pipe'],env:process.env});
const completed=async process=>{
 let out='',err='';process.stdout.on('data',d=>out+=d);process.stderr.on('data',d=>err+=d);
 const [code,signal]=await once(process,'exit');return {code,signal,out:out.trim(),err:err.trim()};
};
const firstLine=process=>new Promise((resolve,reject)=>{
 let value='';process.stdout.on('data',chunk=>{value+=chunk;if(value.includes('\n'))resolve(value.trim());});
 process.once('error',reject);process.once('exit',(code,signal)=>reject(Error(`worker exited before checkpoint: ${code}/${signal}`)));
});

execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-f',fixture],{stdio:'inherit'});
try{
 const stoppedRun=start('worker-stop');
 const stopped=child('claim-and-hang',stoppedRun);
 const oldClaim=(await firstLine(stopped)).split('|')[1];
 assert.match(oldClaim,/^[0-9a-f-]{36}$/i);
 const stoppedExit=once(stopped,'exit');
 stopped.kill('SIGKILL');await stoppedExit;expire(stoppedRun);
 const recoveredClaim=psql(`select studkab_a1_fault.claim('${stoppedRun}'::uuid)`);
 assert.notEqual(recoveredClaim,oldClaim);
 let staleRejected=false;
 try{psql(`select studkab_a1_fault.dispatch('${stoppedRun}'::uuid,'${oldClaim}'::uuid)`);}catch{staleRejected=true;}
 assert.equal(staleRejected,true);
 assert.equal(query(stoppedRun,"r.marker||'|'||p.marker||'|'||p.state"),'A1-SYNTHETIC|A1-SYNTHETIC|claimed');
 console.log('PASS A1.2: killed worker recovered; stale claim fenced; synthetic marker preserved');

 const concurrentRun=start('concurrent-workers');
 const pair=await Promise.all([completed(child('claim-once',concurrentRun)),completed(child('claim-once',concurrentRun))]);
 assert.deepEqual(pair.map(x=>x.code),[0,0]);
 assert.equal(pair.map(x=>x.out).filter(x=>x!=='NONE').length,1);
 assert.equal(psql(`select count(*) from studkab_a1_fault.events where run_id='${concurrentRun}' and event='claimed'`),'1');
 console.log('PASS A1.3: two simultaneous workers produced exactly one claim');

 const lossRun=start('post-send-loss');
 const lost=await completed(child('dispatch-and-drop',lossRun));
 assert.equal(lost.code,86);assert.match(lost.out,/^ACCEPTED\|[0-9a-f-]{36}\|[0-9a-f-]{36}$/i);
 expire(lossRun);assert.equal(psql(`select studkab_a1_fault.claim('${lossRun}'::uuid)`),'');
 assert.equal(query(lossRun,"r.status||'|'||p.state"),'unknown|unknown');
 assert.equal(psql(`select count(*)||'|'||count(pr.request_id) from studkab_a1_fault.attempts a left join studkab_a1_fault.provider_receipts pr using(request_id) where a.run_id='${lossRun}'::uuid`),'1|1');
 assert.equal(psql(`select reason from studkab_a1_fault.attempts where run_id='${lossRun}'::uuid`),'LEASE_EXPIRED_AFTER_DISPATCH');
 console.log('PASS A1.4: accepted synthetic request became unknown and was not resent');

 assert.equal(psql("select count(*) from studkab_a1_fault.runs where marker<>'A1-SYNTHETIC'"),'0');
 assert.equal(psql("select count(*) from studkab_a1_fault.parts where marker<>'A1-SYNTHETIC'"),'0');
 console.log('PASS isolation: all fixtures are separately marked; no external provider or public queue used');
}finally{psql('drop schema if exists studkab_a1_fault cascade');}
