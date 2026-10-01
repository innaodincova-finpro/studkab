import {SYSTEM,verifyExtraction,distribute} from '../_shared/intake-analysis.mjs';
import {reserveMicrousd} from '../_shared/deepseek-cost.mjs';
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
// Called only behind the existing machine authorization + cron secret.
export async function runIntake({rpc,provider}){
 let c;try{c=await rpc('studkab_intake_analysis_claim',{});}catch{return {status:'intake_claim_unavailable'};}
 if(!c)return null;
 const part=c.part;
 let prepared=false;
 try{prepared=part?.max_output_tokens===4000&&Array.isArray(part.blocks)&&canonical({part:c.ordinal+1,parts:c.parts,blocks:part.blocks})===canonical(JSON.parse(part.prompt))&&part.max_cost_microusd===reserveMicrousd(SYSTEM,part.prompt,4000);}catch{}
 if(!prepared){
  try{await rpc('studkab_intake_analysis_fail_claim',{p_job:c.job_id,p_claim:c.claim});}catch{return {status:'intake_block_unconfirmed',job:c.job_id};}
  return {status:'intake_preparation_blocked',job:c.job_id};
 }
 let id;
 try{id=await rpc('studkab_intake_analysis_dispatch',{p_job:c.job_id,p_claim:c.claim,p_cost:part.max_cost_microusd});}
 catch{return {status:'intake_dispatch_unconfirmed',job:c.job_id};}
 if(!id)return {status:'intake_budget_or_stale',job:c.job_id};
 let output;try{output=await provider({input:{system:SYSTEM},spec:part},id);}catch{output=null;}
 let parsed=null,error=null,result=null,raw=null;
 if(output?.complete===true&&typeof output.text==='string'&&new TextEncoder().encode(output.text).byteLength<=100000){
  raw=output.text;
  try{parsed=verifyExtraction(raw,part);if(c.ordinal+1===c.parts)result=distribute([...c.previous,parsed]);}catch{error='invalid';}
 }
 try{const state=await rpc('studkab_intake_analysis_finish',{p_job:c.job_id,p_claim:c.claim,p_request:id,p_part:parsed,p_result:result,p_raw:raw,p_error:error});return {status:'intake_'+state,job:c.job_id};}
 catch{return {status:'intake_save_unconfirmed',job:c.job_id};}
}
