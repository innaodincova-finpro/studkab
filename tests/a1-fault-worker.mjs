import {execFileSync} from 'node:child_process';

const [mode,run]=process.argv.slice(2);
if(!/^[0-9a-f-]{36}$/i.test(run||''))throw Error('INVALID_RUN');
const sql=value=>execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-Atq','-c',value],{encoding:'utf8'}).trim();
const claim=()=>sql(`select studkab_a1_fault.claim('${run}'::uuid)`);

if(mode==='claim-once'){
 process.stdout.write(claim()||'NONE');
}else if(mode==='claim-and-hang'){
 const token=claim();if(!token)throw Error('CLAIM_MISSING');
 process.stdout.write(`CLAIMED|${token}\n`);
 setInterval(()=>{},1000);
}else if(mode==='dispatch-and-drop'){
 const token=claim();if(!token)throw Error('CLAIM_MISSING');
 const request=sql(`select studkab_a1_fault.dispatch('${run}'::uuid,'${token}'::uuid)`);
 sql(`select studkab_a1_fault.provider_accept('${run}'::uuid,'${request}'::uuid)`);
 process.stdout.write(`ACCEPTED|${token}|${request}\n`);
 process.exit(86);
}else throw Error('INVALID_MODE');
