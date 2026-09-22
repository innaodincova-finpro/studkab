const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export async function materialRevisionAction(input,user,{db,config,isMember}){
 if(!uuid(input.id))return {status:400,data:{error:'Неверная заявка'}};
 const cfg=await config(),executor=!!cfg.executor_email&&(user.email||'').toLowerCase()===cfg.executor_email.toLowerCase();
 if(!executor&&(!isMember||!await isMember(user.id)))return {status:403,data:{error:'Нет доступа'}};
 const [row]=await db('studkab_requests?select=id,student_id&deleting_at=is.null&id=eq.'+input.id+(executor?'':'&student_id=eq.'+user.id));
 if(!row)return {status:404,data:{error:'Заявка не найдена'}};
 let result;
 if(input.action==='material-revision-state'){
  result=await db('rpc/studkab_material_revision_state','POST',{p_request:input.id,p_actor:user.id});
 }else{
  if(!uuid(input.cycleId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)return {status:400,data:{error:'Обновите материалы перед действием'}};
  const args={p_request:input.id,p_actor:user.id,p_cycle:input.cycleId,p_expected:input.expectedRevision};
  if(input.action==='material-revision-open'){
   if(!executor)return {status:403,data:{error:'Возврат открывает исполнитель'}};
   const reason=typeof input.reason==='string'?input.reason.trim():'';
   if(reason.length<10||reason.length>500)return {status:400,data:{error:'Укажите причину возврата: от 10 до 500 знаков'}};
   result=await db('rpc/studkab_material_revision_open','POST',{...args,p_reason:reason});
  }else if(input.action==='material-revision-complete'){
   if(executor||row.student_id!==user.id)return {status:403,data:{error:'Дополнение завершает автор заявки'}};
   result=await db('rpc/studkab_material_revision_complete','POST',args);
  }else return {status:400,data:{error:'Неизвестное действие'}};
 }
 return result.error?{status:409,data:result}:{status:200,data:result};
}
