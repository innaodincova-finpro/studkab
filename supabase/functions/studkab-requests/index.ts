import {accessLink} from './access-links.mjs';
import {handler} from './handler.mjs';
import {extract} from './extract.ts';
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
 const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:owner.owner_chat_id,text,reply_markup:{inline_keyboard:[[{text:'Открыть заявку в реестре',url:'https://innaodincova-finpro.github.io/studkab/reestr.html#request='+row.id}]]}}),signal:AbortSignal.timeout(10000)});
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
async function download(path:string,fileName:string){
 const r=await fetch(base+'/storage/v1/object/sign/'+bucket+'/'+path,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300,download:fileName}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Storage unavailable');const data=await r.json();
 const signed=String(data.signedURL||data.signedUrl||'');if(!signed.startsWith('/storage/v1/object/sign/'))throw Error('Storage unavailable');
 return {url:base+signed,fileName,expiresIn:300};
}
async function remove(path:string){
 const r=await fetch(base+'/storage/v1/object/'+bucket+'/'+path,{method:'DELETE',headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
 if(!r.ok&&r.status!==404)throw Error('Storage cleanup unavailable');
}
Deno.serve(handler({auth,db,send,invite,isMember,upload,download,remove,config:async()=>(await db('studkab_request_config?id=eq.true'))[0]}));
