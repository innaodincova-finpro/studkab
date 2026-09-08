import {service} from './core.mjs';
import {sender} from './postbox.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const config={from:Deno.env.get('STUDKAB_EMAIL_FROM'),accessKeyId:Deno.env.get('STUDKAB_POSTBOX_ACCESS_KEY_ID'),secretAccessKey:Deno.env.get('STUDKAB_POSTBOX_SECRET_ACCESS_KEY')};
const ready=Deno.env.get('STUDKAB_EMAIL_ENABLED')==='true'&&!!config.from&&!!config.accessKeyId&&!!config.secretAccessKey;
const cors={'access-control-allow-origin':'https://innaodincova-finpro.github.io','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,content-type'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json','cache-control':'no-store'}});
async function db(path:string,method='GET',body?:unknown,prefer='return=representation'){
 const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',Prefer:prefer},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error('Database unavailable');return r.status===204?null:r.json();
}
async function getUser(id:string){
 const r=await fetch(base+'/auth/v1/admin/users/'+id,{headers:{apikey:secret,Authorization:'Bearer '+secret},signal:AbortSignal.timeout(10000)});
 if(r.status===404)return null;if(!r.ok)throw new Error('Auth unavailable');return r.json();
}
const app=service({db,getUser,ready,send:ready?sender(config):async()=>({state:'rejected'})});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Используйте POST'},405);
 try{
  const cron=req.headers.get('x-job-key');
  if(cron){const [cfg]=await db('studkab_email_configuration?id=eq.1');if(cron!==cfg.cron_token)return json({error:'Нет доступа'},403);return json(await app.dispatch());}
  const authorization=req.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return json({error:'Войдите в кабинет.'},401);
  const r=await fetch(base+'/auth/v1/user',{headers:{apikey:secret,Authorization:authorization},signal:AbortSignal.timeout(10000)});
  if(!r.ok)return json({error:'Войдите в кабинет заново.'},401);
  const raw=await req.text();if(raw.length>2048)return json({error:'Слишком большой запрос.'},413);
  let input;try{input=JSON.parse(raw);}catch{return json({error:'Неверный запрос.'},400);}
  if(!input||typeof input!=='object')return json({error:'Неверный запрос.'},400);
  const result=await app.action(await r.json(),input);return json(result.body,result.status||200);
 }catch{return json({error:'Почтовый сервис временно недоступен.'},503);}
});
