// Unpaid server kit acceptance and durable reads. No inference/network adapters.
import {ASSISTANTS,collectAssistantBundle,assistantManifest,snapshotJson} from '../_shared/assistant-bundle.mjs';
import {returnAssistantWord} from '../_shared/assistant-result.mjs';
import {prepareDirectAssistant} from '../_shared/direct-assistant.mjs';
import {prepareDeepseekAssistant} from '../_shared/deepseek-assistant.mjs';
import {ORIGINALS_PROTOCOL,ORIGINALS_OUTPUTS} from '../_shared/assistant-originals.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export const ASSISTANT_ACTIONS=['assistant-capabilities','assistant-prepare','assistant-preflight','assistant-start','assistant-state','assistant-review'];
export function assistantCapabilities(capabilities){return {providers:ASSISTANTS.map(provider=>({provider,...(capabilities?.[provider]||(provider==='deepseek'&&capabilities?.available!==undefined?capabilities:{available:false,reason:'not_connected'}))}))};}
export async function deepseekCapability(actor,{rpc,enabled=false,configured=false,probe}){
 let budget;try{budget=await rpc('studkab_assistant_budget',{p_actor:actor});}catch{return {available:false,reason:'budget_unavailable'};}
 if(budget?.budgetAvailable!==true)return {available:false,reason:'budget_exhausted'};
 if(!configured)return {available:false,reason:'not_connected'};
 if(!enabled)return {available:false,reason:'worker_disabled'};
 if(typeof probe!=='function'||(await probe())?.verified!==true)return {available:false,reason:'worker_unverified'};
 return {available:true,reason:'ready'};
}
function validPlan(plan){
 if(!Array.isArray(plan)||!plan.length||plan.length>96||plan.some(x=>typeof x!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(x))||new Set(plan).size!==plan.length)throw Error('PLAN_REQUIRED');
 return [...plan];
}
function checked(value){if(!value||value.error)throw Error(value?.error||'ASSISTANT_UNAVAILABLE');return value;}
export function approvedAssistantPlan(source,passport){
 // Numbered lines are explicit order from an approved requirement. Plain prose
 // and comma-separated suggestions are not a reliable server section plan.
 const items=passport?.items?.filter(i=>i.id==='STRUCTURE'&&i.verified===true)||[];
 if(passport?.status!=='approved'||items.length!==1)throw Error('PLAN_REQUIRED');
 const lines=String(items[0].text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 if(lines[0]&&/^Структура\s*:?$/i.test(lines[0]))lines.shift();
 const plan=[],numbers=new Set();
 for(const line of lines){
  const match=/^(\d+(?:\.\d+)*)[.)]?\s+(.{1,200})$/.exec(line);
  if(!match||numbers.has(match[1]))throw Error('PLAN_REQUIRED');
  numbers.add(match[1]);plan.push('section_'+match[1].replaceAll('.','_'));
 }
 return validPlan(plan);
}
export async function prepareAssistant(input,user,{rpc,loadRequestFile,planSections=approvedAssistantPlan,sourcePlan,validateBundle}){
 if(!uuid(input.id)||!uuid(input.operation)||!ASSISTANTS.includes(input.provider)||!uuid(user?.id))throw Error('INVALID_INPUT');
 const source=checked(await rpc('studkab_assistant_snapshot',{p_request:input.id,p_actor:user.id}));
 if(source.request?.id!==input.id||source.attachmentsComplete!==true||!source.context||!source.basis)throw Error('INCOMPLETE_SNAPSHOT');
 const passports=source.context.passports;
 if(!Array.isArray(passports)||!Array.isArray(source.context.answers)||!Array.isArray(source.context.materialRevisions))throw Error('INCOMPLETE_SNAPSHOT');
 // The owner replaced the internal reading/passport prerequisite. These
 // identifiers describe the two outputs, not the assignment's section plan.
 const sections=[...ORIGINALS_OUTPUTS];
 const bundle=await collectAssistantBundle({...source,provider:input.provider,context:{...source.context,payload:source.request.payload,transferProtocol:ORIGINALS_PROTOCOL}},{loadRequestFile});
 if(validateBundle)await validateBundle(bundle,sections);
 const snapshot={...assistantManifest(bundle),fingerprint:bundle.fingerprint};
 const accepted=checked(await rpc('studkab_assistant_accept',{p_request:input.id,p_actor:user.id,p_provider:input.provider,p_operation:input.operation,p_revision:bundle.revision,p_fingerprint:bundle.fingerprint,p_basis:source.basis,p_snapshot:snapshot,p_sections:sections}));
 const states=['prepared','queued','claimed','dispatched','completed','returning','returned','unknown','cancelled'];
 if(!uuid(accepted.jobId)||!accepted.acceptedAt||!states.includes(accepted.state)||(accepted.duplicate!==true&&accepted.state!=='prepared'))throw Error('ACCEPTANCE_NOT_CONFIRMED');
 return {...accepted,planReady:sections.length>0,receipt:{requestId:input.id,provider:input.provider,operationId:input.operation,revision:bundle.revision,fingerprint:bundle.fingerprint,acceptedAt:accepted.acceptedAt,files:snapshot.files}};
}
// Only a trusted worker invokes this function. HTTP routes cannot supply a
// bundle/snapshot or bypass the stored current-job/claim checks.
export async function returnAssistantResult(jobId,actor,response,{rpc,saveResult}){
 if(!uuid(jobId)||!uuid(actor)||response?.jobId!==jobId)throw Error('INVALID_INPUT');
 const stored=checked(await rpc('studkab_assistant_return_snapshot',{p_job:jobId,p_actor:actor}));
 if(!stored.response||JSON.stringify(snapshotJson(stored.response))!==JSON.stringify(snapshotJson(response)))throw Error('RESULT_RESPONSE_CHANGED');
 const bundle=stored.snapshot;
 if(!bundle||bundle.schema!==2)throw Error('INCOMPLETE_SNAPSHOT');
 return returnAssistantWord(bundle,response,{
  beginReturn:({revision,fingerprint})=>rpc('studkab_assistant_begin_return',{p_job:jobId,p_actor:actor,p_revision:revision,p_fingerprint:fingerprint}),
  saveResult,
  commitReturn:({claim,revision,fingerprint,name,type,size,hash,path})=>rpc('studkab_assistant_commit_return',{p_job:jobId,p_actor:actor,p_claim:claim,p_revision:revision,p_fingerprint:fingerprint,p_name:name,p_type:type,p_size:size,p_hash:hash,p_path:path}),
  failReturn:({claim})=>rpc('studkab_assistant_fail_return',{p_job:jobId,p_actor:actor,p_claim:claim})
 });
}
export async function assistantAction(input,user,{config,rpc,loadRequestFile,saveResult,planSections,sourcePlan,readFile,capability,providerConfig,fetchProvider}){
 if(input.action==='assistant-state'){
  if(!uuid(input.id)||!uuid(user?.id)||(input.operation!=null&&!uuid(input.operation)))return {status:400,data:{error:'INVALID_INPUT'}};
  const state=checked(await rpc('studkab_assistant_state',{p_request:input.id,p_actor:user.id,...(input.operation?{p_operation:input.operation}:{})}));
  return {data:state}; // RPC projects by role; no private snapshot/bytes here.
 }
 const cfg=await config();
 if(!cfg?.executor_email||String(user?.email||'').toLowerCase()!==cfg.executor_email.toLowerCase())return {status:403,data:{error:'FORBIDDEN'}};
 if(input.action==='assistant-capabilities')return {data:assistantCapabilities(capability?Object.fromEntries(await Promise.all(ASSISTANTS.map(async p=>[p,await capability(user.id,p)]))):null)};
 if(input.action==='assistant-preflight'||input.action==='assistant-start'){
  if(!ASSISTANTS.includes(input.provider)||!capability||(await capability(user.id,input.provider)).available!==true)return {status:409,data:{error:'PROVIDER_NOT_CONNECTED'}};
  try{
   if(input.action==='assistant-start'){
    if(!uuid(input.id)||!uuid(input.operation)||input.confirmed!==true||!uuid(input.quoteId)||!Number.isSafeInteger(input.confirmedMicrousd)||input.confirmedMicrousd<1)return {status:409,data:{error:'PAID_CONFIRMATION_REQUIRED'}};
    const current=checked(await rpc('studkab_assistant_state',{p_request:input.id,p_actor:user.id,p_operation:input.operation}));
    if(current.accepted!==true||!uuid(current.job?.id)||current.job.provider!==input.provider||current.job.bindingCurrent!==true)throw Error('QUOTE_BINDING_CHANGED');
    if(input.provider!=='deepseek'){
     const stored=checked(await rpc('studkab_assistant_return_snapshot',{p_job:current.job.id,p_actor:user.id}));
     const source=checked(await rpc('studkab_assistant_snapshot',{p_request:input.id,p_actor:user.id}));
     const bundle=await collectAssistantBundle({...source,provider:input.provider,context:{...source.context,payload:source.request.payload,...(stored.snapshot?.context?.transferProtocol?{transferProtocol:stored.snapshot.context.transferProtocol}:{})}},{loadRequestFile});
     if(bundle.fingerprint!==stored.fingerprint)throw Error('MATERIALS_CHANGED');
     const prompt=await prepareDirectAssistant(bundle,stored.expectedSections,{readFile,config:providerConfig?.(input.provider),fetchProvider});
     const checkedQuote=checked(await rpc('studkab_assistant_quote',{p_job:current.job.id,p_actor:user.id,p_estimated:prompt.estimatedMicrousd,p_model:prompt.model,p_pricing_fingerprint:prompt.pricingFingerprint}));
     if(checkedQuote.quoteId!==input.quoteId)throw Error('QUOTE_BINDING_CHANGED');
    }
    const queued=checked(await rpc('studkab_assistant_confirm_queue',{p_job:current.job.id,p_actor:user.id,p_quote:input.quoteId,p_confirmed_microusd:input.confirmedMicrousd}));
    if(queued.ok!==true)throw Error('QUEUE_NOT_CONFIRMED');
    return {data:{jobId:current.job.id,duplicate:queued.duplicate===true,state:'queued',queued:true,receipt:{requestId:input.id,provider:input.provider,operationId:input.operation,revision:current.job.revision,fingerprint:current.job.fingerprint,acceptedAt:current.job.acceptedAt}}};
   }
   let preflightPrompt;
   const accepted=await prepareAssistant(input,user,{rpc,loadRequestFile,planSections,sourcePlan,
    validateBundle:input.action==='assistant-preflight'?async(bundle,sections)=>{preflightPrompt=input.provider==='deepseek'?await prepareDeepseekAssistant(bundle,sections,{readFile}):await prepareDirectAssistant(bundle,sections,{readFile,config:providerConfig?.(input.provider),fetchProvider});}:null});
   if(!accepted.planReady)return {status:409,data:{error:'REQUIREMENTS_PLANNING_REQUIRED',receipt:accepted.receipt,jobId:accepted.jobId}};
   if(input.action==='assistant-preflight'){
    const stored=checked(await rpc('studkab_assistant_return_snapshot',{p_job:accepted.jobId,p_actor:user.id}));
    const source=checked(await rpc('studkab_assistant_snapshot',{p_request:input.id,p_actor:user.id}));
    const bundle=await collectAssistantBundle({...source,provider:input.provider,context:{...source.context,payload:source.request.payload,...(stored.snapshot?.context?.transferProtocol?{transferProtocol:stored.snapshot.context.transferProtocol}:{})}},{loadRequestFile});
    if(bundle.fingerprint!==stored.fingerprint)throw Error('MATERIALS_CHANGED');
    const prompt=preflightPrompt||(input.provider==='deepseek'?await prepareDeepseekAssistant(bundle,stored.expectedSections,{readFile}):await prepareDirectAssistant(bundle,stored.expectedSections,{readFile,config:providerConfig?.(input.provider),fetchProvider}));
    const quote=checked(await rpc('studkab_assistant_quote',{p_job:accepted.jobId,p_actor:user.id,p_estimated:prompt.estimatedMicrousd,...(input.provider==='deepseek'?{}:{p_model:prompt.model,p_pricing_fingerprint:prompt.pricingFingerprint})}));
    if(quote.ok!==true)return {status:409,data:{error:'BUDGET_EXHAUSTED',receipt:accepted.receipt,jobId:accepted.jobId}};
    return {data:{...accepted,quoteId:quote.quoteId,priceMicrousd:quote.estimatedMicrousd,requiresConfirmation:true}};
   }
  }catch(e){return {status:409,data:{error:e.message||'ASSISTANT_UNAVAILABLE'}};}
 }
 if(input.action==='assistant-review'){
  if(!uuid(input.jobId)||!/^[a-f0-9]{64}$/.test(String(input.hash||'')))return {status:400,data:{error:'INVALID_INPUT'}};
  const reviewed=checked(await rpc('studkab_assistant_review',{p_job:input.jobId,p_actor:user.id,p_hash:input.hash}));
  if(reviewed.ok!==true)return {status:409,data:{error:'REVIEW_NOT_CONFIRMED'}};
  return {data:reviewed};
 }
 try{return {data:await prepareAssistant(input,user,{rpc,loadRequestFile,saveResult,planSections,sourcePlan})};}
 catch(e){return {status:409,data:{error:e.message||'ASSISTANT_UNAVAILABLE'}};}
}
