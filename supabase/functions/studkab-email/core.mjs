import {dueEvents} from '../studkab-push/schedule.js';
export function verifiedEmail(user){
 return user && !user.is_anonymous && user.email_confirmed_at && typeof user.email==='string' ? user.email.trim().toLowerCase() : null;
}
export function reminder(data,zone,now){
 const events=dueEvents(data,zone,now);if(!events.length)return null;
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const days=Math.min(30,Math.max(1,Math.trunc(Number(data?.settings?.warnDays)||3)));
 return {key:'deadline:'+day,body:'До срока сдачи '+events.length+' работ осталось '+days+' дн. Откройте кабинет, чтобы посмотреть работы.'};
}
export function service({db,getUser,send,now=Date.now,ready=false,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
 const path=id=>'studkab_email_preferences?user_id=eq.'+id;
 async function action(user,input){
  const email=verifiedEmail(user);if(!email)return {status:403,body:{error:'Для писем нужна подтверждённая почта входа.'}};
  const id=user.id;const [pref]=await db(path(id));
  if(input.action==='disable'){
   await db(path(id),'PATCH',{enabled:false,test_due:null});return {body:{enabled:false}};
  }
  if(input.action==='status')return {body:{enabled:!!pref?.enabled&&pref.email===email,email,timezone:pref?.timezone,lastError:pref?.last_error,lastAcceptedAt:pref?.last_accepted_at}};
  if(!ready)return {status:503,body:{error:'Отправка писем ещё не подключена.'}};
  if(input.action==='enable'){
   try{if(typeof input.timezone!=='string'||input.timezone.length>80)throw 0;new Intl.DateTimeFormat('en',{timeZone:input.timezone}).format();}catch{return {status:400,body:{error:'Не удалось определить часовой пояс.'}};}
   await db('studkab_email_preferences?on_conflict=user_id','POST',{user_id:id,email,timezone:input.timezone,enabled:true,consented_at:new Date(now()).toISOString(),last_error:null},'resolution=merge-duplicates,return=representation');
   return {body:{enabled:true,email,timezone:input.timezone}};
  }
  if(input.action==='test'){
   if(!pref?.enabled||pref.email!==email)return {status:400,body:{error:'Сначала включите письма.'}};
   const result=await db('rpc/schedule_studkab_email_test','POST',{owner:id});
   return result?{body:{scheduled:true}}:{status:429,body:{error:'Проверочное письмо можно запросить раз в 10 минут.'}};
  }
  return {status:400,body:{error:'Неизвестное действие.'}};
 }
 async function dispatch(){
  if(!ready)return {skipped:'not_configured'};
  const started=now();const [config]=await db('studkab_email_configuration?id=eq.1');
  const rows=await db('studkab_email_preferences?enabled=eq.true&order=user_id&limit=20'+(config.cursor?'&user_id=gt.'+config.cursor:''));
  let accepted=0,failed=0,last=config.cursor;
  for(const row of rows){
   if(now()-started>40000)break;last=row.user_id;
   try{
    const user=await getUser(row.user_id);
    if(verifiedEmail(user)!==row.email){await db(path(row.user_id),'PATCH',{enabled:false,test_due:null,last_error:'Почта аккаунта изменилась. Включите письма заново.'});continue;}
    const [record]=await db('app_data?app=eq.kabinet&user_id=eq.'+row.user_id+'&select=data');
    const test=row.test_due&&now()>=Date.parse(row.test_due)&&now()<Date.parse(row.test_due)+600000;
    let item=test?{key:'test:'+row.test_due,body:'Проверка: напоминания кабинета студента могут приходить на эту почту.'}:reminder(record?.data,row.timezone,now());
    if(!item)continue;
    const key=row.user_id+':'+item.key;
    if(!await db('rpc/claim_studkab_email','POST',{delivery_key:key,owner:row.user_id}))continue;
    const delivery='studkab_email_deliveries?key=eq.'+encodeURIComponent(key);
    const [fresh]=await db(path(row.user_id));
    const latestUser=await getUser(row.user_id);
    if(!fresh?.enabled||verifiedEmail(latestUser)!==row.email||fresh.email!==row.email){await db(delivery,'PATCH',{state:'cancelled'});continue;}
    if(!test){
     const [latest]=await db('app_data?app=eq.kabinet&user_id=eq.'+row.user_id+'&select=data');
     const current=reminder(latest?.data,fresh.timezone,now());
     if(!current||current.key!==item.key){await db(delivery,'PATCH',{state:'cancelled'});continue;}item=current;
    }else if(fresh.test_due!==row.test_due){await db(delivery,'PATCH',{state:'cancelled'});continue;}
    const result=await send(row.email,item.body);
    await db(delivery,'PATCH',{state:result.state,message_id:result.messageId||null});
    const patch=result.state==='accepted'?{last_accepted_at:new Date(now()).toISOString(),last_error:null}:{last_error:result.state==='unknown'?'Результат отправки неизвестен. Проверьте почту; автоматический повтор не выполняется.':'Почтовый сервис не принял письмо.'};
    if(test&&result.state!=='retry')patch.test_due=null;
    await db(path(row.user_id),'PATCH',patch);result.state==='accepted'?accepted++:failed++;
    await pause(1100);
   }catch{failed++;}
  }
  await db('studkab_email_configuration?id=eq.1','PATCH',{cursor:rows.length<20&&last===rows.at(-1)?.user_id?null:last,last_run_at:new Date(now()).toISOString(),last_result:{accepted,failed}});
  if(!rows.length)await db('studkab_email_configuration?id=eq.1','PATCH',{cursor:null});
  return {accepted,failed};
 }
 return {action,dispatch};
}
