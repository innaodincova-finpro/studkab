import {deepseekCapability} from '../studkab-requests/assistant-service.mjs';
import {probeDeepseekAssistant} from './deepseek-assistant.mjs';
import {directAssistantConfig,probeDirectAssistant} from './direct-assistant.mjs';
import {createAssistantFinances} from './assistant-finances.mjs';
export function createAssistantProviders({get,rpc,fetchProvider=globalThis.fetch}){
 const config=provider=>directAssistantConfig(provider,get);
 const capability=(actor,provider='deepseek',{diagnostics=false}={})=>{
  if(provider==='deepseek')return deepseekCapability(actor,{rpc,diagnostics,enabled:get('STUDKAB_ASSISTANT_DEEPSEEK_ENABLED')==='true'&&get('STUDKAB_GENERATION_ENABLED')==='true',configured:!!get('STUDKAB_PROXY_TOKEN'),probe:()=>probeDeepseekAssistant(get('STUDKAB_PROXY_TOKEN'),fetchProvider)});
  if(!['claude','chatgpt'].includes(provider))return {available:false,reason:'not_connected'};
  const cfg=config(provider);
  return deepseekCapability(actor,{rpc,diagnostics,enabled:!!cfg,configured:!!cfg,probe:()=>probeDirectAssistant(cfg,fetchProvider)});
 };
 async function ready(actor){
  const available=await Promise.all(['deepseek','claude','chatgpt'].map(async p=>(await capability(actor,p)).available?p:null));
  const providers=available.filter(Boolean),providerConfigs={};
  for(const p of providers)if(p!=='deepseek')providerConfigs[p]=config(p);
  return {providers,providerConfigs};
 }
 const finances=createAssistantFinances({get,rpc,fetchProvider});
 return {config,capability,ready,finances};
}
