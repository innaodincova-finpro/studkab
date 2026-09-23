const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/;
export const testDeliveryLabel='Тестовый файл — проверка качества не завершена';
export async function testDeliveryAction(input,user,{db,config}){
 if(!uuid.test(input.id||''))return {status:400,data:{error:'Неверная заявка'}};
 if(input.action!=='test-result'){
  const cfg=await config();
  if(!user.email||user.email.toLowerCase()!==cfg.executor_email?.toLowerCase())return {status:403,data:{error:'Тестовая передача доступна только исполнителю'}};
 }
 let result;
 if(input.action==='test-delivery-state'){
  result=await db('rpc/studkab_test_delivery_context','POST',{p_request:input.id,p_actor:user.id,p_executor_only:true});
  if(typeof result?.eligible!=='boolean')return {status:409,data:{error:'Не удалось проверить доступ к тестовой передаче'}};
  return {data:{testDeliveryState:result}};
 }
 if(input.action==='test-deliver'){
  if(['versionId','deliveryId','recipientId','passportId'].some(k=>!uuid.test(input[k]||''))||['fileHash','documentHash','sourceFingerprint'].some(k=>!hash.test(input[k]||'')))return {status:400,data:{error:'Обновите сведения о тестовом файле'}};
  result=await db('rpc/studkab_test_deliver','POST',{p_request:input.id,p_actor:user.id,p_delivery:input.deliveryId,p_version:input.versionId,p_recipient:input.recipientId,p_file_hash:input.fileHash,p_document_hash:input.documentHash,p_passport:input.passportId,p_source_fingerprint:input.sourceFingerprint});
  if(!result?.error&&result?.qualityStatus==='incomplete'&&uuid.test(result.deliveryId||''))return {data:{testDelivery:{...result,label:testDeliveryLabel}}};
 }else if(input.action==='test-result'){
  result=await db('rpc/studkab_test_result','POST',{p_request:input.id,p_actor:user.id,p_include_file:input.includeFile===true});
  if(!result?.error&&(result?.testDelivery===null||result?.testDelivery?.qualityStatus==='incomplete'))return {data:result};
 }else return {status:400,data:{error:'Неизвестное действие'}};
 const code=['FORBIDDEN','TEST_ACCESS_UNAVAILABLE','TEST_NOT_ALLOWED','MATERIAL_REVISION_OPEN','MATERIAL_MANIFEST_REQUIRED','TEST_VERSION_CHANGED','TEST_OPERATION_CONFLICT'].includes(result?.error)?result.error:'TEST_UNAVAILABLE';
 return {status:code==='FORBIDDEN'?403:409,data:{error:'Тестовый файл недоступен. Проверьте допуск, получателя и актуальную версию.',code}};
}
