import {ANALYSIS_VERSION,analysisPlan,validAnalysisPart,verifyExtraction,distribute} from './intake-analysis.mjs';
// JSON objects from Postgres can have a different key order. Arrays stay ordered.
const canonical=x=>JSON.stringify(sort(x));
function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;}
export function prepareIntakeContinuation(job,snapshot){
 if(job?.version!==ANALYSIS_VERSION||job.state!=='invalid'||job.parent_job_id||job.manifest!==snapshot?.manifest||!Number.isSafeInteger(job.ordinal)||job.ordinal<0)throw Error('CONTINUATION_UNAVAILABLE');
 const plan=analysisPlan(snapshot),n=job.ordinal+1;
 if(canonical(job.plan)!==canonical(plan)||n>plan.length||job.raw_outputs?.length!==n||job.part_results?.length!==job.ordinal)throw Error('CONTINUATION_MISMATCH');
 const ids=new Set(),parts=[];
 for(let i=0;i<n;i++){
  const raw=job.raw_outputs[i];
  if(!validAnalysisPart(plan[i],i,plan.length)||typeof raw?.request_id!=='string'||!/^[a-f0-9-]{36}$/i.test(raw.request_id)||ids.has(raw.request_id)||raw.error!==(i===n-1?'invalid':null))throw Error('CONTINUATION_MISMATCH');
  ids.add(raw.request_id);parts.push(verifyExtraction(raw.text,plan[i]));
  if(i<job.ordinal&&canonical(parts[i])!==canonical(job.part_results[i]))throw Error('CONTINUATION_MISMATCH');
 }
 // Never call a provider or change the historical record here.
 return {sourceId:job.id,manifest:job.manifest,parts,requestIds:[...ids],cachedParts:n,totalParts:plan.length,
  remainingParts:plan.length-n,remainingReserveMicrousd:plan.slice(n).reduce((sum,p)=>sum+p.max_cost_microusd,0),
  result:n===plan.length?distribute(parts):null,status:n===plan.length?'done':'paused'};
}
