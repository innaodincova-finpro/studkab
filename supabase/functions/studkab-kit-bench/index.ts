// ROUTE-02-C, BENCH-01: учебный стенд проверки комплекта. Не связан с заявками и кабинетом.
// Вызов только с машинной авторизацией и служебным ключом cron_token; расход ограничен
// отдельным лимитом стенда в базе (studkab_kit_bench_policy), который проверяется до вызова модели.
import {benchHandler} from '../_shared/kit-bench.mjs';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const token=Deno.env.get('STUDKAB_PROXY_TOKEN');
async function db(path:string,body?:unknown){
 const r=await fetch(base+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',
 headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
 body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('DATABASE_UNAVAILABLE');return await r.json();
}
// Комплекты читаются только из репозитория проекта по точному коммиту; адрес не принимается извне.
async function fetchKit(commit:string,kit:string){
 const r=await fetch('https://raw.githubusercontent.com/innaodincova-finpro/studkab/'+commit+'/tests/bench/kits/'+kit+'.json',{signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('KIT_UNAVAILABLE');
 const text=await r.text();if(text.length>400000)throw Error('KIT_UNAVAILABLE');
 return JSON.parse(text);
}
async function provider(c:any,id:string){
 if(!token)return {complete:false};
 // Тот же посредник и та же модель, что у разбора в кабинете.
 const r=await fetch('https://calm-bird-dae8.bf6mhynzgm.workers.dev',{
 method:'POST',headers:{'Content-Type':'application/json','X-Proxy-Token':token},
 body:JSON.stringify({provider:'deepseek',model:'deepseek-flash',system:c.input.system,
 user:c.spec.prompt,max_tokens:c.spec.max_output_tokens,temperature:typeof c.spec?.temperature==='number'?c.spec.temperature:0,client_request_id:id}),
 signal:AbortSignal.timeout(120000)});
 const value=await r.json();
 if(!r.ok)return {complete:false,detail:value?.detail};
 return value;
}
Deno.serve(benchHandler({
 authorize:async(req:Request)=>/^Bearer\s+\S+$/.test(req.headers.get('Authorization')||''),
 config:async()=>(await db('studkab_request_config?id=eq.true&select=cron_token'))[0],
 rpc:(name:string,args:unknown)=>db('rpc/'+name,args),
 fetchKit,provider,
}));
