import {handler} from './handler.mjs';
import {checkReserve} from './reserve.mjs';
import {withContext} from './context.mjs';
import {machineAuthorization} from './auth.mjs';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
const token=Deno.env.get('STUDKAB_PROXY_TOKEN');
const enabled=Deno.env.get('STUDKAB_GENERATION_ENABLED')==='true';
async function db(path:string,body?:unknown,method?:string){
 const r=await fetch(base+'/rest/v1/'+path,{method:method||(body===undefined?'GET':'POST'),
 headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},
 body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('DATABASE_UNAVAILABLE');return await r.json();
}
async function provider(c:any,id:string){
 // Fixed existing endpoint. Never accept provider URLs or secrets from task input.
 const r=await fetch('https://calm-bird-dae8.bf6mhynzgm.workers.dev',{
 method:'POST',headers:{'Content-Type':'application/json','X-Proxy-Token':token!},
 body:JSON.stringify({provider:'deepseek',model:'deepseek-flash',system:c.input.system,
 user:c.spec.prompt,max_tokens:c.spec.max_output_tokens,temperature:0.4,client_request_id:id}),
 signal:AbortSignal.timeout(120000)});
 const value=await r.json();
 // Preserve safe provider diagnostics without treating an HTTP error as completion.
 if(!r.ok)return {complete:false,detail:value?.detail};
 return value;
}
Deno.serve(handler({
 // Gateway JWT verification remains enabled; a user JWT is insufficient here.
 authorize:async(req:Request)=>machineAuthorization(req,{serviceKey:key,anonKey}),
 config:async()=>(await db('studkab_request_config?id=eq.true&select=cron_token'))[0],
 rpc:(name:string,args:unknown)=>db('rpc/'+name,args),
 prepare:async(c:any)=>checkReserve(withContext(c,await db('studkab_gen_parts?job_id=eq.'+c.job_id+'&ordinal=lt.'+c.ordinal+'&select=ordinal,state,result&order=ordinal.asc'))),
 failClaim:(c:any,code:string)=>db('rpc/studkab_gen_fail_preparation',{
  p_job:c.job_id,p_ordinal:c.ordinal,p_claim:c.claim,p_reason:code
 }),
 provider,ready:()=>enabled && !!token,
 readiness:()=>({enabled,providerConfigured:!!token})
}));
