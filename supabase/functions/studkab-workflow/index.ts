import {handler} from './handler.mjs';
import {verifyUpload} from './upload-check.mjs';
import {runAutomaticChecks} from './document-check.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function request(path:string,method='GET',body?:unknown){
 const response=await fetch(base+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!response.ok){const text=await response.text();throw Error(text.slice(0,500));}
 if(response.status===204)return null;
 const value=await response.json();return Array.isArray(value)&&value.length===1?value[0]:value;
}
async function auth(bearer:string){
 const response=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:bearer},signal:AbortSignal.timeout(10000)});
 return response.ok?await response.json():null;
}
async function isExecutor(id:string){
 const rows=await request('/rest/v1/studkab_executors?select=user_id&active=eq.true&user_id=eq.'+encodeURIComponent(id));
 return Array.isArray(rows)?rows.length===1:!!rows;
}
async function execute(rpc:string,body:unknown){return request('/rest/v1/rpc/'+rpc,'POST',body);}
async function db(path:string,method='GET',body?:unknown){return request('/rest/v1/'+path,method,body);}
Deno.serve(handler({auth,isExecutor,execute,verifyUpload:(input:any,user:any,executor=false)=>verifyUpload({base,key,input,user,db,executor}),runAutomaticChecks:(input:any,user:any)=>runAutomaticChecks({input,user,db}),serviceKey:Deno.env.get('STUDKAB_WORKFLOW_SERVICE_KEY')}));
