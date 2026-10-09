import {readIntake} from './reader-runtime.ts';
import {loadOriginal} from './intake-reading.mjs';
import {accessLink} from './access-links.mjs';
import {handler} from './handler.mjs';
import {extract} from './extract.ts';
import {attachmentDownloadUrl} from './download-url.mjs';
import {saveOriginal} from './original-storage.mjs';
import {removeStorageObject} from './storage-remove.mjs';
import {requestEmailSettings,sendRequestEmail} from './request-email.mjs';
import {deepseekCapability} from './assistant-service.mjs';
import {sourceAssistantPlan} from './assistant-source-plan.mjs';
import {probeDeepseekAssistant} from '../_shared/deepseek-assistant.mjs';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const bucket='studkab-request-materials';
async function db(path:string,method='GET',body?:unknown){
 const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Database unavailable');return r.status===204?null:await r.json();
}
async function auth(bearer:string){
 const r=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:bearer},signal:AbortSignal.timeout(10000)});
 return r.ok?await r.json():null;
}
async function send(row:any){
 const [owner]=await db('studkab_telegram_setup?id=eq.true&select=owner_chat_id,installed');
 const token=Deno.env.get('STUDKAB_TELEGRAM_BOT_TOKEN');
 if(!owner?.owner_chat_id||!owner.installed||!token)throw Error('Recipient unavailable');
 const p=row.payload;
 const text=`Новая заявка №${row.number}\nСтудент: ${p.n||'не указан'}\nРабота: ${p.k||'не указана'}\nТема: ${p.t}\nСрок: ${p.dl||'не указан'}`;
 const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:owner.owner_chat_id,text,reply_markup:{inline_keyboard:[[{text:'Открыть заявку в реестре',url:'https://innaodincova-finpro.github.io/studkab/reestr.html#request='+row.id}],[{text:'Изучение и вопросы',callback_data:'study:'+row.id}]]}}),signal:AbortSignal.timeout(10000)});
 const data=await r.json();if(!r.ok||!data.ok)throw Error('Telegram unavailable');
}
const uuid=/^[0-9a-f-]{36}$/i;
// C-054: допуск студента хранится в studkab_members.
const isMember=async(id:string)=>uuid.test(id)&&(await db('studkab_members?user_id=eq.'+id+'&select=user_id')).length===1;
const invite=(email:string,recovery=false)=>accessLink({base,key,email,recovery,isMember});
const b64=/^[A-Za-z0-9+/]*={0,2}$/;
async function upload(path:string,type:string,value:string,size:number,expectedHash:string){
 if(!value||value.length>7200000||!b64.test(value))throw Error('Invalid file');
 let raw:string;try{raw=atob(value);}catch{throw Error('Invalid file');}
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(bytes.byteLength!==size)throw Error('Invalid file size');
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const actual=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(actual!==expectedHash)throw Error('Invalid file hash');
 const extractedText=await extract(bytes,type);
 const r=await fetch(base+'/storage/v1/object/'+bucket+'/'+path,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':type,'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Storage unavailable');
 return extractedText;
}
async function downloadFrom(sourceBucket:string,path:string,fileName:string){
 const r=await fetch(base+'/storage/v1/object/sign/'+sourceBucket+'/'+path,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300,download:fileName}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Storage unavailable');const data=await r.json();
 const url=attachmentDownloadUrl(base,data.signedURL||data.signedUrl,path,fileName,sourceBucket);
 return {url,fileName,expiresIn:300};
}
const download=(path:string,name:string)=>downloadFrom(bucket,path,name);
const downloadIntake=(path:string,name:string)=>downloadFrom('studkab-intake-materials',path,name);
const saveIntake=(path:string,type:string,bytes:Uint8Array,hash:string)=>saveOriginal({base,key,path,type,bytes,hash});
const loadIntake=(path:string,size:number,hash:string)=>loadOriginal({base,key,path,size,hash});
// «Передать Claude»: материалы заявки читаются из хранилища заявок.
const loadRequestFile=(path:string,size:number,hash:string)=>loadOriginal({base,key,path,size,hash,bucket});
// R3-C: готовая работа исполнителя хранится рядом с материалами заявки; путь закреплён за содержимым.
const saveResult=(path:string,type:string,bytes:Uint8Array,hash:string)=>saveOriginal({base,key,bucket,path,type,bytes,hash});
const transferIntake=async(f:any)=>{
 const bytes=await loadIntake(f.storage_path,f.size_bytes,f.file_hash);
 await saveOriginal({base,key,bucket,path:f.storage_path,type:f.content_type,bytes,hash:f.file_hash});
};
const removeFrom=(sourceBucket:string,path:string)=>removeStorageObject(fetch,base,key,sourceBucket,path);
const remove=(path:string)=>removeFrom(bucket,path);
// Полное удаление заявки: исходные файлы, загруженные студентом.
const removeIntake=(path:string)=>removeFrom('studkab-intake-materials',path);
Deno.serve(handler({auth,db,send,
 assistant:{
  sourcePlan:(input:any)=>sourceAssistantPlan(input,{readFile:readIntake}),
  capability:(actor:string)=>deepseekCapability(actor,{
   rpc:(name:string,args:unknown)=>db('rpc/'+name,'POST',args),
   enabled:Deno.env.get('STUDKAB_ASSISTANT_DEEPSEEK_ENABLED')==='true'&&Deno.env.get('STUDKAB_GENERATION_ENABLED')==='true',
   configured:!!Deno.env.get('STUDKAB_PROXY_TOKEN'),probe:()=>probeDeepseekAssistant(Deno.env.get('STUDKAB_PROXY_TOKEN'))
  })
 },
 notification:{telegramConfigured:!!Deno.env.get('STUDKAB_TELEGRAM_BOT_TOKEN')},
 // NOTIFY-03: configured existing SMTP only. Missing fields keep the channel
 // unavailable; neither a new service nor credentials are created here.
 emailSettings:(cfg:any)=>requestEmailSettings(cfg,{
  host:Deno.env.get('STUDKAB_SMTP_HOST'),port:Deno.env.get('STUDKAB_SMTP_PORT'),
  username:Deno.env.get('STUDKAB_SMTP_USERNAME'),password:Deno.env.get('STUDKAB_SMTP_PASSWORD'),
  from:Deno.env.get('STUDKAB_SMTP_FROM')
 }),sendEmail:sendRequestEmail,
 invite,isMember,upload,download,remove,removeIntake,saveIntake,downloadIntake,loadIntake,readIntake,transferIntake,saveResult,loadRequestFile,config:async()=>(await db('studkab_request_config?id=eq.true'))[0]}));
