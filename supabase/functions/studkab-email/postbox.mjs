import { AwsClient } from './vendor/aws4fetch.mjs';
const endpoint='https://postbox.cloud.yandex.net/v2/email/outbound-emails';
export function mailBody(from,to,text){
 if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)||!/^([^\s<>@]+)@([^\s<>@]+)\.[^\s<>@]+$/.test(to))throw new Error('Invalid address');
 return {FromEmailAddress:'Кабинет студента <'+from+'>',Destination:{ToAddresses:[to]},Content:{Simple:{Subject:{Data:'Кабинет студента — напоминание',Charset:'UTF-8'},Body:{Text:{Data:text+'\n\nОткрыть кабинет: https://innaodincova-finpro.github.io/studkab/\nОтключить письма: Профиль → Напоминания на почту → Отключить письма.',Charset:'UTF-8'}}}}};
}
export function sender(config,transport=fetch){
 const aws=new AwsClient({accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey,service:'ses',region:'ru-central1',retries:0});
 return async (to,text)=>{
  const request=await aws.sign(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(mailBody(config.from,to,text))});
  let response;
  try{response=await transport(request,{signal:AbortSignal.timeout(10000),redirect:'error'});}catch{return {state:'unknown'};}
  if(response.ok){try{const data=await response.json();return data.MessageId?{state:'accepted',messageId:String(data.MessageId)}:{state:'unknown'};}catch{return {state:'unknown'};}}
  // Explicit throttle rejects the request. A timeout/5xx can follow acceptance; do not blindly resend.
  if(response.status===429)return {state:'retry'};
  return {state:response.status>=500?'unknown':'rejected'};
 };
}
