import {accessLink} from './access-links.mjs';
import {handler} from './handler.mjs';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
const invite=(email:string,recovery=false)=>accessLink({base,key,email,recovery});
Deno.serve(handler({auth,db,send,invite,config:async()=>(await db('studkab_request_config?id=eq.true'))[0]}));
