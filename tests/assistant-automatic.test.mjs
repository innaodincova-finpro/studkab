import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {collectAssistantBundle,digest,ASSISTANTS,MAX_ASSISTANT_BYTES} from '../supabase/functions/_shared/assistant-bundle.mjs';
import {buildAssistantWord,returnAssistantWord,WORD_TYPE} from '../supabase/functions/_shared/assistant-result.mjs';
import {readDocument} from '../supabase/functions/studkab-requests/structured-reader.mjs';
const RID='11111111-1111-4111-8111-111111111111',FID='22222222-2222-4222-8222-222222222222',NEW='33333333-3333-4333-8333-333333333333',JOB='44444444-4444-4444-8444-444444444444',CLAIM='55555555-5555-4555-8555-555555555555';
const bytes=new TextEncoder().encode('Задание: подготовить анализ по предоставленным данным.');
const request={id:RID,revision:2,ready_at:'yes',payload:{route:'r3',t:'Учебный пример',k:'Практическая работа',d:'Экономика',u:'Учебный вуз',n:'Тестовый студент',g:'Группа 1',s:'Преподаватель',kf:'Кафедра',pr:'Экономика',fo:'Очно-заочная',co:'1'}};
async function attachment(extra={}){return {id:FID,request_id:RID,file_name:'Задание.txt',content_type:'text/plain',file_hash:await digest(bytes),size_bytes:bytes.length,storage_path:RID+'/file',...extra};}
async function kit(provider='claude',extra={}){return collectAssistantBundle({request:structuredClone(request),provider,attachments:[await attachment()],attachmentsComplete:true,...extra},{loadRequestFile:async()=>bytes});}
function response(b,extra={}){return {status:'completed',jobId:JOB,requestId:RID,revision:b.revision,provider:b.provider,fingerprint:b.fingerprint,sections:[{id:'answer',name:'Решение',text:'Результат анализа по заданию.\n| Показатель | Значение |\n|---|---|\n| Выручка | 100 |'}],...extra};}
function adapter(extra={}){
 const calls=[];let done=false;
 return {calls,deps:{beginReturn:async x=>{calls.push(['begin',x]);return done?{duplicate:true}:{allowed:true,claim:CLAIM,expectedSections:['answer']};},saveResult:async(...x)=>calls.push(['save',...x]),commitReturn:async x=>{calls.push(['commit',x]);done=true;return {ok:true};},failReturn:async x=>calls.push(['failure',x]),...extra}};
}
test('each explicit assistant receives the same verified current kit; no default',async()=>{
 for(const provider of ASSISTANTS){const b=await kit(provider);assert.equal(b.provider,provider);assert.deepEqual(b.files[0].bytes,bytes);assert.equal(b.details.student,request.payload.n);assert.equal(b.details.supervisor,request.payload.s);}
 await assert.rejects(kit(null),/ASSISTANT_REQUIRED/);
});
test('replacement leaves only current files; fingerprints are deterministic and version-bound',async()=>{
 const a=await attachment(),n=await attachment({id:NEW,supersedes:FID});const b=await kit('chatgpt',{attachments:[a,n]});
 assert.deepEqual(b.files.map(x=>x.id),[NEW]);assert.equal(b.fingerprint,(await kit('chatgpt',{attachments:[n,a]})).fingerprint);
 assert.notEqual(b.fingerprint,(await kit('chatgpt',{request:{...request,revision:3},attachments:[a,n]})).fingerprint);
});
test('partial list, foreign file and replacement cycles cannot masquerade as a complete kit',async()=>{
 await assert.rejects(kit('deepseek',{attachmentsComplete:false}),/INCOMPLETE_ATTACHMENT_LIST/);
 await assert.rejects(kit('deepseek',{attachments:[await attachment({request_id:JOB})]}),/INVALID_ATTACHMENT/);
 await assert.rejects(kit('claude',{attachments:[await attachment({supersedes:NEW}),await attachment({id:NEW,supersedes:FID})]}),/INVALID_REPLACEMENT_CHAIN/);
});
test('hash/size mismatch blocks preparation, and oversized kits are never truncated',async()=>{
 await assert.rejects(kit('claude',{attachments:[await attachment({file_hash:'0'.repeat(64)})]}),/DAMAGED_ATTACHMENT/);
 const files=await Promise.all(Array.from({length:6},(_,i)=>attachment({id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),size_bytes:5242880})));
 assert.ok(files.reduce((n,f)=>n+f.size_bytes,0)>MAX_ASSISTANT_BYTES);await assert.rejects(kit('claude',{attachments:files}),/MATERIALS_TOO_BIG/);
});
test('missing metadata or materials block work without inventing title-page details',async()=>{
 await assert.rejects(kit('claude',{request:{...request,payload:{...request.payload,n:''}}}),/MISSING_REQUEST_DETAILS/);
 await assert.rejects(kit('claude',{attachments:[]}),/MATERIALS_REQUIRED/);
 const b=await kit('claude',{request:{...request,payload:{...request.payload,s:''}}});assert.equal(b.details.supervisor,'');
});
test('all three completions produce a real parseable Word with original metadata and table',async()=>{
 for(const provider of ASSISTANTS){const b=await kit(provider);const f=await buildAssistantWord(b,response(b),['answer']);assert.equal(f.type,WORD_TYPE);assert.equal(f.hash,await digest(f.bytes));
  const read=await readDocument(f.bytes,f.type,{DOMParser});assert.equal(read.status,'ready');assert.match(read.extracted_text,/Тестовый студент/);assert.match(read.extracted_text,/Учебный вуз/);assert.match(read.extracted_text,/Результат анализа/);assert.match(read.extracted_text,/Выручка/);
 }
});
test('incomplete/refused/foreign/old provider response never saves a result',async()=>{
 const b=await kit();for(const extra of [{status:'incomplete'},{status:'refused'},{requestId:JOB},{revision:1},{provider:'deepseek'},{fingerprint:'0'.repeat(64)}]){const a=adapter();await assert.rejects(returnAssistantWord(b,response(b,extra),a.deps),/UNCONFIRMED_RESULT/);assert.deepEqual(a.calls,[]);}
});
test('missing, duplicated or out-of-order planned sections fail before storage',async()=>{
 const b=await kit();for(const sections of [[],['other'],['answer','missing']])await assert.rejects(buildAssistantWord(b,response(b),sections),/INCOMPLETE_DOCUMENT/);
 await assert.rejects(buildAssistantWord(b,response(b,{sections:[{id:'answer',name:'A',text:'a'},{id:'answer',name:'B',text:'b'}]}),['answer','answer']),/INCOMPLETE_DOCUMENT/);
});
test('changed kit metadata cannot reuse an old fingerprint to alter the result',async()=>{
 const b=await kit();const r=response(b);b.details.student='Другой студент';const a=adapter();await assert.rejects(returnAssistantWord(b,r,a.deps),/BUNDLE_CHANGED/);assert.deepEqual(a.calls,[]);
});
test('server return needs atomic authorization and preserves review before delivery',async()=>{
 const b=await kit('chatgpt'),r=response(b),a=adapter();const result=await returnAssistantWord(b,r,a.deps);assert.equal(result.requiresReview,true);assert.deepEqual(a.calls.map(x=>x[0]),['begin','save','commit']);assert.equal(a.calls[2][1].path,'r3-results/'+RID+'/'+result.file.hash);assert.equal(a.calls[2][1].claim,CLAIM);
 const again=await returnAssistantWord(b,r,a.deps);assert.equal(again.duplicate,true);assert.equal(a.calls.filter(x=>x[0]==='save').length,1);
});
test('stale/deleted/unauthorized job cannot attach any file',async()=>{
 const b=await kit(),a=adapter({beginReturn:async()=>({allowed:false})});await assert.rejects(returnAssistantWord(b,response(b),a.deps),/RESULT_RETURN_BLOCKED/);assert.deepEqual(a.calls,[]);
});
test('storage failure records recoverable file-return failure without a commit',async()=>{
 const b=await kit(),a=adapter({saveResult:async()=>{throw Error('STORAGE_UNAVAILABLE');}});await assert.rejects(returnAssistantWord(b,response(b),a.deps),/STORAGE_UNAVAILABLE/);assert.deepEqual(a.calls.map(x=>x[0]),['begin','failure']);assert.equal(a.calls[1][1].claim,CLAIM);
});
test('unconfirmed commit never reports success, preserving recovery on the server',async()=>{
 const b=await kit(),a=adapter({commitReturn:async()=>({stale:true})});await assert.rejects(returnAssistantWord(b,response(b),a.deps),/RESULT_RETURN_NOT_CONFIRMED/);assert.deepEqual(a.calls.map(x=>x[0]),['begin','save','failure']);
});
