import {emailConfigured} from './request-email.mjs';
export const NOTIFICATION_ACTIONS=['notification-state','telegram-link','telegram-unlink'];
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export async function notificationAction(input,user,{db,config,isMember,emailSettings,telegramConfigured}){
 if(!await isMember(user.id))return {status:403,data:{error:'Нет доступа'}};
 const rpc=(name,args)=>db('rpc/'+name,'POST',args);
 if(input.action==='telegram-unlink'){
  if(await rpc('studkab_telegram_unlink',{p_user:user.id})!==true)throw Error('UNLINK_UNCONFIRMED');
  return {data:{unlinked:true}};
 }
 if(input.action==='telegram-link'){
  const [setup]=await db('studkab_telegram_setup?id=eq.true&select=installed');
  if(!setup?.installed||telegramConfigured!==true)return {status:503,data:{error:'Подключение Telegram пока недоступно'}};
  const value=hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
  const receipt=await rpc('studkab_telegram_link_create',{p_user:user.id,p_hash:hash});
  if(!Number.isFinite(Date.parse(receipt?.expiresAt)))throw Error('LINK_UNCONFIRMED');
  return {data:{url:'https://t.me/Studkab_Requests_bot?start=link_'+value,expiresAt:receipt.expiresAt}};
 }
 const state=await rpc('studkab_process_notification_state',{p_user:user.id});
 const cfg=await config(),settings=typeof emailSettings==='function'?emailSettings(cfg):{};
 const owner=String(user.email).toLowerCase()===String(cfg?.executor_email).toLowerCase();
 return {data:{push:{configured:state?.push?.configured===true},telegram:{configured:telegramConfigured===true&&state?.telegram?.configured===true},
  email:{configured:emailConfigured({...settings,to:owner?settings.to:user.email})},
  deliveries:(state?.deliveries||[]).map(d=>({kind:d.kind,channel:d.channel,status:d.status==='accepted'?'sent':['pending','claimed','not_configured'].includes(d.status)?'pending':['failed','cancelled'].includes(d.status)?'failed':'unknown',at:d.acceptedAt||d.at}))}};
}
