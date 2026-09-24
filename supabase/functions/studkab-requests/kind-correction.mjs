const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);

export async function kindCorrectionAction(input,user,{db,config}){
 const cfg=await config();
 if((user.email||'').toLowerCase()!==(cfg.executor_email||'').toLowerCase())return {status:403,data:{error:'Доступно только исполнителю'}};
 if(!uuid(input.id)||!uuid(input.operationId)||!uuid(input.assignmentId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0
  ||typeof input.expectedKind!=='string'||input.expectedKind.length<2||input.expectedKind.length>100
  ||typeof input.newKind!=='string'||input.newKind.length<2||input.newKind.length>100
  ||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>500)
  return {status:400,data:{error:'Проверьте вид работы, задание, причину и версию заявки'}};
 const result=await db('rpc/studkab_request_kind_correct','POST',{
  p_operation:input.operationId,p_request:input.id,p_actor:user.id,p_assignment:input.assignmentId,
  p_expected_revision:input.expectedRevision,p_expected_kind:input.expectedKind,
  p_new_kind:input.newKind,p_reason:input.reason.trim()
 });
 return result.error?{status:409,data:result}:{status:200,data:result};
}
