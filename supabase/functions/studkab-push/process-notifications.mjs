// Existing cron only. SQL owns recipients, event keys, claims and terminal
// receipts. No model calls, subscriptions, recipient guesses or retry on doubt.
import {emailConfigured,sendProcessEmail,processNotificationMessage} from '../studkab-requests/request-email.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const states=new Set(['pending','accepted','unknown','failed','not_configured','cancelled']);
export async function processNotifications({rpc,configuration,sendPush,telegramToken,emailSettings={},sendEmail=sendProcessEmail,fetchTelegram=globalThis.fetch,now=()=>Date.now(),maxRunMs=60000,channelOrder=['push','telegram','email']}){
 const total={accepted:0,unknown:0,failed:0,notConfigured:0,pending:0,unconfirmed:0};
 const deadline=now()+maxRunMs;
 if(channelOrder.length!==3||new Set(channelOrder).size!==3||channelOrder.some(c=>!['push','telegram','email'].includes(c)))throw Error('Invalid channels');
 for(const channel of channelOrder){
  if(now()+25000>deadline)break;
  let rows;try{rows=await rpc('studkab_process_notification_claim',{p_channel:channel});}catch{total.unconfirmed++;continue;}
  if(!Array.isArray(rows)){total.unconfirmed++;continue;}
  for(const row of rows){
   if(!uuid(row?.id)||!uuid(row?.lease)){total.unconfirmed++;continue;}
   let status='unknown',receipt=null;
   try{
    // Not dispatched yet: safely release remaining claims if the cron time
    // budget is nearly exhausted, leaving time for existing push workloads.
    if(now()+25000>deadline)status='pending';
    else{
    if(row.channel!==channel||!uuid(row.recipient))throw Error('Invalid claim');
    const message=processNotificationMessage(row);
    if(channel==='push'){
     if(!configuration?.vapid?.publicKey||!configuration?.vapid?.privateKey||!row.subscription||!uuid(row.deviceId)||typeof sendPush!=='function')status='not_configured';
     else{
      await sendPush({id:row.deviceId,user_id:row.recipient,subscription:row.subscription},{title:'Кабинет студента',body:message.body,tag:row.eventKey,url:message.url},configuration);
      status='accepted';
     }
    }else if(channel==='telegram'){
     if(!telegramToken||!Number.isSafeInteger(Number(row.chat))||Number(row.chat)<=0)status='not_configured';
     else{
      const res=await fetchTelegram('https://api.telegram.org/bot'+telegramToken+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:row.chat,text:message.title+'\n'+message.body,reply_markup:{inline_keyboard:[[{text:'Открыть заявку',url:message.url}]]}}),signal:AbortSignal.timeout(10000)});
      const value=await res.json();
      if(res.ok&&value?.ok===true&&Number.isSafeInteger(value.result?.message_id)&&value.result.message_id>0){status='accepted';receipt=String(value.result.message_id);}
      else if(value?.ok===false&&Number.isInteger(value.error_code)&&value.error_code>=400&&value.error_code<=599)status=value.error_code===429||value.error_code>=500?'pending':'failed';
      // A malformed/absent success acknowledgment is unknown, never retried.
     }
    }else{
     const settings={...emailSettings,to:row.email};
     if(!emailConfigured(settings))status='not_configured';
     else{
      const result=await sendEmail(row,settings);
      if(states.has(result?.status))status=result.status;
      if(typeof result?.messageId==='string'&&/^[a-zA-Z0-9_.:@+-]{1,200}$/.test(result.messageId))receipt=result.messageId;
     }
    }
    }
   }catch{status='unknown';}
   // Never repeat the send after a lost SQL acknowledgment. The lease expires
   // to terminal unknown; accepted is transport acceptance, not a read receipt.
   let finished=false;
   try{finished=await rpc('studkab_process_notification_finish',{p_id:row.id,p_lease:row.lease,p_status:status,p_receipt:receipt});}catch{}
   if(finished!==true){total.unconfirmed++;continue;}
   if(status==='not_configured')total.notConfigured++;
   else if(status in total)total[status]++;
  }
 }
 return total;
}
