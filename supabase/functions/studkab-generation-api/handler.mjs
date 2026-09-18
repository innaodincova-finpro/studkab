import {expandParts} from './plan.mjs';
import {reserveMicrousd,MAX_OUTPUT_TOKENS} from '../_shared/deepseek-cost.mjs';
const headers={'Content-Type':'application/json','Cache-Control':'no-store',
 'Access-Control-Allow-Origin':'https://innaodincova-finpro.github.io',
 'Access-Control-Allow-Headers':'authorization,content-type,apikey',
 'Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const idPattern=/^[a-zA-Z0-9_-]{1,100}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fingerprint=/^[a-f0-9]{64}$/;
export function workKind(value){
 const v=String(value||'').toLowerCase();
 if(/вкр|выпускн|диплом/.test(v))return 'thesis';
 if(/курсов/.test(v))return 'coursework';
 if(/контрольн/.test(v))return 'control';
 return null;
}
export function failure(attempt){
 if(!attempt)return null;
 const code=attempt.detail?.finish_reason==='length'?'OUTPUT_LIMIT':attempt.reason==='LEASE_EXPIRED_AFTER_DISPATCH'?'LEASE_EXPIRED_AFTER_DISPATCH':'RESULT_UNKNOWN';
 const out={code};
 for(const key of ['prompt_tokens','completion_tokens'])if(Number.isSafeInteger(attempt.detail?.[key])&&attempt.detail[key]>=0&&attempt.detail[key]<=1000000000)out[key]=attempt.detail[key];
 return out;
}
const diagnosticStages=new Set(['preparation','provider']);
export function diagnostic(value){
 if(!value||!diagnosticStages.has(value.stage))return null;
 const out={ordinal:value.ordinal,section:value.section||null,stage:value.stage,attempt:value.attempt,requestId:value.request_id||null,
  reason:value.reason||null,finishReason:value.finish_reason||null,startedAt:value.started_at||null,finishedAt:value.finished_at||null};
 for(const key of ['promptTokens','completionTokens'])if(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=1000000000)out[key]=value[key];
 return out;
}
export function prepare(input,workLimit){
 if(typeof input.request!=='string'||!uuid.test(input.request) || !fingerprint.test(input.materialFingerprint||'')
 || typeof input.system!=='string' || !input.system.trim()
 || input.system.length>100000 || !Array.isArray(input.parts) || input.parts.length<1 || input.parts.length>100)
  throw Error('INVALID_INPUT');
 if(!Number.isSafeInteger(workLimit)||workLimit<1||workLimit>999999999999)throw Error('COST_NOT_CONFIGURED');
 const ids=new Set();
 const validated=input.parts.map(p=>{
  if(!p || typeof p.id!=='string'||!idPattern.test(p.id)||ids.has(p.id)
   ||typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>80000
   ||input.system.length+p.prompt.length>180000)throw Error('INVALID_PART');
  ids.add(p.id);
  // Ignore all client price, owner, model and URL fields.
  return {id:p.id,prompt:p.prompt,target_chars:p.target_chars};
 });
 const plan=expandParts(validated,workLimit,MAX_OUTPUT_TOKENS);
 const snapshot={system:input.system,prompts:{},material_fingerprint:input.materialFingerprint};
 for(const part of validated)snapshot.prompts[part.id]=part.prompt;
 for(const part of plan){
  const original=snapshot.prompts[part.section_id];
  if(!part.prompt.startsWith(original))throw Error('INVALID_PLAN');
  part.prompt=part.prompt.slice(original.length);
  part.prompt_ref=part.section_id;
 }
 const precedingBytesBySection=new Map();let estimatedTotal=0;
 for(const part of plan){
  const precedingBytes=precedingBytesBySection.get(part.section_id)||0;
  part.estimated_cost_microusd=reserveMicrousd(input.system,snapshot.prompts[part.prompt_ref]+part.prompt,part.max_output_tokens,precedingBytes);
  estimatedTotal+=part.estimated_cost_microusd;
  precedingBytesBySection.set(part.section_id,precedingBytes+part.target_chars*4+96);
 }
 if(new TextEncoder().encode(JSON.stringify({input:snapshot,plan})).byteLength>900000)throw Error('INPUT_TOO_BIG');
 return {snapshot,plan,estimatedTotal};
}
export function handler({auth,config,db,settings}){
 return async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'METHOD'},405);
  try{
   const bearer=req.headers.get('Authorization');
   const user=bearer?.startsWith('Bearer ')?await auth(bearer):null;
   if(!user?.id||!user.email_confirmed_at||user.is_anonymous)return reply({error:'UNAUTHORIZED'},401);
   const cfg=await config();
   if(!cfg?.executor_email||typeof user.email!=='string'||user.email.toLowerCase()!==cfg.executor_email.toLowerCase())
    return reply({error:'FORBIDDEN'},403);
   const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>900000)return reply({error:'INPUT_TOO_BIG'},413);
   let input;try{input=JSON.parse(raw);}catch{return reply({error:'INVALID_JSON'},400);}
   if(!input||typeof input!=='object'||Array.isArray(input))return reply({error:'INVALID_INPUT'},400);
   if(input.action==='capabilities'){
    const [b]=await db('studkab_gen_budget?id=eq.true&select=limit_microusd,reserved_microusd');
    const [policy]=await db('studkab_gen_policy?id=eq.true&select=temporary_total_microusd');
    const s=settings();
    const remaining=!!b&&!!policy?Math.max(0,Math.min(Number(b.limit_microusd),Number(policy.temporary_total_microusd))-Number(b.reserved_microusd)):0;
    return reply({enabled:s.enabled===true,budgetAvailable:remaining>0,remainingMicrousd:remaining});
   }
   if(input.action==='start'||input.action==='estimate'){
    const s=settings();
    if(!s.enabled)return reply({error:'GENERATION_NOT_CONFIGURED'},503);
    if(typeof input.request!=='string'||!uuid.test(input.request))return reply({error:'INVALID_INPUT'},400);
    const [requestRow]=await db('studkab_requests?id=eq.'+input.request+'&select=id,payload&limit=1');
    if(!requestRow)return reply({error:'REQUEST_NOT_FOUND'},404);
    const kind=workKind(requestRow.payload?.k);
    if(!kind)return reply({error:'WORK_TYPE_REQUIRED'},409);
    const [limit]=await db('studkab_gen_limits?work_kind=eq.'+kind+'&select=max_cost_microusd&limit=1');
    if(!limit)return reply({error:'WORK_LIMIT_NOT_CONFIGURED'},503);
    let prepared;try{prepared=prepare(input,Number(limit.max_cost_microusd));}catch(e){return reply({error:e.message},400);}
    const [passport]=await db('studkab_requirement_passports?request_id=eq.'+input.request+'&status=eq.approved&source_fingerprint=eq.'+input.materialFingerprint+'&select=id,revision,source_fingerprint&order=revision.desc&limit=1');
    if(!passport)return reply({error:'PASSPORT_REQUIRED'},409);
    const [b]=await db('studkab_gen_budget?id=eq.true&select=limit_microusd,reserved_microusd');
    const [policy]=await db('studkab_gen_policy?id=eq.true&select=temporary_total_microusd');
    const remaining=!!b&&!!policy?Math.min(Number(b.limit_microusd),Number(policy.temporary_total_microusd))-Number(b.reserved_microusd):0;
    if(remaining<=0||prepared.estimatedTotal>Number(limit.max_cost_microusd)||prepared.estimatedTotal>remaining)return reply({error:'BUDGET_BLOCKED'},409);
    if(input.action==='estimate')return reply({status:'estimate',passportRevision:passport.revision,workKind:kind,
     maxCostMicrousd:Number(limit.max_cost_microusd),estimatedCostMicrousd:prepared.estimatedTotal,remainingMicrousd:remaining});
    const job=await db('rpc/studkab_gen_start',{p_owner:user.id,p_request:input.request,
     p_input:prepared.snapshot,p_plan:prepared.plan,p_passport:passport.id,p_work_kind:kind,
     p_max_cost_microusd:Number(limit.max_cost_microusd)});
    return reply({job,status:'queued',passportRevision:passport.revision,workKind:kind,
     maxCostMicrousd:Number(limit.max_cost_microusd),estimatedCostMicrousd:prepared.estimatedTotal,remainingMicrousd:remaining});
   }
   if(input.action==='history'){
    if(typeof input.request!=='string'||!idPattern.test(input.request))return reply({error:'INVALID_INPUT'},400);
    const jobs=await db('studkab_gen_jobs?request_id=eq.'+encodeURIComponent(input.request)+'&owner_id=eq.'+encodeURIComponent(user.id)+'&select=id,request_id,version,status,created_at&order=created_at.desc&limit=20');
    return reply({jobs});
   }
   if(input.action==='cancel'){
    // C-051: остановка не зависит от включения генерации и бюджета.
    if(!uuid.test(input.job||''))return reply({error:'INVALID_JOB'},400);
    const status=await db('rpc/studkab_gen_cancel',{p_owner:user.id,p_job:input.job});
    if(status==='not_found')return reply({error:'NOT_FOUND'},404);
    return reply({job:input.job,status});
   }
   if(input.action==='status'){
    if(!uuid.test(input.job||''))return reply({error:'INVALID_JOB'},400);
    const [job]=await db('studkab_gen_jobs?id=eq.'+input.job+'&owner_id=eq.'+encodeURIComponent(user.id)+'&select=id,request_id,version,status,created_at');
    if(!job)return reply({error:'NOT_FOUND'},404);
    const parts=await db('studkab_gen_parts?job_id=eq.'+job.id+'&select=ordinal,state,result,spec,failure_stage,failure_reason,failure_count,failure_at&order=ordinal.asc');
    const attempts=await db('studkab_gen_attempts?job_id=eq.'+job.id+'&select=request_id,ordinal,state,reason,detail,started_at,finished_at&order=ordinal.asc,started_at.asc');
    // Claim tokens, input prompts and service configuration never enter the response.
    const counters=new Map(),diagnostics=[];
    for(const a of attempts){const n=(counters.get(a.ordinal)||0)+1;counters.set(a.ordinal,n);const part=parts.find(p=>p.ordinal===a.ordinal);const d=diagnostic({
     ordinal:a.ordinal,section:part?.spec?.section_id||part?.spec?.id,stage:'provider',attempt:n,request_id:a.request_id,reason:a.reason,
     finish_reason:a.detail?.finish_reason,started_at:a.started_at,finished_at:a.finished_at,
     promptTokens:a.detail?.prompt_tokens,completionTokens:a.detail?.completion_tokens});if(d)diagnostics.push(d);}
    for(const p of parts)if(p.failure_stage==='preparation'){const d=diagnostic({ordinal:p.ordinal,section:p.spec?.section_id||p.spec?.id,stage:'preparation',
     attempt:p.failure_count,reason:p.failure_reason,started_at:p.failure_at,finished_at:p.failure_at});if(d)diagnostics.push(d);}
    return reply({job,diagnostics,parts:parts.map(p=>({ordinal:p.ordinal,id:p.spec?.id,section:p.spec?.section_id||p.spec?.id,state:p.state,text:p.state==='done'?p.result:null,
     failure:p.state==='unknown'?(p.failure_stage==='preparation'?{code:p.failure_reason}:failure(attempts.find(a=>a.ordinal===p.ordinal))):null}))});
   }
   return reply({error:'UNKNOWN_ACTION'},400);
  }catch{return reply({error:'SERVICE_UNAVAILABLE'},503);}
 };
}
