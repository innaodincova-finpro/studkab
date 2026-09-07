import webpush from 'npm:web-push@3.6.7';
import {dueEvents,validSubscription} from './schedule.js';
const URL_BASE=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors={'access-control-allow-origin':'https://innaodincova-finpro.github.io','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST,OPTIONS'};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json','cache-control':'no-store'}});}
async function db(path:string,method='GET',body?:unknown,prefer='return=representation'){
 const res=await fetch(URL_BASE+'/rest/v1/'+path,{method,headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json',Prefer:prefer},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw new Error('database '+res.status);return res.status===204?null:await res.json();
}
async function config(){
 let [c]=await db('studkab_push_configuration?id=eq.1');
 if(!c.vapid){const keys=webpush.generateVAPIDKeys();await db('studkab_push_configuration?id=eq.1&vapid=is.null','PATCH',{vapid:keys});[c]=await db('studkab_push_configuration?id=eq.1');}
 return c;
}
async function send(sub:any,message:any,c:any){
 const details=webpush.generateRequestDetails(sub.subscription,JSON.stringify(message),{TTL:300,urgency:'high',contentEncoding:'aes128gcm',vapidDetails:{subject:'mailto:inna_odincova@mail.ru',publicKey:c.vapid.publicKey,privateKey:c.vapid.privateKey}});
 const res=await fetch(details.endpoint,{method:'POST',headers:details.headers,body:new Uint8Array(details.body),redirect:'error',signal:AbortSignal.timeout(10000)});
 if(res.status===404||res.status===410)await db('studkab_push_subscriptions?id=eq.'+sub.id,'PATCH',{enabled:false,last_error:'Разрешение истекло. Включите уведомления снова.'});
 if(!res.ok)throw new Error('push '+res.status);
}
async function dispatch(c:any){
 let sent=0,failed=0;
 let cursor='';
 for(;;){
  const subs=await db('studkab_push_subscriptions?enabled=eq.true&order=id&limit=100'+(cursor?'&id=gt.'+cursor:''));
  for(const sub of subs){
   try{
    const now=Date.now();const [row]=await db('app_data?app=eq.kabinet&user_id=eq.'+sub.user_id+'&select=data');
    const items=dueEvents(row?.data,sub.timezone,now);
    if(sub.test_due&&now>=Date.parse(sub.test_due)&&now<Date.parse(sub.test_due)+300000)items.push({key:'test:'+sub.test_due,title:'Кабинет студента',body:'Проверка: уведомления приходят при закрытом приложении.',at:now+300000});
    for(const item of items){
     const key=sub.id+':'+item.key;
     if(!await db('rpc/claim_studkab_push_delivery','POST',{delivery_key:key,subscription_id:sub.id}))continue;
     try{
      // Re-read immediately before dispatch so a deleted/moved meeting is not sent from the scan snapshot.
      if(!item.key.startsWith('test:')){const [fresh]=await db('app_data?app=eq.kabinet&user_id=eq.'+sub.user_id+'&select=data');if(!dueEvents(fresh?.data,sub.timezone,Date.now()).some((x:any)=>x.key===item.key)){await db('studkab_push_deliveries?key=eq.'+encodeURIComponent(key),'PATCH',{sent_at:new Date().toISOString(),result:'cancelled'});continue;}}
      const [currentSub]=await db('studkab_push_subscriptions?id=eq.'+sub.id+'&enabled=eq.true');if(!currentSub)continue;
      await send(currentSub,{title:item.title,body:item.body,tag:key,url:'./',expiresAt:item.at},c);
      const at=new Date().toISOString();await db('studkab_push_deliveries?key=eq.'+encodeURIComponent(key),'PATCH',{sent_at:at,result:'accepted'});
      await db('studkab_push_subscriptions?id=eq.'+sub.id,'PATCH',{last_sent_at:at,last_error:null,...(item.key.startsWith('test:')?{test_sent_at:at}: {})});sent++;
     }catch{failed++;await db('studkab_push_subscriptions?id=eq.'+sub.id,'PATCH',{last_error:'Отправка не удалась. Сервер повторит попытку.'});}
    }
   }catch{failed++;}
  }
  if(subs.length<100)break;cursor=subs[subs.length-1].id;
 }
 await db('studkab_push_configuration?id=eq.1','PATCH',{last_run_at:new Date().toISOString(),last_result:{sent,failed}});
 return {sent,failed};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Используйте POST'},405);
 try{
  const cronKey=req.headers.get('x-job-key');
  if(cronKey){const c=await config();if(cronKey!==c.cron_token)return json({error:'Нет доступа'},403);return json(await dispatch(c));}
  const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return json({error:'Войдите в приложение'},401);
  const userRes=await fetch(URL_BASE+'/auth/v1/user',{headers:{apikey:SERVICE,Authorization:auth},signal:AbortSignal.timeout(10000)});
  if(!userRes.ok)return json({error:'Войдите в приложение заново'},401);
  const user=await userRes.json();
  const raw=await req.text();if(raw.length>4096)return json({error:'Слишком большой запрос'},413);
  const input=JSON.parse(raw),c=await config();
  if(input.action==='key')return json({publicKey:c.vapid.publicKey});
  if(input.action==='subscribe'){
   if(!validSubscription(input.subscription))return json({error:'Браузер передал неподдерживаемую подписку'},400);
   try{new Intl.DateTimeFormat('en',{timeZone:input.timezone}).format();}catch{return json({error:'Не удалось определить часовой пояс'},400);}
   if(typeof input.timezone!=='string'||input.timezone.length>80)return json({error:'Нужен часовой пояс'},400);
   const endpoint=input.subscription.endpoint;
   const existing=await db('studkab_push_subscriptions?endpoint=eq.'+encodeURIComponent(endpoint));
   if(existing.length&&existing[0].user_id!==user.id)return json({error:'На устройстве подключён другой аккаунт. Сначала отключите его уведомления.'},409);
   if(!existing.length){const owned=await db('studkab_push_subscriptions?user_id=eq.'+user.id+'&enabled=eq.true&select=id');if(owned.length>=10)return json({error:'Можно подключить не более 10 устройств'},400);}
   const data={user_id:user.id,endpoint,subscription:input.subscription,timezone:input.timezone,enabled:true,last_error:null};
   const rows=existing.length?await db('studkab_push_subscriptions?id=eq.'+existing[0].id,'PATCH',data):await db('studkab_push_subscriptions','POST',data);
   return json({id:rows[0].id,enabled:true});
  }
  if(!/^[0-9a-f-]{36}$/.test(input.id||''))return json({error:'Сначала включите уведомления'},400);
  const path='studkab_push_subscriptions?id=eq.'+input.id+'&user_id=eq.'+user.id;
  const [sub]=await db(path);if(!sub)return json({error:'Подключение не найдено'},404);
  if(input.action==='disable'){await db(path,'PATCH',{enabled:false});return json({enabled:false});}
  if(input.action==='test'){
   if(!sub.enabled)return json({error:'Сначала включите уведомления'},400);
   if(sub.test_due&&Date.now()<Date.parse(sub.test_due)+60000)return json({error:'Проверка уже запланирована. Подождите две минуты.'},429);
   const due=new Date(Date.now()+60000).toISOString();await db(path,'PATCH',{test_due:due,test_sent_at:null});return json({due});
  }
  if(input.action==='status')return json({enabled:sub.enabled,testSentAt:sub.test_sent_at,lastSentAt:sub.last_sent_at,error:sub.last_error,timezone:sub.timezone});
  return json({error:'Неизвестное действие'},400);
 }catch{return json({error:'Сервис уведомлений временно недоступен. Повторите позже.'},503);}
});

