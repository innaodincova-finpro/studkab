import {registeredAnalysisPlan,REVIEW_VERSION} from '../_shared/registered-review.mjs';
import {kitPlan} from '../_shared/kit-analysis.mjs';
import {checklistPlan} from '../_shared/checklist-review.mjs';
import {CHECKLIST_METHOD} from '../_shared/kit-checklist.mjs';
// Machine-only enqueue; existing dispatch remains the sole paid budget gate.
// KIT-02: зарегистрированная заявка изучается целиком (whole-kit-2) либо, если сервер
// выбрал method='checklist-3' (KIT-06), пошаговой проверкой: сведения, перечень нужного,
// затем заключение с оценкой ответов студента и возвращённых вопросов.
export async function queueRegisteredAnalysis({rpc,method}){
 let source;
 try{source=await rpc('studkab_registered_analysis_next',{});}catch{return {status:'registered_analysis_source_unavailable'};}
 if(!source)return null;
 let asked=[];
 const list=method===CHECKLIST_METHOD&&source.studyProtocol===REVIEW_VERSION;
 if(list&&(source.reviewInstructions||[]).some(i=>i.proposalId)){
  try{asked=await rpc('studkab_registered_returned_questions',{p_request:source.requestId});}catch{return {status:'registered_analysis_source_unavailable'};}
 }
 let plan;try{plan=list?checklistPlan(source,asked):source.studyProtocol===REVIEW_VERSION?kitPlan(source):registeredAnalysisPlan(source);}catch{
  try{await rpc('studkab_registered_analysis_block',{p_request:source.requestId,p_manifest:source.manifest});}catch{return {status:'registered_analysis_block_unconfirmed'};}
  return {status:'registered_analysis_preparation_blocked'};
 }
 try{
  const saved=await rpc('studkab_registered_analysis_start',{p_request:source.requestId,p_manifest:source.manifest,p_plan:plan});
  return {status:saved.id?'registered_analysis_queued':saved.reconciliation?'registered_analysis_reconciliation':saved.budget?'registered_analysis_budget':saved.disabled?'registered_analysis_disabled':saved.invalid?'registered_analysis_invalid':'registered_analysis_stale'};
 }catch{return {status:'registered_analysis_enqueue_unconfirmed'};}
}
