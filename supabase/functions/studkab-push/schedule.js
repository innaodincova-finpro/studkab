// Date-only deadlines: notify at 10:00 in the device's saved time zone.
export function dueEvents(data, zone, now) {
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 // Allow recovery until the end of the morning if the scheduler was unavailable.
 if(+p.hour<10 || +p.hour>=12)return [];
 const days=Math.min(30,Math.max(1,Math.trunc(Number(data?.settings?.warnDays)||3)));
 const date=new Date(Date.UTC(+p.year,+p.month-1,+p.day+days)).toISOString().slice(0,10);
 const out=[];
 for(const w of Array.isArray(data?.works)?data.works:[]){
  if(!w?.id || w.deadline!==date || ['accepted','graded'].includes(w.status))continue;
  out.push({key:'deadline:'+w.id+':'+date+':'+days,title:'Кабинет студента',body:'До срока сдачи работы осталось '+days+' дн. Откройте кабинет, чтобы посмотреть работу.',at:now+300000});
 }
 return out;
}
export function validSubscription(s){
 try{const u=new URL(s.endpoint),h=u.hostname;
  return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.hash&&s.endpoint.length<2048&&
   (h==='web.push.apple.com'||h.endsWith('.push.apple.com')||h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h.endsWith('.notify.windows.com'))&&
   /^[A-Za-z0-9_-]{87}=?$/.test(s.keys?.p256dh||'')&&/^[A-Za-z0-9_-]{22}={0,2}$/.test(s.keys?.auth||'');
 }catch{return false;}
}
