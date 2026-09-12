import {expandParts} from './plan.mjs';
const headers={'Content-Type':'application/json','Cache-Control':'no-store',
 'Access-Control-Allow-Origin':'https://innaodincova-finpro.github.io',
 'Access-Control-Allow-Headers':'authorization,content-type,apikey',
 'Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const idPattern=/^[a-zA-Z0-9_-]{1,100}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function prepare(input,cost){
 if(typeof input.request!=='string'||!idPattern.test(input.request) || typeof input.system!=='string' || !input.system.trim()
 || input.system.length>100000 || !Array.isArray(input.parts) || input.parts.length<1 || input.parts.length>100)
  throw Error('INVALID_INPUT');
 if(!Number.isSafeInteger(cost)||cost<250000||cost>999999999999)throw Error('COST_NOT_CONFIGURED');
 const ids=new Set();
 const validated=input.parts.map(p=>{
  if(!p || typeof p.id!=='string'||!idPattern.test(p.id)||ids.has(p.id)
   ||typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>80000
   ||input.system.length+p.prompt.length>180000)throw Error('INVALID_PART');
  ids.add(p.id);
  // Ignore all client price, owner, model and URL fields.
  return {id:p.id,prompt:p.prompt,target_chars:p.target_chars};
 });
 const plan=expandParts(validated,cost);
 const snapshot={system:input.system};
 if(new TextEncoder().encode(JSON.stringify({input:snapshot,plan})).byteLength>900000)throw Error('INPUT_TOO_BIG');
 return {snapshot,plan};
}
export function handler({auth,config,db,settings}){
 return async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'METHOD'},405);
  try{
   const bearer=req.headers.get('Authorization');
   const user=bearer?.startsWith('Bearer ')?await auth(bearer):null;
   if(!user?.id||!user.email_confirmed_at||user.is_anonymous)return reply({error:'UNAUTHORIZED'},401);
   const cfg=await config();
   if(!cfg?.executor_email||typeof user.email!=='string'||user.email.toLowerCase()!==cfg.executor_email.toLowerCase())
    return reply({error:'FORBIDDEN'},403);
   const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>900000)return reply({error:'INPUT_TOO_BIG'},413);
   let input;try{input=JSON.parse(raw);}catch{return reply({error:'INVALID_JSON'},400);}
   if(!input||typeof input!=='object'||Array.isArray(input))return reply({error:'INVALID_INPUT'},400);
   if(input.action==='capabilities'){
    const [b]=await db('studkab_gen_budget?id=eq.true&select=limit_microusd,reserved_microusd');
    const s=settings();
    return reply({enabled:s.enabled===true&&Number.isSafeInteger(s.cost)&&s.cost>=250000,
     budgetAvailable:Number.isSafeInteger(s.cost)&&s.cost>=250000&&!!b&&Number(b.limit_microusd)-Number(b.reserved_microusd)>=s.cost});
   }
   if(input.action==='start'){
    const s=settings();
    if(!s.enabled)return reply({error:'GENERATION_NOT_CONFIGURED'},503);
    let prepared;try{prepared=prepare(input,s.cost);}catch(e){return reply({error:e.message},400);}
    const [b]=await db('studkab_gen_budget?id=eq.true&select=limit_microusd,reserved_microusd');
    if(!b||Number(b.limit_microusd)-Number(b.reserved_microusd)<s.cost)return reply({error:'BUDGET_BLOCKED'},409);
    const job=await db('rpc/studkab_gen_start',{p_owner:user.id,p_request:input.request,
     p_input:prepared.snapshot,p_plan:prepared.plan});
    return reply({job,status:'queued'});
   }
   if(input.action==='history'){
    if(typeof input.request!=='string'||!idPattern.test(input.request))return reply({error:'INVALID_INPUT'},400);
    const jobs=await db('studkab_gen_jobs?request_id=eq.'+encodeURIComponent(input.request)+'&owner_id=eq.'+encodeURIComponent(user.id)+'&select=id,request_id,version,status,created_at&order=created_at.desc&limit=20');
    return reply({jobs});
   }
   if(input.action==='status'){
    if(!uuid.test(input.job||''))return reply({error:'INVALID_JOB'},400);
    const [job]=await db('studkab_gen_jobs?id=eq.'+input.job+'&owner_id=eq.'+encodeURIComponent(user.id)+'&select=id,request_id,version,status,created_at');
    if(!job)return reply({error:'NOT_FOUND'},404);
    const parts=await db('studkab_gen_parts?job_id=eq.'+job.id+'&select=ordinal,state,result,spec&order=ordinal.asc');
    // Claim tokens, input prompts and service configuration never enter the response.
    return reply({job,parts:parts.map(p=>({ordinal:p.ordinal,id:p.spec?.id,section:p.spec?.section_id||p.spec?.id,state:p.state,text:p.state==='done'?p.result:null}))});
   }
   return reply({error:'UNKNOWN_ACTION'},400);
  }catch{return reply({error:'SERVICE_UNAVAILABLE'},503);}
 };
}
