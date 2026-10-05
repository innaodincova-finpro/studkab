// ROUTE-03, R3-F: исполнителю — «Работу вернули на доработку».
// Push на устройства исполнителя (один раз на устройство и возврат) и Telegram владельцу (с повтором при сбое).
const REGISTRY='https://innaodincova-finpro.github.io/studkab/reestr.html#request=';

export async function returnPush({db,send,sub,configuration}){
 let sent=0,failed=0;
 const rows=await db('rpc/studkab_r3_return_push_targets','POST',{p_subscription:sub.id});
 for(const row of Array.isArray(rows)?rows:[]){
  const key=sub.id+':r3return:'+row.request_id+':'+row.n;
  if(!await db('rpc/claim_studkab_push_delivery','POST',{delivery_key:key,subscription_id:sub.id}))continue;
  try{
   const [currentSub]=await db('studkab_push_subscriptions?id=eq.'+sub.id+'&enabled=eq.true');
   if(!currentSub){await db('studkab_push_deliveries?key=eq.'+encodeURIComponent(key),'PATCH',{sent_at:new Date().toISOString(),result:'cancelled'});continue;}
   await send(currentSub,{title:'Реестр заявок',body:'Заявку №'+row.number+' вернули на доработку. Откройте замечания.',tag:key,url:'./reestr.html#request='+row.request_id},configuration);
   const at=new Date().toISOString();
   await db('studkab_push_deliveries?key=eq.'+encodeURIComponent(key),'PATCH',{sent_at:at,result:'accepted'});
   await db('studkab_push_subscriptions?id=eq.'+sub.id,'PATCH',{last_sent_at:at,last_error:null});sent++;
  }catch{failed++;await db('studkab_push_subscriptions?id=eq.'+sub.id,'PATCH',{last_error:'Уведомление о возврате не доставлено. Сервер повторит попытку.'});}
 }
 return {sent,failed};
}

export async function returnTelegram({db,fetch,token,now=Date.now}){
 let sent=0,failed=0;
 const rows=await db('rpc/claim_studkab_r3_return_telegram','POST',{});
 for(const row of Array.isArray(rows)?rows:[]){
  const path='studkab_r3_returns?request_id=eq.'+row.request_id+'&n=eq.'+row.n;
  try{
   const [owner]=await db('studkab_telegram_setup?id=eq.true&select=owner_chat_id,installed');
   if(!owner?.installed||!owner.owner_chat_id||!token)throw Error('Telegram recipient unavailable');
   const response=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:owner.owner_chat_id,text:'Студент вернул работу по заявке №'+row.number+' на доработку. Замечания преподавателя — в карточке заявки.',
     reply_markup:{inline_keyboard:[[{text:'Открыть заявку',url:REGISTRY+row.request_id}]]}}),signal:AbortSignal.timeout(10000)});
   if(!response.ok||(await response.json()).ok!==true)throw Error('Telegram unavailable');
   await db(path,'PATCH',{telegram_sent_at:new Date(now()).toISOString(),telegram_lease_until:null});sent++;
  }catch{
   failed++;
   await db(path,'PATCH',{telegram_lease_until:null,telegram_retry_at:new Date(now()+Math.min(3600000,60000*2**Math.min(row.telegram_attempts||1,10))).toISOString()});
  }
 }
 return {sent,failed};
}
