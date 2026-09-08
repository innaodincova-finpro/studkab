const fields={id:100,t:300,k:100,d:200,u:300,fc:300,kf:300,ct:100,n:200,g:100,pr:200,fo:100,co:50,s:200,dl:10,rq:500,org:1500,mn:1500,cn:200};
export function validatePayload(p) {
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Неверная заявка');
 const out={v:1};
 for(const [k,max] of Object.entries(fields)) {
  const v=p[k]??'';
  if(typeof v!=='string'||v.length>max)throw Error('Проверьте поля заявки');
  out[k]=v;
 }
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(out.id)||!out.t.trim()||!out.cn.trim())throw Error('Заполните тему и контакт для ответа');
 if(out.dl&&(!/^\d{4}-\d{2}-\d{2}$/.test(out.dl)||Number.isNaN(Date.parse(out.dl))||new Date(out.dl).toISOString().slice(0,10)!==out.dl))throw Error('Проверьте срок');
 const f=p.fm??{};
 if(typeof f!=='object'||Array.isArray(f))throw Error('Проверьте оформление');
 out.fm={};
 for(const [k,min,max] of [['mt',0,100],['mr',0,100],['mb',0,100],['ml',0,100],['sz',8,24],['sp',1,3],['ind',0,5]]) {
  if(f[k]==null)continue;
  if(typeof f[k]!=='number'||!Number.isFinite(f[k])||f[k]<min||f[k]>max)throw Error('Проверьте оформление');
  out.fm[k]=f[k];
 }
 if(f.fn!=null){if(typeof f.fn!=='string'||f.fn.length>100)throw Error('Проверьте шрифт');out.fm.fn=f.fn;}
 return out;
}
const headers={'access-control-allow-origin':'https://innaodincova-finpro.github.io','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST,OPTIONS','content-type':'application/json','cache-control':'no-store'};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
export function handler({auth,config,db,send,now=()=>Date.now()}) {
 return async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return json({error:'Используйте POST'},405);
  try {
   const job=req.headers.get('x-job-key');
   if(job){
    const cfg=await config();
    if(job!==cfg.cron_token)return json({error:'Нет доступа'},403);
    const rows=await db('rpc/claim_studkab_requests','POST',{});
    let sent=0,failed=0;
    for(const row of rows){
     try{
      await send(row);
      await db('studkab_requests?id=eq.'+row.id,'PATCH',{telegram_sent_at:new Date(now()).toISOString(),lease_until:null,last_error:null});sent++;
     }catch{
      failed++;
      await db('studkab_requests?id=eq.'+row.id,'PATCH',{lease_until:null,retry_at:new Date(now()+Math.min(3600000,60000*2**row.telegram_attempts)).toISOString(),last_error:'Telegram: отправка не подтверждена'});
     }
    }
    return json({sent,failed});
   }
   const bearer=req.headers.get('authorization');
   const user=bearer?.startsWith('Bearer ') ? await auth(bearer) : null;
   if(!user||!user.email_confirmed_at||user.is_anonymous)return json({error:'Сначала войдите в приложение через Google'},401);
   const raw=await req.text();if(raw.length>16000)return json({error:'Заявка слишком большая'},413);
   let input;try{input=JSON.parse(raw);}catch{return json({error:'Неверный запрос'},400);}
   if(input.action==='submit'){
    let payload;try{payload=validatePayload(input.payload);}catch(e){return json({error:e.message},400);}
    const result=await db('rpc/submit_studkab_request','POST',{student:user.id,content:payload});
    if(result.conflict)return json({error:'Эта заявка уже передана. Для изменения условий свяжитесь с исполнителем.'},409);
    if(result.limited)return json({error:'Достигнут дневной лимит заявок. Попробуйте завтра.'},429);
    return json({...result,saved:true,telegram:'queued',email:'not_configured'});
   }
   if(input.action==='inbox'){
    const cfg=await config();
    if(user.email.toLowerCase()!==cfg.executor_email.toLowerCase())return json({error:'Входящие доступны только исполнителю'},403);
    const id=input.id;
    if(id!=null&&!/^[a-f0-9-]{36}$/.test(id))return json({error:'Неверный номер'},400);
    const after=input.after??0;
    if(!Number.isSafeInteger(after)||after<0)return json({error:'Неверная страница'},400);
    const rows=await db('studkab_requests?select=id,number,payload,created_at&order=number.asc&limit=100'+(id?'&id=eq.'+id:'&number=gt.'+after));
    return json({rows,next:rows.length===100?rows.at(-1).number:null});
   }
   return json({error:'Неизвестное действие'},400);
  }catch{return json({error:'Сервис временно недоступен. Повторите отправку — дубликат заявки не создастся.'},503);}
 };
}
