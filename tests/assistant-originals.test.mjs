import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {collectAssistantBundle,digest} from '../supabase/functions/_shared/assistant-bundle.mjs';
import {ORIGINALS_PROTOCOL,ORIGINALS_OUTPUTS,originalInputs} from '../supabase/functions/_shared/assistant-originals.mjs';
import {prepareDirectAssistant,dispatchDirectAssistant} from '../supabase/functions/_shared/direct-assistant.mjs';
import {prepareDeepseekAssistant} from '../supabase/functions/_shared/deepseek-assistant.mjs';
import {buildAssistantWord} from '../supabase/functions/_shared/assistant-result.mjs';
import {prepareAssistant} from '../supabase/functions/studkab-requests/assistant-service.mjs';
import worker from '../worker/ai-proxy.mjs';
const id='11111111-1111-4111-8111-111111111111',fileId='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',actor='44444444-4444-4444-8444-444444444444';
const payload={route:'r3',n:'Student',u:'University',k:'Практические задания',d:'Математика'};
const readFile=()=>{throw Error('Application reader must not run');};
async function source(type='application/pdf',bytes=new TextEncoder().encode('%PDF-1.7 original image formula')){
 return {request:{id,revision:1,ready_at:'yes',payload},attachmentsComplete:true,attachments:[{id:fileId,request_id:id,file_name:type==='application/pdf'?'Задание.pdf':'Original.docx',content_type:type,size_bytes:bytes.length,file_hash:await digest(bytes),storage_path:id+'/file'}],context:{passports:[],answers:[],materialRevisions:[],transferProtocol:ORIGINALS_PROTOCOL},basis:{}};
}
async function kit(provider,type,bytes){const s=await source(type,bytes);return collectAssistantBundle({...s,provider},{loadRequestFile:async()=>bytes||new TextEncoder().encode('%PDF-1.7 original image formula')});}
const config=provider=>({provider,key:'synthetic',model:'approved-model',inputMicrousdPerMillion:100000,outputMicrousdPerMillion:100000,maxOutputTokens:4000,maxInputBytes:180000,priceVersion:'test',validUntil:'2099-01-01T00:00:00Z'});
for(const provider of ['claude','chatgpt'])test(provider+' sends exact original PDF bytes and counts its processed input without invoking the reader',async()=>{
 const bundle=await kit(provider);let counted;
 const prepared=await prepareDirectAssistant(bundle,ORIGINALS_OUTPUTS,{readFile,config:config(provider),fetchProvider:async(url,opts)=>{assert.match(url,/count_tokens|input_tokens/);counted=JSON.parse(opts.body);return Response.json({input_tokens:800});}});
 const part=provider==='claude'?prepared.body.messages[0].content[1]:prepared.body.input[0].content[1];
 const encoded=provider==='claude'?part.source.data:part.file_data.split(',')[1];
 assert.deepEqual(new Uint8Array(Buffer.from(encoded,'base64')),bundle.files[0].bytes);
 assert.deepEqual(provider==='claude'?counted.messages:counted.input,provider==='claude'?prepared.body.messages:prepared.body.input);
 assert.match(JSON.stringify(prepared.body),/commentary/);assert.match(JSON.stringify(prepared.body),/ограничения/);
});
test('unsupported native format rejects the entire kit before cost, acceptance or a paid reserve',async()=>{
 const bytes=new Uint8Array([80,75,3,4]);const type='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 for(const provider of ['claude','deepseek']){
  const b=await kit(provider,type,bytes);let calls=0;
  await assert.rejects(provider==='claude'?prepareDirectAssistant(b,ORIGINALS_OUTPUTS,{readFile,config:config(provider),fetchProvider:async()=>calls++}):prepareDeepseekAssistant(b,ORIGINALS_OUTPUTS,{readFile}),/ORIGINAL_FORMAT_UNSUPPORTED/);
  assert.equal(calls,0);
 }
 const s=await source(type,bytes);let writes=0;
 await assert.rejects(prepareAssistant({id,provider:'claude',operation:job},{id:actor},{rpc:async n=>{if(n==='studkab_assistant_snapshot')return s;writes++;},loadRequestFile:async()=>bytes,sourcePlan:readFile,planSections:readFile,validateBundle:b=>prepareDirectAssistant(b,ORIGINALS_OUTPUTS,{readFile,config:config('claude')})}),/ORIGINAL_FORMAT_UNSUPPORTED/);
 assert.equal(writes,0);
});
test('missing cost receipt, damaged original and missing commentary never produce a completed file',async()=>{
 const b=await kit('chatgpt');let reserved=0,paid=0;
 await assert.rejects(dispatchDirectAssistant(b,job,actor,ORIGINALS_OUTPUTS,{readFile,config:config('chatgpt'),reserveAndDispatch:async()=>reserved++,fetchProvider:async url=>{if(!url.endsWith('/input_tokens'))paid++;return Response.json({input_tokens:0});}}),/INPUT_COST_UNCONFIRMED/);
 assert.equal(reserved,0);assert.equal(paid,0);
 const response={status:'completed',jobId:job,requestId:id,revision:1,provider:'chatgpt',fingerprint:b.fingerprint,sections:[{id:'work',name:'Работа',text:'Решение'}]};
 await assert.rejects(buildAssistantWord(b,response,['work']),/INCOMPLETE_DOCUMENT/);
 b.files[0].bytes[0]=0;await assert.rejects(originalInputs(b,ORIGINALS_OUTPUTS),/FILE_BYTES_REQUIRED/);
});
test('the original output contract returns work and commentary together in the generated Word',async()=>{
 const b=await kit('chatgpt');const response={status:'completed',jobId:job,requestId:id,revision:1,provider:'chatgpt',fingerprint:b.fingerprint,sections:[{id:'work',name:'Работа',text:'Решение задания'},{id:'commentary',name:'Комментарий',text:'Получен Задание.pdf. Задание выполнено. Ограничения указаны.'}]};
 const f=await buildAssistantWord(b,response,ORIGINALS_OUTPUTS);assert.ok(f.bytes.length>0);
 // Existing Word generator stores XML entries without compression.
 assert.match(new TextDecoder().decode(f.bytes),/Получен Задание.pdf/);
});
test('R3 chat can export unclassified, unread materials without an approved passport',()=>{
 const html=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
 const ctx={DraftQuality:{inputs:()=>({})},r3TitleText:()=> 'Данные заявки'};vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('function preparationBlockers(x){'),html.indexOf('function buildPrompt(x){')),ctx);
 vm.runInContext(html.slice(html.indexOf('function buildChatgptPrompt(x){'),html.indexOf('/* ---------- ПОСТАВЩИКИ')),ctx);
 const x={route3:true,requestNumber:4,materialRevision:{state:'locked'},passports:[],attachments:[{file_name:'Original.docx',size_bytes:4,file_hash:'a'.repeat(64),category:'unclassified',read_status:'blocked'}]};
 assert.deepEqual(Array.from(ctx.preparationBlockers(x)),[]);
 const prompt=ctx.buildChatgptPrompt(x);assert.match(prompt,/Original.docx/);assert.match(prompt,/комментарий/);assert.doesNotMatch(prompt,/подготовку не начинать|Без вступлений и комментариев/);
});
test('DeepSeek original images pass through the existing proxy as native image parts, without text extraction',async()=>{
 const b=await kit('deepseek','image/png',new Uint8Array([137,80,78,71,1]));
 const p=await prepareDeepseekAssistant(b,ORIGINALS_OUTPUTS,{readFile});assert.equal(JSON.parse(p.user)[1].type,'image_url');
 const previous=globalThis.fetch;let sent;
 try{
  globalThis.fetch=async(url,opts)=>{sent=JSON.parse(opts.body);return Response.json({choices:[{message:{content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}});};
  const {estimatedMicrousd,...body}=p;
  const reply=await worker.fetch(new Request('https://proxy.test',{method:'POST',headers:{'Content-Type':'application/json','X-Proxy-Token':'synthetic'},body:JSON.stringify(body)}),{PROXY_TOKEN:'synthetic',DEEPSEEK_KEY:'synthetic'});
  assert.equal(reply.status,200);assert.equal(sent.messages[1].content[1].type,'image_url');assert.equal((await reply.json()).complete,true);
 }finally{globalThis.fetch=previous;}
});
