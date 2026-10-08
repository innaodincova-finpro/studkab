export function dueEvents(data, zone, now) {
 return [...classEvents(data, zone, now), ...calendarActionEvents(data, zone, now), ...deadlineEvents(data, zone, now)];
}
// CAL-IMPORT-01: timed imported actions use the existing 30-minute reminder window.
// Includes a start just after midnight, without sending a past event.
export function calendarActionEvents(data,zone,now){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 const date=p.year+'-'+p.month+'-'+p.day,next=new Date(Date.UTC(+p.year,+p.month-1,+p.day+1)).toISOString().slice(0,10),current=+p.hour*60+ +p.minute,out=[];
 for(const e of Array.isArray(data?.events)?data.events:[]){
  if(!e?.id||e.src!=='calendar-import'||e.kind!=='other'||!e.recordType||![date,next].includes(e.date))continue;
  const t=/^(\d{2}):(\d{2})$/.exec(e.time||'');if(!t||+t[1]>23||+t[2]>59)continue;
  const left=+t[1]*60+ +t[2]-current+(e.date===next?1440:0);
  if(left<=0||left>CLASS_LEAD_MIN)continue;
  out.push({key:'calendar:'+e.id+':'+e.date+':'+e.time,title:'Кабинет студента',body:'Через '+left+' мин, в '+e.time+': '+String(e.title||e.recordType).slice(0,120)+'.',at:now+left*60000});
 }
 return out;
}
// Пары (события вида «Пара», в том числе загруженные из вуза): напоминание за 30 минут до начала
// во времени устройства. Если планировщик задержался, напоминание уходит до начала пары, не позже.
export const CLASS_LEAD_MIN=30;
export function classEvents(data, zone, now) {
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 const today=p.year+'-'+p.month+'-'+p.day,nowMin=+p.hour*60+ +p.minute,out=[];
 for(const e of Array.isArray(data?.events)?data.events:[]){
  if(!e?.id || e.kind!=='cls' || e.date!==today)continue;
  const t=String(e.time||'').match(/^(\d{1,2}):(\d{2})$/);if(!t)continue;
  const start=+t[1]*60+ +t[2],left=start-nowMin;
  if(left<=0 || left>CLASS_LEAD_MIN)continue;
  const title=String(e.title||'Пара').slice(0,120);
  out.push({key:'class:'+e.id+':'+e.date+':'+e.time,title:'Кабинет студента',body:'Через '+left+' мин, в '+t[1].padStart(2,'0')+':'+t[2]+': '+title+'.',at:now+left*60000});
 }
 return out;
}
// Date-only deadlines: notify at 10:00 in the device's saved time zone.
function deadlineEvents(data, zone, now) {
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
