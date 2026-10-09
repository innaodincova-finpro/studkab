// Channel status is server evidence. A Telegram link never marks a channel bound.
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function createNotificationChannels({api,active,onChange,openLink}){
 const state={busy:false,observed:false,channels:null,deliveries:[],message:'',linkUrl:null};
 const publish=()=>{if(active())onChange(state);};
 async function refresh(){
  if(state.busy||!active())return;state.busy=true;state.message='Проверяем подключения…';publish();
  try{const value=await api({action:'notification-state'});if(!active())return;
   if(!['push','telegram','email'].every(k=>typeof value?.[k]?.configured==='boolean'))throw Error('INVALID_CHANNEL_STATE');
   state.channels={push:value.push.configured,telegram:value.telegram.configured,email:value.email.configured};state.observed=true;
   state.deliveries=Array.isArray(value.deliveries)?value.deliveries.slice(0,3).map(d=>({channel:['push','telegram','email'].includes(d.channel)?d.channel:null,status:['sent','pending','failed','unknown'].includes(d.status)?d.status:'unknown'})):[];
   state.message='';
  }catch{if(!active())return;state.observed=false;state.message='Пока не удалось проверить подключения. Повторите проверку.';}
  finally{if(active()){state.busy=false;publish();}}
 }
 async function telegram(link){
  if(state.busy||!active())return;state.busy=true;state.linkUrl=null;state.message=link?'Создаём ссылку…':'Отключаем Telegram…';publish();
  try{const value=await api({action:link?'telegram-link':'telegram-unlink'});if(!active())return;
   if(link){const url=new URL(value?.url);if(url.protocol!=='https:'||url.hostname!=='t.me'||!Number.isFinite(Date.parse(value.expiresAt)))throw Error('INVALID_LINK');state.linkUrl=url.href;openLink(url.href);state.message='Откройте Telegram и нажмите «Старт», затем проверьте подключение здесь.';}
   else{state.observed=false;state.message='Проверьте состояние подключения.';}
  }catch{if(!active())return;state.message=link?'Не удалось получить ссылку. Повторите.':'Не удалось подтвердить отключение. Проверьте состояние.';}
  finally{if(active()){state.busy=false;publish();}}
 }
 return {state,refresh,telegram};
}
export function channelPanel(state,connected){
 let h='<div data-notification-settings><div class="lab">Каналы уведомлений</div>';
 for(const [key,label] of [['push','Уведомления приложения'],['telegram','Telegram'],['email','Электронная почта']])h+='<div class="stat"><span>'+label+'</span><b>'+esc(!state.observed?'Не проверено':state.channels?.[key]?'Подключено':'Не подключено')+'</b></div>';
 h+='<p class="hint" role="status" aria-live="polite">'+esc(connected?state.message:'Войдите, чтобы проверить подключения.')+'</p>';
 if(connected){h+='<div class="chips"><button type="button" class="chip" data-notify-action="refresh"'+(state.busy?' disabled':'')+'>'+(state.busy?'Проверяем…':'Проверить подключения')+'</button>';
 if(state.observed)h+='<button type="button" class="chip" data-notify-action="'+(state.channels?.telegram?'unlink':'link')+'"'+(state.busy?' disabled':'')+'>'+(state.channels?.telegram?'Отключить Telegram':'Подключить Telegram')+'</button>';h+='</div>';}
 if(state.linkUrl)h+='<a class="chip" href="'+esc(state.linkUrl)+'" target="_blank" rel="noopener noreferrer">Открыть Telegram</a>';
 if(state.observed&&state.deliveries.length){h+='<div class="lab">Последние отправки</div>';for(const d of state.deliveries)h+='<div class="stat"><span>'+esc({push:'Уведомления приложения',telegram:'Telegram',email:'Электронная почта'}[d.channel]||'Уведомление')+'</span><small>'+esc({sent:'Отправлено',pending:'Ожидает отправки',failed:'Не отправлено',unknown:'Не подтверждено'}[d.status])+'</small></div>';}
 return h+'</div>';
}
if(typeof window==='object'){
 let session=null,owner=null;
 const connected=()=>!!window.Oblako?.canSync?.();
 const key=()=>String(window.KEY||'')+'|'+String(window.Oblako?.identity?.()||'');
 function current(){return key()===owner;}
 function paint(){for(const host of document.querySelectorAll('[data-notification-settings]'))host.outerHTML=channelPanel(session.state,connected());}
 function get(){if(!session||owner!==key()){owner=key();const expected=owner;session=createNotificationChannels({api:input=>Oblako.requestApi(input),active:()=>key()===expected,onChange:paint,openLink:url=>window.open(url,'_blank','noopener,noreferrer')});if(connected())setTimeout(()=>{if(current())session.refresh();},0);}return session;}
 window.StudNotificationChannels={panel:()=>channelPanel(get().state,connected())};
 document.addEventListener('click',event=>{const button=event.target.closest('[data-notify-action]');if(!button||!connected())return;const action=button.dataset.notifyAction,s=get();if(action==='refresh')s.refresh();else if(action==='link'||action==='unlink')s.telegram(action==='link');});
 if(typeof window.render==='function'&&window.D)window.render();
}
