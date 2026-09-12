import {handler} from './handler.mjs';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function db(path:string,body?:unknown){
 const r=await fetch(base+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',
 headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
 body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('DATABASE_UNAVAILABLE');return r.json();
}
Deno.serve(handler({db,
 auth:async(bearer:string)=>{
  const r=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:bearer},signal:AbortSignal.timeout(10000)});
  return r.ok?r.json():null;
 },
 config:async()=>(await db('studkab_request_config?id=eq.true&select=executor_email'))[0],
 settings:()=>({enabled:Deno.env.get('STUDKAB_GENERATION_ENABLED')==='true'&&!!Deno.env.get('STUDKAB_PROXY_TOKEN'),
  cost:Number(Deno.env.get('STUDKAB_GENERATION_PART_RESERVE_MICROUSD')||0)})
}));
