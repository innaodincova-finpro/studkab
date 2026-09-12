import {handler} from './handler.mjs';
import {machineAuthorization} from './auth.mjs';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const token=Deno.env.get('STUDKAB_PROXY_TOKEN');
const enabled=Deno.env.get('STUDKAB_GENERATION_ENABLED')==='true';
async function db(path:string,body?:unknown){
 const r=await fetch(base+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',
 headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
 body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('DATABASE_UNAVAILABLE');return await r.json();
}
async function provider(c:any,id:string){
 // Fixed existing endpoint. Never accept provider URLs or secrets from task input.
 const r=await fetch('https://calm-bird-dae8.bf6mhynzgm.workers.dev',{
 method:'POST',headers:{'Content-Type':'application/json','X-Proxy-Token':token!},
 body:JSON.stringify({provider:'deepseek',model:'deepseek-chat',system:c.input.system,
 user:c.spec.prompt,max_tokens:2500,temperature:0.4,client_request_id:id}),
 signal:AbortSignal.timeout(90000)});
 const value=await r.json();
 // Preserve safe provider diagnostics without treating an HTTP error as completion.
 if(!r.ok)return {complete:false,detail:value?.detail};
 return value;
}
Deno.serve(handler({
 // Gateway JWT verification remains enabled; a user JWT is insufficient here.
 authorize:async(req:Request)=>machineAuthorization(req,{serviceKey:key,anonKey:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjcHRod211aW9kcmplcGlmenNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDQzMTQsImV4cCI6MjEwNDEyMDMxNH0.m2q95-t6bM36I_uhJE3HYOABfdhbYoCPF0U_OsWAprY'}),
 config:async()=>(await db('studkab_request_config?id=eq.true&select=cron_token'))[0],
 rpc:(name:string,args:unknown)=>db('rpc/'+name,args),
 provider,ready:()=>enabled && !!token,
 readiness:()=>({enabled,providerConfigured:!!token})
}));
