const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
export function handler({config,rpc,provider,ready,authorize,readiness,prepare,failClaim}) {
 return async req=>{
  if(req.method!=='POST')return reply({error:'METHOD'},405);
  // Fail closed before reading configuration or claiming any work.
  try {
   if(!authorize || !await authorize(req))return reply({error:'UNAUTHORIZED'},401);
  } catch { return reply({error:'AUTH_UNAVAILABLE'},503); }
  let cfg;
  try{cfg=await config();}catch{return reply({error:'CONFIG_UNAVAILABLE'},503);}
  const token=req.headers.get('X-Studkab-Runner');
  if(!cfg?.cron_token||!token||token!==cfg.cron_token)return reply({error:'UNAUTHORIZED'},401);
  if(req.headers.get('X-Studkab-Probe')==='1') {
   const state=readiness?readiness():{};
   return reply({enabled:state.enabled===true,providerConfigured:state.providerConfigured===true});
  }
  if(!ready())return reply({status:'disabled',error:'PROVIDER_NOT_CONFIGURED'},503);
  let c;
  try{c=await rpc('studkab_gen_claim',{});}catch{return reply({error:'CLAIM_UNAVAILABLE'},503);}
  if(!c)return reply({status:'idle'});
  if(prepare){
   try{c=await prepare(c);}catch(e){
    const code=e.message==='CONTEXT_TOO_BIG'?'CONTEXT_TOO_BIG':'PREPARATION_UNAVAILABLE';
    try{if(failClaim)await failClaim(c);}catch{return reply({status:'block_unconfirmed',code},503);}
    return reply({status:'blocked',code,job:c.job_id},409);
   }
  }
  const args={p_job:c.job_id,p_ordinal:c.ordinal,p_claim:c.claim};
  let id;
  // Never retry this call: commit may have happened even when its response is lost.
  try{id=await rpc('studkab_gen_dispatch',args);}catch{return reply({status:'dispatch_unconfirmed',job:c.job_id},503);}
  if(!id)return reply({status:'budget',job:c.job_id});
  let result;
  try{result=await provider(c,id);}catch{result=null;}
  const valid=result?.complete===true && typeof result.text==='string' && result.text.trim() && new TextEncoder().encode(result.text).byteLength<=100000;
  const detail=result?.detail||{};
  try{
   const state=await rpc('studkab_gen_settle',{...args,p_request:id,p_text:valid?result.text:null,
    p_detail:{finish_reason:detail.reason,request_id:detail.request_id,prompt_tokens:detail.prompt_tokens,completion_tokens:detail.completion_tokens}});
   return reply({status:state,job:c.job_id,part:c.ordinal,request_id:id});
  }catch{
   // Leave dispatched state; lease recovery records unknown. Never regenerate here.
   return reply({status:'save_unconfirmed',job:c.job_id,request_id:id},503);
  }
 };
}
