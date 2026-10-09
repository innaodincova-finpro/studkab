// Server-only direct adapters. No default model, price, enablement or retries.
import {prepareAssistantText} from './deepseek-assistant.mjs';
import {digest,snapshotJson} from './assistant-bundle.mjs';
const HOSTS={chatgpt:'https://api.openai.com/v1',claude:'https://api.anthropic.com/v1'};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export const MAX_ASSISTANT_RESERVE=75036;
export function directAssistantConfig(provider,get,now=Date.now()){
 if(!Object.hasOwn(HOSTS,provider))return null;
 const prefix=provider==='chatgpt'?'STUDKAB_ASSISTANT_OPENAI':'STUDKAB_ASSISTANT_CLAUDE';
 if(get('STUDKAB_GENERATION_ENABLED')!=='true'||get(prefix+'_ENABLED')!=='true')return null;
 const key=get(provider==='chatgpt'?'OPENAI_API_KEY':'ANTHROPIC_API_KEY');
 if(typeof key!=='string'||!key.trim()||/[\r\n]/.test(key))return null;
 let raw;try{raw=JSON.parse(get(prefix+'_CONFIG'));}catch{return null;}
 if(raw?.priceApproved!==true||typeof raw.model!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(raw.model)||!Number.isSafeInteger(raw.inputMicrousdPerMillion)||raw.inputMicrousdPerMillion<1||raw.inputMicrousdPerMillion>1000000000||!Number.isSafeInteger(raw.outputMicrousdPerMillion)||raw.outputMicrousdPerMillion<1||raw.outputMicrousdPerMillion>1000000000||!Number.isSafeInteger(raw.maxOutputTokens)||raw.maxOutputTokens<1||raw.maxOutputTokens>4000||!Number.isSafeInteger(raw.maxInputBytes)||raw.maxInputBytes<1||raw.maxInputBytes>180000||typeof raw.priceVersion!=='string'||!raw.priceVersion.trim()||raw.priceVersion.length>120||typeof raw.validUntil!=='string'||!Number.isFinite(Date.parse(raw.validUntil))||Date.parse(raw.validUntil)<=now)return null;
 return Object.freeze({provider,key,model:raw.model,inputMicrousdPerMillion:raw.inputMicrousdPerMillion,outputMicrousdPerMillion:raw.outputMicrousdPerMillion,maxOutputTokens:raw.maxOutputTokens,maxInputBytes:raw.maxInputBytes,priceVersion:raw.priceVersion,validUntil:raw.validUntil});
}
function headers(config){return config.provider==='chatgpt'?{'Content-Type':'application/json',Authorization:'Bearer '+config.key}:{'Content-Type':'application/json','x-api-key':config.key,'anthropic-version':'2023-06-01'};}
async function limitedJson(response){
 if(!response.body)throw Error('UNCONFIRMED_RESULT');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000)throw Error('RESPONSE_TOO_BIG');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export async function probeDirectAssistant(config,fetchProvider=globalThis.fetch){
 if(!config||Date.parse(config.validUntil)<=Date.now())return {verified:false};
 try{const r=await fetchProvider(HOSTS[config.provider]+'/models/'+encodeURIComponent(config.model),{method:'GET',headers:headers(config),redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok){await r.body?.cancel();return {verified:false};}const v=await limitedJson(r);return {verified:v.id===config.model};}catch{return {verified:false};}
}
export async function prepareDirectAssistant(bundle,expectedSections,{readFile,config}){
 if(!config||bundle.provider!==config.provider||!Object.hasOwn(HOSTS,config.provider)||Date.parse(config.validUntil)<=Date.now())throw Error('PROVIDER_NOT_CONNECTED');
 const {system,user}=await prepareAssistantText(bundle,expectedSections,{readFile});
 const schema={type:'object',additionalProperties:false,required:['sections'],properties:{sections:{type:'array',items:{type:'object',additionalProperties:false,required:['id','name','text'],properties:{id:{type:'string',enum:expectedSections},name:{type:'string'},text:{type:'string'}}}}}};
 const body=config.provider==='chatgpt'?{model:config.model,instructions:system,input:user,max_output_tokens:config.maxOutputTokens,service_tier:'default',store:false,text:{format:{type:'json_schema',name:'studkab_work',strict:true,schema}}}:{model:config.model,system,messages:[{role:'user',content:user}],max_tokens:config.maxOutputTokens,service_tier:'standard_only',stream:false,output_config:{format:{type:'json_schema',schema}}};
 const inputBytes=new TextEncoder().encode(JSON.stringify(body)).length+4096;
 if(inputBytes>config.maxInputBytes)throw Error('CONTEXT_TOO_BIG');
 const numerator=BigInt(inputBytes)*BigInt(config.inputMicrousdPerMillion)+BigInt(config.maxOutputTokens)*BigInt(config.outputMicrousdPerMillion);
 const estimatedMicrousd=Number((numerator*125n+99999999n)/100000000n);
 if(!Number.isSafeInteger(estimatedMicrousd)||estimatedMicrousd<1||estimatedMicrousd>MAX_ASSISTANT_RESERVE)throw Error('RESERVE_LIMIT');
 const {key,...policy}=config;
 const pricingFingerprint=await digest(new TextEncoder().encode(JSON.stringify(snapshotJson({...policy,adapterVersion:'direct-v1-standard-json'}))));
 return {body,model:config.model,estimatedMicrousd,pricingFingerprint};
}
export async function dispatchDirectAssistant(bundle,jobId,claim,expectedSections,{readFile,config,reserveAndDispatch,fetchProvider=globalThis.fetch}){
 if(!uuid(jobId)||!uuid(claim)||typeof reserveAndDispatch!=='function')throw Error('BUDGET_BINDING_REQUIRED');
 const prepared=await prepareDirectAssistant(bundle,expectedSections,{readFile,config});
 const permit=await reserveAndDispatch({jobId,claim,provider:config.provider,model:prepared.model,estimatedMicrousd:prepared.estimatedMicrousd,pricingFingerprint:prepared.pricingFingerprint});
 if(permit?.ok!==true||!uuid(permit.dispatchId)||!Number.isSafeInteger(permit.reservedMicrousd)||permit.reservedMicrousd<prepared.estimatedMicrousd)throw Error('BUDGET_NOT_CONFIRMED');
 // Exactly one attempt. Any uncertain reply remains terminal and retains reserve.
 const response=await fetchProvider(HOSTS[config.provider]+(config.provider==='chatgpt'?'/responses':'/messages'),{method:'POST',headers:headers(config),body:JSON.stringify(prepared.body),redirect:'error',signal:AbortSignal.timeout(120000)});
 if(!response.ok){await response.body?.cancel();throw Error('UNCONFIRMED_RESULT');}
 const value=await limitedJson(response);let text;
 if(config.provider==='chatgpt'){
  if(value.status!=='completed'||value.error||value.incomplete_details||typeof value.id!=='string'||!value.id||!Array.isArray(value.output)||value.output.some(x=>!['message','reasoning'].includes(x?.type)))throw Error('UNCONFIRMED_RESULT');
  const messages=value.output.filter(x=>x.type==='message');
  if(messages.length!==1||messages[0].role!=='assistant'||messages[0].status!=='completed'||!Array.isArray(messages[0].content)||messages[0].content.length!==1||messages[0].content[0].type!=='output_text')throw Error('INCOMPLETE_DOCUMENT');
  text=messages[0].content[0].text;
 }else{
  if(value.type!=='message'||value.role!=='assistant'||typeof value.id!=='string'||!value.id||value.stop_reason!=='end_turn'||!Array.isArray(value.content)||value.content.length!==1||value.content[0].type!=='text')throw Error('UNCONFIRMED_RESULT');
  text=value.content[0].text;
 }
 if(typeof text!=='string'||text.length>1000000)throw Error('INCOMPLETE_DOCUMENT');
 let output;try{output=JSON.parse(text);}catch{throw Error('INCOMPLETE_DOCUMENT');}
 if(!Array.isArray(output.sections)||output.sections.length!==expectedSections.length||output.sections.some((s,i)=>s?.id!==expectedSections[i]||typeof s.name!=='string'||!s.name.trim()||s.name.length>200||typeof s.text!=='string'||!s.text.trim()))throw Error('INCOMPLETE_DOCUMENT');
 return snapshotJson({status:'completed',jobId,dispatchId:permit.dispatchId,requestId:bundle.requestId,revision:bundle.revision,provider:config.provider,fingerprint:bundle.fingerprint,sections:output.sections});
}
