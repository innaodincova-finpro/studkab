// C175: only publication events snapshotted for the executor's enabled devices.
export async function requestPush({db,send,configuration,now=Date.now}){
 let sent=0,failed=0,cursor=0,attempted=0;
 for(;;){
  const events=await db('studkab_request_push_events?select=id,request_id,subscription_id,created_at&accepted_at=is.null&cancelled_at=is.null&order=id.asc&limit=100&id=gt.'+cursor);
  for(const event of events){
   cursor=event.id;
   const key=event.subscription_id+':request:'+event.request_id;
   if(now()-Date.parse(event.created_at)>86400000){
    await db('studkab_request_push_events?id=eq.'+event.id,'PATCH',{cancelled_at:new Date(now()).toISOString()});
    continue;
   }
   if(!await db('rpc/claim_studkab_push_delivery','POST',{delivery_key:key,subscription_id:event.subscription_id}))continue;
   attempted++;
   try{
    const allowed=await db('rpc/studkab_request_push_target','POST',{p_event_id:event.id});
    if(!allowed){
     await db('studkab_request_push_events?id=eq.'+event.id,'PATCH',{cancelled_at:new Date(now()).toISOString()});
     await db('studkab_push_deliveries?key=eq.'+encodeURIComponent(key),'PATCH',{sent_at:new Date(now()).toISOString(),result:'cancelled'});
     continue;
    }
    const [sub]=await db('studkab_push_subscriptions?id=eq.'+event.subscription_id+'&enabled=eq.true');
    const [request]=await db('studkab_requests?id=eq.'+event.request_id+'&select=id,number');
    if(!sub||!request)throw Error('Push target unavailable');
    await send(sub,{title:'Реестр заявок',body:'Новая заявка №'+request.number+'. Откройте реестр.',tag:key,url:'./reestr.html#request='+request.id,expiresAt:now()+300000},configuration);
    const at=new Date(now()).toISOString();
    await db('studkab_request_push_events?id=eq.'+event.id,'PATCH',{accepted_at:at});
    await db('studkab_push_deliveries?key=eq.'+encodeURIComponent(key),'PATCH',{sent_at:at,result:'accepted'});
    await db('studkab_push_subscriptions?id=eq.'+sub.id,'PATCH',{last_sent_at:at,last_error:null});sent++;
   }catch{
    failed++;
    await db('studkab_push_subscriptions?id=eq.'+event.subscription_id,'PATCH',{last_error:'Push о заявке не отправлен. Сервер повторит попытку.'});
   }
   if(attempted>=2)return {sent,failed};
  }
  if(events.length<100)break;
 }
 return {sent,failed};
}
