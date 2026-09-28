import {materialManifestGuard} from '../_shared/material-manifest.mjs';
import {sourceMinimumGuard} from '../_shared/source-minimum.mjs';
import {expandParts} from './plan.mjs';
import {reserveMicrousd,MAX_OUTPUT_TOKENS} from '../_shared/deepseek-cost.mjs';
import {reviewPacket,reviewPrompt,parseReviewReport} from './review-pass.mjs';
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
 // Older cached clients may still submit refs. Ignore that non-generative
 // section server-side so it can never consume budget or break the whole job.
 const validated=input.parts.filter(p=>p?.id!=='refs').map(p=>{
  if(!p || typeof p.id!=='string'||!idPattern.test(p.id)||ids.has(p.id)
   ||typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>80000
   ||input.system.length+p.prompt.length>180000)throw Error('INVALID_PART');
  ids.add(p.id);
  // Ignore all client price, owner, model and URL fields.
  return {id:p.id,prompt:p.prompt,target_chars:p.target_chars};
 });
 if(!validated.length)throw Error('INVALID_INPUT');
 const plan=input.reviewMode===true
  ? validated.map(p=>({id:p.id,section_id:p.id,part_index:0,part_count:1,prompt:p.prompt,
    max_cost_microusd:workLimit,max_output_tokens:MAX_OUTPUT_TOKENS,target_chars:3000}))
  : expandParts(validated,workLimit,MAX_OUTPUT_TOKENS);
 const snapshot={system:input.system,prompts:{},material_fingerprint:input.materialFingerprint};
 if(input.reviewMode===true){
  if(validated.length!==1||validated[0].id!=='quality_review'||!input.reviewTarget)throw Error('INVALID_REVIEW');
  snapshot.review_target=input.reviewTarget;
 }
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
export function handler({auth,config,db,settings,readReviewPacket=reviewPacket}){
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
    if(!String(requestRow.payload?.n||'').trim())return reply({error:'STUDENT_NAME_REQUIRED'},409);
    const kind=workKind(requestRow.payload?.k);
    if(!kind)return reply({error:'WORK_TYPE_REQUIRED'},409);
    const [limit]=await db('studkab_gen_limits?work_kind=eq.'+kind+'&select=max_cost_microusd&limit=1');
    if(!limit)return reply({error:'WORK_LIMIT_NOT_CONFIGURED'},503);
    let prepared;try{prepared=prepare({...input,reviewMode:false},Number(limit.max_cost_microusd));}catch(e){return reply({error:e.message},400);}
    const [passport]=await db('studkab_requirement_passports?request_id=eq.'+input.request+'&status=eq.approved&source_fingerprint=eq.'+input.materialFingerprint+'&select=id,revision,source_fingerprint,items&order=revision.desc&limit=1');
    if(!passport)return reply({error:'PASSPORT_REQUIRED'},409);
    const materials=await materialManifestGuard((path,method,body)=>db(path,body),input.request,passport.id);
    if(materials)return reply(materials,409);
    const conflict=await sourceMinimumGuard(db,input.request,passport.items);
    if(conflict)return reply(conflict,409);
    const [b]=await db('studkab_gen_budget?id=eq.true&select=limit_microusd,reserved_microusd');
    const [policy]=await db('studkab_gen_policy?id=eq.true&select=temporary_total_microusd');
    const remaining=!!b&&!!policy?Math.min(Number(b.limit_microusd),Number(policy.temporary_total_microusd))-Number(b.reserved_microusd):0;
    const canStart=remaining>0&&prepared.estimatedTotal<=Number(limit.max_cost_microusd)&&prepared.estimatedTotal<=remaining;
    if(input.action==='estimate')return reply({status:'estimate',passportRevision:passport.revision,workKind:kind,canStart,
     maxCostMicrousd:Number(limit.max_cost_microusd),estimatedCostMicrousd:prepared.estimatedTotal,remainingMicrousd:Math.max(0,remaining)});
    if(!canStart)return reply({error:'BUDGET_BLOCKED'},409);
    const job=await db('rpc/studkab_gen_start',{p_owner:user.id,p_request:input.request,
     p_input:prepared.snapshot,p_plan:prepared.plan,p_passport:passport.id,p_work_kind:kind,
     p_max_cost_microusd:Number(limit.max_cost_microusd)});
    return reply({job,status:'queued',passportRevision:passport.revision,workKind:kind,
     maxCostMicrousd:Number(limit.max_cost_microusd),estimatedCostMicrousd:prepared.estimatedTotal,remainingMicrousd:remaining});
   }
   if(input.action==='quality-review-estimate'||input.action==='quality-review-start'){
    const s=settings();if(!s.enabled)return reply({error:'GENERATION_NOT_CONFIGURED'},503);
    if(!uuid.test(input.request||'')||!uuid.test(input.versionId||''))return reply({error:'INVALID_INPUT'},400);
    const [requestRow]=await db('studkab_requests?id=eq.'+input.request+'&select=id,payload&limit=1');
    if(!requestRow)return reply({error:'REQUEST_NOT_FOUND'},404);
    if(!String(requestRow.payload?.n||'').trim())return reply({error:'STUDENT_NAME_REQUIRED'},409);
    const kind=workKind(requestRow.payload?.k);
    if(!kind)return reply({error:'WORK_TYPE_REQUIRED'},409);
    const [limit]=await db('studkab_gen_limits?work_kind=eq.'+kind+'&select=max_cost_microusd&limit=1');
    if(!limit)return reply({error:'WORK_LIMIT_NOT_CONFIGURED'},503);
    let context;
    try{context=await readReviewPacket(db,input.request,input.versionId);}
    catch(e){const code=String(e.message);return reply({error:/^(INVALID_INPUT|REVIEW_VERSION_STALE|PASSPORT_REQUIRED|REVIEW_MATERIALS_MISSING|REVIEW_MATERIALS_UNREADABLE|REVIEW_SYNTHETIC_PAID_BLOCKED|REVIEW_CONTEXT_TOO_BIG)$/.test(code)?code:'REVIEW_UNAVAILABLE'},409);}
    const materials=await materialManifestGuard((path,method,body)=>db(path,body),input.request,context.passport.id);
    if(materials)return reply(materials,409);
    const conflict=await sourceMinimumGuard(db,input.request,context.passport.items);
    if(conflict)return reply(conflict,409);
    const financeProfile=/FIN-UAT-01/.test([requestRow.payload?.rq,requestRow.payload?.mn].filter(Boolean).join('\n'));
    const prompt=reviewPrompt(context.packet,financeProfile);
    let prepared;
    try{prepared=prepare({request:input.request,materialFingerprint:context.passport.source_fingerprint,
      system:prompt.system,parts:[{id:'quality_review',prompt:prompt.user}],reviewMode:true,
      reviewTarget:{versionId:context.version.id,fileHash:context.version.file_hash,passportId:context.passport.id}},Number(limit.max_cost_microusd));}
    catch(e){return reply({error:e.message==='INPUT_TOO_BIG'?'REVIEW_CONTEXT_TOO_BIG':'REVIEW_UNAVAILABLE'},409);}
    const [b]=await db('studkab_gen_budget?id=eq.true&select=limit_microusd,reserved_microusd');
    const [policy]=await db('studkab_gen_policy?id=eq.true&select=temporary_total_microusd');
    const remaining=!!b&&!!policy?Math.min(Number(b.limit_microusd),Number(policy.temporary_total_microusd))-Number(b.reserved_microusd):0;
    const canStart=remaining>0&&prepared.estimatedTotal<=Number(limit.max_cost_microusd)&&prepared.estimatedTotal<=remaining;
    const estimate={status:'estimate',versionId:context.version.id,fileHash:context.version.file_hash,
      passportRevision:context.passport.revision,canStart,maxCostMicrousd:Number(limit.max_cost_microusd),
      estimatedCostMicrousd:prepared.estimatedTotal,remainingMicrousd:Math.max(0,remaining)};
    if(input.action==='quality-review-estimate')return reply(estimate);
    // The caller must acknowledge the exact server quote and immutable Word hash.
    if(!canStart)return reply({error:'BUDGET_BLOCKED'},409);
    if(input.confirmedEstimateMicrousd!==prepared.estimatedTotal||input.confirmedFileHash!==context.version.file_hash)
     return reply({error:'REVIEW_CONFIRMATION_REQUIRED',estimate},409);
    const job=await db('rpc/studkab_gen_start',{p_owner:user.id,p_request:input.request,
      p_input:prepared.snapshot,p_plan:prepared.plan,p_passport:context.passport.id,p_work_kind:kind,
      p_max_cost_microusd:Number(limit.max_cost_microusd)});
    return reply({job,status:'queued',reviewTarget:prepared.snapshot.review_target,
      estimatedCostMicrousd:prepared.estimatedTotal,maxCostMicrousd:Number(limit.max_cost_microusd)});
   }
   if(input.action==='quality-review-reports'){
    if(!uuid.test(input.request||'')||!uuid.test(input.versionId||''))return reply({error:'INVALID_INPUT'},400);
    const [version]=await db('studkab_result_versions?request_id=eq.'+input.request+'&select=id,file_hash&order=revision.desc&limit=1');
    if(!version||version.id!==input.versionId)return reply({error:'REVIEW_VERSION_STALE'},409);
    const [passport]=await db('studkab_requirement_passports?request_id=eq.'+input.request+'&select=id,status&order=revision.desc&limit=1');
    if(!passport||passport.status!=='approved')return reply({error:'PASSPORT_REQUIRED'},409);
    // The DB gate includes every matching job, including old owners and old
    // passports for these bytes. Paginate so an early failure cannot vanish.
    const jobs=[];
    for(let offset=0;offset<10000;offset+=100){
     const page=await db('studkab_gen_jobs?request_id=eq.'+input.request+
      '&snapshot->input->review_target->>fileHash=eq.'+version.file_hash+
      '&select=id,status,created_at,snapshot&order=created_at.desc,id.desc&limit=100&offset='+offset);
     jobs.push(...page);
     if(page.length<100)break;
     if(offset===9900)return reply({error:'REVIEW_HISTORY_TOO_LARGE'},409);
    }
    const reports=[];
    for(const job of jobs){
     const target=job.snapshot?.input?.review_target;
     if(target?.fileHash!==version.file_hash)continue;
     const [part]=await db('studkab_gen_parts?job_id=eq.'+job.id+'&spec->>id=eq.quality_review&select=state,result&limit=1');
     const report=part?.state==='done'?parseReviewReport(part.result,version.file_hash):null;
     reports.push({jobId:job.id,createdAt:job.created_at,passportId:target.passportId,
      current:target.versionId===version.id&&target.passportId===passport.id,
      status:job.status==='unknown'||part?.state==='unknown'?'unknown':
       part?.state==='done'?(report?'complete':'invalid'):
       job.status==='complete'?'invalid':job.status,report});
    }
    return reply({versionId:version.id,fileHash:version.file_hash,passportId:passport.id,reports});
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
    const [stored]=await db('studkab_gen_jobs?id=eq.'+input.job+'&owner_id=eq.'+encodeURIComponent(user.id)+'&select=id,request_id,version,status,created_at,snapshot');
    const job=stored&&{id:stored.id,request_id:stored.request_id,version:stored.version,status:stored.status,created_at:stored.created_at};
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
    return reply({job,reviewTarget:stored?.snapshot?.input?.review_target||null,diagnostics,parts:parts.map(p=>({ordinal:p.ordinal,id:p.spec?.id,section:p.spec?.section_id||p.spec?.id,state:p.state,text:p.state==='done'?p.result:null,
     failure:p.state==='unknown'?(p.failure_stage==='preparation'?{code:p.failure_reason}:failure(attempts.find(a=>a.ordinal===p.ordinal))):null}))});
   }
   return reply({error:'UNKNOWN_ACTION'},400);
  }catch{return reply({error:'SERVICE_UNAVAILABLE'},503);}
 };
}
