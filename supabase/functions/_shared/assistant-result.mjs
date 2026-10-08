// AUTO-ASSISTANT-01. Build Word on the server, using the existing browser generator.
// Intentionally unwired until durable claim/commit RPCs and provider connections exist.
import '../../../result-docx.js';
import {digest,ASSISTANTS,verifyAssistantManifest} from './assistant-bundle.mjs';
export const WORD_TYPE='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
function validateEnvelope(bundle,response){
 if(!bundle||!uuid.test(bundle.requestId)||!hash.test(bundle.fingerprint)||!ASSISTANTS.includes(bundle.provider)||!Number.isSafeInteger(bundle.revision)||bundle.revision<1||!bundle.details)throw Error('INVALID_BUNDLE');
 if(!response||response.status!=='completed'||response.requestId!==bundle.requestId||response.revision!==bundle.revision||response.provider!==bundle.provider||response.fingerprint!==bundle.fingerprint||!uuid.test(response.jobId))throw Error('UNCONFIRMED_RESULT');
 const sections=response.sections;
 if(!Array.isArray(sections)||sections.length<1||sections.length>96)throw Error('INCOMPLETE_DOCUMENT');
 const ids=new Set();let length=0;
 for(const s of sections){
  if(!s||typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(s.id)||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>200||typeof s.text!=='string'||!s.text.trim()||(length+=s.text.length)>1000000)throw Error('INCOMPLETE_DOCUMENT');
  ids.add(s.id);
 }
 // Section expectations come from the stored job plan, not an AI self-report.
 return sections;
}
export async function buildAssistantWord(bundle,response,expectedSections){
 const sections=validateEnvelope(bundle,response);
 await verifyAssistantManifest(bundle);
 if(!Array.isArray(expectedSections)||!expectedSections.length||expectedSections.length!==sections.length||new Set(expectedSections).size!==expectedSections.length||expectedSections.some((id,index)=>id!==sections[index].id))throw Error('INCOMPLETE_DOCUMENT');
 const d=bundle.details;
 const work={topic:d.topic||d.discipline,student:d.student,group:d.group,format:{...d.format,univ:d.univ,faculty:d.faculty,kafedra:d.kafedra,program:d.program,form:d.form,course:d.course,supervisor:d.supervisor,city:d.city,workType:d.workType,discipline:d.discipline},structure:Object.fromEntries(sections.map(s=>[s.id,{text:s.text}]))};
 const bytes=new Uint8Array(await globalThis.ResultDocx(work,sections).arrayBuffer());
 if(bytes.length>5242880)throw Error('RESULT_TOO_BIG');
 return {name:'Работа_'+bundle.requestId+'.docx',type:WORD_TYPE,size:bytes.length,hash:await digest(bytes),bytes};
}
export async function returnAssistantWord(bundle,response,{beginReturn,saveResult,commitReturn,failReturn}){
 validateEnvelope(bundle,response);
 await verifyAssistantManifest(bundle);
 if(typeof failReturn!=='function')throw Error('RETURN_RECOVERY_REQUIRED');
 // Atomic begin must verify an active job/claim, stored fingerprint/revision,
 // unchanged materials, executor ownership, and existing result receipt.
 const permit=await beginReturn({jobId:response.jobId,requestId:bundle.requestId,provider:bundle.provider,revision:bundle.revision,fingerprint:bundle.fingerprint});
 if(permit?.duplicate===true)return {duplicate:true};
 if(permit?.allowed!==true||!uuid.test(permit.claim))throw Error('RESULT_RETURN_BLOCKED');
 try{
 const f=await buildAssistantWord(bundle,response,permit.expectedSections);
 const path='r3-results/'+bundle.requestId+'/'+f.hash;
 await saveResult(path,f.type,f.bytes,f.hash);
 // Atomic commit rechecks the same version/claim. No blind r3-result-set call.
 const receipt=await commitReturn({jobId:response.jobId,claim:permit.claim,requestId:bundle.requestId,revision:bundle.revision,fingerprint:bundle.fingerprint,name:f.name,type:f.type,size:f.size,hash:f.hash,path});
 if(receipt?.ok!==true)throw Error('RESULT_RETURN_NOT_CONFIRMED');
 return {duplicate:receipt.duplicate===true,file:{name:f.name,type:f.type,size:f.size,hash:f.hash},requiresReview:true};
 }catch(error){
  // Release only the file-return claim; never launch inference or reset budgets.
  // The durable adapter must allow a completed commit to win a late failure.
  await failReturn({jobId:response.jobId,claim:permit.claim,code:'RESULT_RETURN_FAILED'});
  throw error;
 }
}
