(function(global){
 'use strict';
 const key='studkab-push-device';
 let busy=false;
 function message(s){const el=document.getElementById('push-status');if(el)el.textContent=s;}
 function supported(){if(!('serviceWorker' in navigator)||!('PushManager' in global)||!('Notification' in global))throw new Error('Этот браузер не поддерживает уведомления. На iPhone откройте кабинет с ярлыка на экране «Домой», iOS 16.4 или новее.');}
 async function registration(){supported();return Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Обновите страницу и повторите подключение уведомлений')),10000))]);}
 function device(){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
 async function disable(){
  const d=device();
  if(d && global.Oblako && Oblako.mode==='cloud')await Oblako.pushRequest({action:'disable',id:d.id});
  if('serviceWorker' in navigator){const r=await navigator.serviceWorker.getRegistration();const sub=r&&await r.pushManager?.getSubscription();if(sub)await sub.unsubscribe();}
  localStorage.removeItem(key);
 }
 async function enable(){
  if(!global.Oblako || Oblako.mode!=='cloud')throw new Error('Сначала откройте «Хранение записей» и войдите в кабинет.');
  supported();
  // Request synchronously from the button gesture, before any network await (iOS).
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('Уведомления не разрешены. Разрешите их в настройках браузера или телефона.');
  const r=await registration(),{publicKey}=await Oblako.pushRequest({action:'key'});
  let sub=await r.pushManager.getSubscription();
  if(!sub){const raw=atob(publicKey.replace(/-/g,'+').replace(/_/g,'/'));sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});}
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  try{const d=await Oblako.pushRequest({action:'subscribe',subscription:sub.toJSON(),timezone});localStorage.setItem(key,JSON.stringify({id:d.id}));}
  catch(e){await sub.unsubscribe();throw e;}
  return 'Уведомления включены. Отправка в 10:00 ('+timezone+'). Для проверки нажмите «Проверить через минуту».';
 }
 async function action(name){
  if(busy)return;busy=true;
  try{
   if(name==='enable'){message(await enable());return;}
   if(name==='disable'){await disable();message('Уведомления на этом устройстве отключены.');return;}
   const d=device();if(!d)throw new Error('Сначала включите уведомления на этом устройстве.');
   const result=await Oblako.pushRequest({action:name,id:d.id});
   if(name==='test')message('Проверка запланирована. Закройте кабинет: уведомление должно прийти через 1–2 минуты.');
   else message(!result.enabled?'Уведомления отключены.':result.error||('Уведомления включены ('+result.timezone+'). '+(result.testSentAt?'Проверочное сообщение передано службе доставки. Проверьте уведомления телефона.':'Проверочное сообщение ещё не отправлялось.')));
  }catch(e){message(e.message||'Не удалось подключить уведомления. Повторите позже.');}
  finally{busy=false;}
 }
 global.StudPush={action,disable};
})(window);
