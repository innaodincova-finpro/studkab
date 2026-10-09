// Runs only inside the authenticated existing cron worker. No new schedule.
import {dispatchDeepseekAssistant} from '../_shared/deepseek-assistant.mjs';
import {verifyAssistantManifest,digest} from '../_shared/assistant-bundle.mjs';
import {returnAssistantResult} from '../studkab-requests/assistant-service.mjs';
export async function runAssistant({actor,rpc,loadRequestFile,readFile,saveResult,proxyToken,fetchProxy,recoveryOnly=false}){
 const c=await rpc(recoveryOnly?'studkab_assistant_recover_next':'studkab_assistant_claim_next',{p_actor:actor});
 if(c?.recovery===true){
  const stored=await rpc('studkab_assistant_return_snapshot',{p_job:c.jobId,p_actor:actor});
  try{await returnAssistantResult(c.jobId,actor,stored.response,{rpc,saveResult});return {status:'assistant_returned',job:c.jobId};}
  catch{return {status:'assistant_return_pending',job:c.jobId};}
 }
 if(!c?.allowed)return null;
 if(recoveryOnly)throw Error('INVALID_RECOVERY_CLAIM');
 let dispatched=null,response;
 try{
  const bundle={...c.snapshot,files:[]};
  await verifyAssistantManifest(c.snapshot);
  for(const f of c.snapshot.files){
   const metadata=c.basis?.attachments?.find(a=>a.id===f.id);
   if(!metadata||metadata.request_id!==bundle.requestId||metadata.file_hash!==f.hash||metadata.size_bytes!==f.size||!metadata.storage_path)throw Error('INCOMPLETE_SNAPSHOT');
   const bytes=await loadRequestFile(metadata.storage_path,f.size,f.hash);
   if(!(bytes instanceof Uint8Array)||bytes.length!==f.size||await digest(bytes)!==f.hash)throw Error('DAMAGED_ATTACHMENT');
   bundle.files.push({...f,bytes});
  }
  response=await dispatchDeepseekAssistant(bundle,c.jobId,c.claim,c.expectedSections,{readFile,proxyToken,fetchProxy,
   reserveAndDispatch:async({estimatedMicrousd,model})=>{
    const permit=await rpc('studkab_assistant_reserve_dispatch',{p_job:c.jobId,p_actor:actor,p_claim:c.claim,p_estimated:estimatedMicrousd,p_model:model});
    if(permit?.ok===true)dispatched=permit.dispatchId;
    return permit;
   }});
 }catch(e){
  if(dispatched){
   try{await rpc('studkab_assistant_unknown',{p_job:c.jobId,p_actor:actor,p_claim:c.claim,p_dispatch:dispatched});}catch{}
   return {status:'assistant_unknown',job:c.jobId};
  }
  // An uncertain reservation response must not cause another model request.
  // The SQL lease recovery reconciles any financial attempt atomically.
  try{await rpc('studkab_assistant_fail_claim',{p_job:c.jobId,p_actor:actor,p_claim:c.claim});}catch{}
  return {status:'assistant_blocked',job:c.jobId,code:e.message==='BUDGET_NOT_CONFIRMED'?'budget':'materials_or_requirements'};
 }
 try{
  const saved=await rpc('studkab_assistant_complete',{p_job:c.jobId,p_actor:actor,p_claim:c.claim,p_response:response});
  if(saved?.ok!==true)return {status:'assistant_save_unconfirmed',job:c.jobId};
 }catch{return {status:'assistant_save_unconfirmed',job:c.jobId};}
 try{await returnAssistantResult(c.jobId,actor,response,{rpc,saveResult});return {status:'assistant_returned',job:c.jobId};}
 catch{return {status:'assistant_return_pending',job:c.jobId};}
}
