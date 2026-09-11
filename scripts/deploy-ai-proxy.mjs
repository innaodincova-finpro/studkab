// Only updates code of the existing Worker. No secrets are read from Cloudflare.
import {readFile,appendFile} from 'node:fs/promises';
const account=process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token=process.env.CLOUDFLARE_API_TOKEN?.trim();
if(account!=='1335d0bfa8029bd5f2da8867560ac512'||!token)throw Error('Missing credentials or unexpected account');
const root=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/calm-bird-dae8`;
async function api(path,options={}){
 const r=await fetch(root+path,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(`Cloudflare HTTP ${r.status} at ${path}`);
 return r;
}
async function data(path){const j=await(await api(path)).json();if(!j.success)throw Error(`Cloudflare rejected ${path}`);return j.result;}
const before=await data('/settings');
const deployments=await data('/deployments');
const previous=deployments.deployments?.[0]?.versions;
if(!previous?.length)throw Error('Cannot establish rollback deployment');
await appendFile(process.env.GITHUB_STEP_SUMMARY,`## AI proxy deployment\nWorker: calm-bird-dae8\nPrevious versions for rollback: ${JSON.stringify(previous)}\n`);
const source=await readFile('worker/ai-proxy.mjs','utf8');
const form=new FormData();form.set('metadata',JSON.stringify({main_module:'ai-proxy.mjs'}));form.set('ai-proxy.mjs',new Blob([source],{type:'application/javascript+module'}),'ai-proxy.mjs');
const result=await(await api('/content',{method:'PUT',body:form})).json();
if(!result.success)throw Error('Cloudflare rejected code update');
const after=await data('/settings');
// No settings changes are expected from the content-only endpoint.
const normalized=x=>JSON.stringify(Object.fromEntries(Object.entries(x).sort()));
if(normalized(before)!==normalized(after))throw Error('Settings changed; review deployment before frontend release');
const response=await api('');
let deployed;
if((response.headers.get('content-type')||'').includes('multipart/form-data')){
 const parts=await response.formData();const module=parts.get('ai-proxy.mjs');if(!module)throw Error('Deployed module missing');deployed=await module.text();
}else deployed=await response.text();
if(deployed!==source)throw Error('Deployed source differs');
console.log('Worker code updated and verified; settings preserved. No paid AI request made.');
await appendFile(process.env.GITHUB_STEP_SUMMARY,'\nCode verified byte-for-byte. Settings preserved. Real generation remains to be tested.\n');
