import {SYSTEM,verifyExtraction,distribute,validAnalysisPart} from '../_shared/intake-analysis.mjs';
import {REVIEW_SYSTEM,validReviewPart,verifyKitReview,finishRegisteredReview} from '../_shared/registered-review.mjs';
import {CHECKLIST_INVENTORY_SYSTEM} from '../_shared/kit-checklist.mjs';
import {isChecklistPart,validChecklistPart,checklistInventoryResult,checklistReviewRequest,checklistReviewOutput,finishChecklistReview,reviewSystem} from '../_shared/checklist-review.mjs';
import {KIT_EXTRACTION_SYSTEM,KIT_REVIEW_SYSTEM,isKitPart,validKitPart,verifyKitExtraction,verifyKitReviewOutput,finishKitReview} from '../_shared/kit-analysis.mjs';
// Called only behind the existing machine authorization + cron secret.
export async function runIntake({rpc,provider}){
 let c;try{c=await rpc('studkab_intake_analysis_claim',{});}catch{return {status:'intake_claim_unavailable'};}
 if(!c)return null;
 let part=c.part;
 const kit=isKitPart(part),list=isChecklistPart(part);
 let prepared=false;
 const review=part?.kind==='kit_review';
 // KIT-06: запрос шага 2 пошаговой проверки собирается из сохранённого результата шага 1.
 try{prepared=list?validChecklistPart(part,c.ordinal,c.parts)&&(!review||!!(part=checklistReviewRequest(part,c.previous?.[1]))):kit?validKitPart(part,c.ordinal,c.parts):review?validReviewPart(part,c.ordinal,c.parts):validAnalysisPart(part,c.ordinal,part.extraction_parts===c.parts-1?part.extraction_parts:c.parts);}catch{}
 if(!prepared){
  try{await rpc('studkab_intake_analysis_fail_claim',{p_job:c.job_id,p_claim:c.claim});}catch{return {status:'intake_block_unconfirmed',job:c.job_id};}
  return {status:'intake_preparation_blocked',job:c.job_id};
 }
 let id;
 try{id=await rpc('studkab_intake_analysis_dispatch',{p_job:c.job_id,p_claim:c.claim,p_cost:part.max_cost_microusd});}
 catch{return {status:'intake_dispatch_unconfirmed',job:c.job_id};}
 if(!id)return {status:'intake_budget_or_stale',job:c.job_id};
 const system=list?(review?reviewSystem(part):part.kind==='checklist_inventory'?CHECKLIST_INVENTORY_SYSTEM:KIT_EXTRACTION_SYSTEM):kit?(review?KIT_REVIEW_SYSTEM:KIT_EXTRACTION_SYSTEM):review?REVIEW_SYSTEM:SYSTEM;
 let output;try{output=await provider({input:{system},spec:part},id);}catch{output=null;}
 let parsed=null,error=output?.detail?.reason==='length'?'length':null,result=null,raw=null,reason=null;
 if(output?.complete===true&&typeof output.text==='string'&&new TextEncoder().encode(output.text).byteLength<=100000){
  raw=output.text;
  try{
   parsed=list?(review?checklistReviewOutput(raw,part,c.previous[1]):part.kind==='checklist_inventory'?checklistInventoryResult(raw,part):verifyKitExtraction(raw,part)):kit?(review?verifyKitReviewOutput(raw,part):verifyKitExtraction(raw,part)):review?verifyKitReview(raw,part):verifyExtraction(raw,part);
   if(c.ordinal+1===c.parts)result=list?finishChecklistReview(c.previous,parsed):kit?finishKitReview(c.previous,parsed):review?finishRegisteredReview(c.previous,parsed):distribute([...c.previous,parsed]);
  }catch(e){error='invalid';parsed=null;reason=String(e?.message||'').slice(0,80);}
 }
 // KIT-02: причина брака сохраняется в журнале ответа (error), сам ответ модели не меняется.
 if((kit||list)&&error==='invalid'&&reason)error='invalid:'+reason.replace(/[^A-Z_]/g,'').slice(0,60);
 try{const state=await rpc('studkab_intake_analysis_finish',{p_job:c.job_id,p_claim:c.claim,p_request:id,p_part:parsed,p_result:result,p_raw:raw,p_error:error});return {status:'intake_'+state,job:c.job_id,...(reason?{check:reason}:{})};}
 catch{return {status:'intake_save_unconfirmed',job:c.job_id};}
}
