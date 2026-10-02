const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function registeredStudyAction(input,user,{db,config}){
 const cfg=await config();
 if(!cfg.executor_email||typeof user.email!=='string'||user.email.toLowerCase()!==cfg.executor_email.toLowerCase())return {status:403,data:{error:'Изучение доступно исполнителю'}};
 if(!uuid.test(input.id||''))return {status:400,data:{error:'Неверная заявка'}};
 if(input.action==='registered-private-message'){
  if(!uuid.test(input.messageId||'')||typeof input.text!=='string'||!input.text.trim()||input.text.length>1000||!/^[a-f0-9]{64}$/.test(input.manifest||''))return {status:400,data:{error:'Проверьте приватный комментарий'}};
  const result=await db('rpc/studkab_private_dialog_send','POST',{p_request:input.id,p_actor:user.id,p_key:'web:'+input.messageId,p_body:input.text.trim(),p_manifest:input.manifest,p_channel:'web'});
  return result.ok?{data:{message:result}}:{status:409,data:{error:result.limited?'Достигнут предел комментариев текущего изучения':result.conflict?'Этот комментарий уже сохранён с другим текстом':'Комплект изменился. Обновите изучение перед отправкой'}};
 }

 if(input.action==='registered-material-classify'){
  if(!uuid.test(input.analysisId||'')||!uuid.test(input.fileId||'')||!['assignment','methodology','data','sources'].includes(input.category))return {status:400,data:{error:'Проверьте назначение файла'}};
  const result=await db('rpc/studkab_registered_material_classify','POST',{p_request:input.id,p_actor:user.id,p_analysis:input.analysisId,p_file:input.fileId,p_category:input.category});
  return result.saved?{data:{classification:result}}:{status:409,data:{error:'Назначение не подтверждено текущими источниками. Обновите изучение'}};
 }
 if(input.action==='registered-question-decide'){
  if(!uuid.test(input.proposalId||'')||!['publish','return'].includes(input.decision)||typeof input.text!=='string'||!input.text.trim()||input.text.length>(input.decision==='return'?1000:2000))return {status:400,data:{error:'Проверьте решение и текст'}};
  const result=await db('rpc/studkab_registered_question_decide','POST',{p_request:input.id,p_actor:user.id,p_proposal:input.proposalId,p_decision:input.decision,p_text:input.text.trim()});
  return result.id?{data:{proposal:result}}:{status:409,data:{error:result.stale?'Комплект изменился. Нужно повторное изучение':result.conflict?'Решение уже сохранено с другим текстом':'Не удалось сохранить решение. Обновите изучение'}};
 }
 const state=await db('rpc/studkab_registered_analysis_state','POST',{p_request:input.id,p_actor:user.id});
 if(state.missing)return {status:404,data:{error:'Заявка не найдена'}};
 if(state.state==='done')await db('rpc/studkab_registered_questions_refresh','POST',{p_request:input.id});
 const dialog=await db('rpc/studkab_private_dialog_read','POST',{p_request:input.id,p_actor:user.id});
 const proposals=await db('studkab_question_proposals?select=id,analysis_id,item_id,question,reason,evidence,state,published_text,return_comment,restudy_reason&request_id=eq.'+input.id+'&order=created_at.asc,id.asc&limit=100');
 return {data:{study:{...state,proposals,dialog:dialog.dialog,manifest:dialog.manifest}}};
}
