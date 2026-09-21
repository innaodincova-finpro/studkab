const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export async function clarificationAction(input,user,{db,config,isMember}){
 if(!uuid(input.id))return {status:400,data:{error:'Неверная заявка'}};
 const cfg=await config(),executor=!!cfg.executor_email&&(user.email||'').toLowerCase()===cfg.executor_email.toLowerCase();
 if(!executor&&(!isMember||!await isMember(user.id)))return {status:403,data:{error:'Нет доступа'}};
 const [row]=await db('studkab_requests?select=id,student_id&deleting_at=is.null&id=eq.'+input.id+(executor?'':'&student_id=eq.'+user.id));
 if(!row)return {status:404,data:{error:'Заявка не найдена'}};
 if(input.action==='clarification-list')return {data:{questions:await db('studkab_clarifications?select=id,item_id,question,answer,answer_source,created_at,answered_at&request_id=eq.'+input.id+'&order=created_at.asc,id.asc&limit=100')}};
 if(!uuid(input.questionId))return {status:400,data:{error:'Неверный вопрос'}};
 const clean=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max?value.trim():null;
 if(input.action==='clarification-ask'){
  if(!executor)return {status:403,data:{error:'Вопрос создаёт исполнитель'}};
  const question=clean(input.question,2000),item=clean(input.itemId,80);
  if(!question||!item||!/^[A-Za-z0-9_-]+$/.test(item))return {status:400,data:{error:'Укажите пункт и вопрос'}};
  const result=await db('rpc/studkab_clarification_ask','POST',{p_request:input.id,p_actor:user.id,p_id:input.questionId,p_item:item,p_question:question});
  return result.error?{status:409,data:result}:{data:{question:result}};
 }
 if(input.action==='clarification-answer'){
  if(row.student_id!==user.id)return {status:403,data:{error:'Ответ доступен студенту этой заявки'}};
  const answer=clean(input.answer,4000),source=clean(input.source,1000);
  if(!answer||!source)return {status:400,data:{error:'Напишите ответ и его основание: документ, страницу или пояснение преподавателя'}};
  const result=await db('rpc/studkab_clarification_answer','POST',{p_request:input.id,p_actor:user.id,p_id:input.questionId,p_answer:answer,p_source:source});
  return result.error?{status:409,data:result}:{data:{question:result}};
 }
 return {status:400,data:{error:'Неизвестное действие'}};
}
