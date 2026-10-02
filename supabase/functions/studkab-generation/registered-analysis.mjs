import {registeredAnalysisPlan} from '../_shared/registered-review.mjs';
// Machine-only enqueue; existing dispatch remains the sole paid budget gate.
export async function queueRegisteredAnalysis({rpc}){
 let source;
 try{source=await rpc('studkab_registered_analysis_next',{});}catch{return {status:'registered_analysis_source_unavailable'};}
 if(!source)return null;
 let plan;try{plan=registeredAnalysisPlan(source);}catch{
  try{await rpc('studkab_registered_analysis_block',{p_request:source.requestId,p_manifest:source.manifest});}catch{return {status:'registered_analysis_block_unconfirmed'};}
  return {status:'registered_analysis_preparation_blocked'};
 }
 try{
  const saved=await rpc('studkab_registered_analysis_start',{p_request:source.requestId,p_manifest:source.manifest,p_plan:plan});
  return {status:saved.id?'registered_analysis_queued':saved.reconciliation?'registered_analysis_reconciliation':saved.budget?'registered_analysis_budget':saved.disabled?'registered_analysis_disabled':'registered_analysis_stale'};
 }catch{return {status:'registered_analysis_enqueue_unconfirmed'};}
}
