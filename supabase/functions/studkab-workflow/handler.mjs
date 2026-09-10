const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS={
 initialize_request:{role:'service',rpc:'studkab_initialize_request'},
 transition_request:{role:'executor',rpc:'studkab_transition_request'},
 prepare_upload:{role:'student',rpc:'studkab_prepare_upload'},
 accept_upload:{role:'service',rpc:'studkab_accept_upload'},
 submit_passport:{role:'executor',rpc:'studkab_submit_passport'},
 approve_passport:{role:'executor',rpc:'studkab_approve_passport'},
 ask_clarification:{role:'executor',rpc:'studkab_ask_clarification'},
 answer_clarification:{role:'student',rpc:'studkab_answer_clarification'},
 create_document_version:{role:'executor',rpc:'studkab_create_document_version'},
 record_checks:{role:'executor',rpc:'studkab_record_checks'},
 approve_document:{role:'executor',rpc:'studkab_approve_document'},
 deliver_document:{role:'executor',rpc:'studkab_deliver_document'},
 download_document:{role:'student',rpc:'studkab_get_delivered_document'}
 ,get_snapshot:{role:'user',rpc:'studkab_get_workflow_snapshot'}
};
const headers={'access-control-allow-origin':'https://innaodincova-finpro.github.io','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST,OPTIONS','content-type':'application/json','cache-control':'no-store'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
export function validateCommand(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Неверная команда');
 if(!ACTIONS[value.action])throw Error('Неизвестная команда');
 if(!UUID.test(value.requestId||''))throw Error('Неверный номер заявки');
 if(!UUID.test(value.commandId||''))throw Error('Неверный номер команды');
 const payload=value.payload??{};
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Неверные параметры команды');
 const encoded=JSON.stringify(payload);
 if(encoded.length>4000000)throw Error('Команда слишком большая');
 return {action:value.action,requestId:value.requestId,commandId:value.commandId,payload};
}
export function handler({auth,isExecutor,execute,serviceKey}){
 return async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return json({error:'Используйте POST'},405);
  try{
   const raw=await req.text();
   if(raw.length>4000000)return json({error:'Команда слишком большая'},413);
   let input;try{input=validateCommand(JSON.parse(raw));}catch(e){return json({error:e.message},400);}
   const rule=ACTIONS[input.action];
   let user=null;
   if(rule.role==='service'){
    if(!serviceKey||req.headers.get('x-studkab-service-key')!==serviceKey)return json({error:'Нет доступа'},403);
   }else{
    const bearer=req.headers.get('authorization');
    user=bearer?.startsWith('Bearer ')?await auth(bearer):null;
    if(!user||!user.email_confirmed_at||user.is_anonymous)return json({error:'Сначала войдите в аккаунт приложения'},401);
    if(rule.role==='executor'&&!(await isExecutor(user.id)))return json({error:'Команда доступна только исполнителю'},403);
   }
   const result=await execute(rule.rpc,{request:input.requestId,command_id:input.commandId,actor:user?.id??null,payload:input.payload});
   return json({ok:true,result});
  }catch(e){
   const code=String(e?.message||'');
   if(code.includes('revision_conflict'))return json({error:'Документ изменился. Обновите данные и повторите действие.'},409);
   if(code.includes('workflow_disabled'))return json({error:'Новый процесс пока не включён'},503);
   if(code.includes('not_owner'))return json({error:'Нет доступа к этой заявке'},403);
   if(code.includes('not_found'))return json({error:'Заявка не найдена'},404);
   return json({error:'Сервис временно недоступен'},503);
  }
 };
}
