// AUTO-ASSISTANT-01. No provider calls, credentials or client-supplied URLs.
// The caller must load the complete attachment list; a truncated list is not a kit.
import {currentAttachments} from './current-attachments.mjs';
export const ASSISTANTS=Object.freeze(['claude','chatgpt','deepseek']);
export const MAX_ASSISTANT_BYTES=25*1024*1024;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
export async function digest(bytes){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function verifyAssistantManifest(bundle){
 const manifest={schema:1,requestId:bundle.requestId,revision:bundle.revision,provider:bundle.provider,details:bundle.details,files:bundle.files.map(f=>({id:f.id,name:f.name,type:f.type,size:f.size,hash:f.hash}))};
 if(await digest(new TextEncoder().encode(JSON.stringify(manifest)))!==bundle.fingerprint)throw Error('BUNDLE_CHANGED');
}
function string(value,max=4000){
 if(value==null)return '';
 if(typeof value!=='string'||value.length>max)throw Error('INVALID_REQUEST_DETAILS');
 return value;
}
export function requestDetails(p){
 if(!p||typeof p!=='object'||Array.isArray(p)||p.route!=='r3')throw Error('INVALID_REQUEST_DETAILS');
 const details={topic:string(p.t),workType:string(p.k),discipline:string(p.d),univ:string(p.u),faculty:string(p.fc),kafedra:string(p.kf),city:string(p.ct),student:string(p.n),group:string(p.g),supervisor:string(p.s),program:string(p.pr),form:string(p.fo),course:string(p.co),deadline:string(p.dl),requirements:string(p.rq,20000),methodNotes:string(p.mn,20000)};
 for(const field of ['student','univ','workType','discipline'])if(!details[field].trim())throw Error('MISSING_REQUEST_DETAILS');
 if(p.fm!=null&&(typeof p.fm!=='object'||Array.isArray(p.fm)))throw Error('INVALID_REQUEST_DETAILS');
 const f=p.fm||{};
 details.format={};
 for(const [key,source] of Object.entries({mTop:'mt',mRight:'mr',mBottom:'mb',mLeft:'ml',size:'sz',spacing:'sp',indent:'ind'})){
  if(f[source]!=null){if(typeof f[source]!=='number'||!Number.isFinite(f[source]))throw Error('INVALID_FORMAT');details.format[key]=f[source];}
 }
 if(f.fn!=null)details.format.font=string(f.fn,100);
 return details;
}
export async function collectAssistantBundle({request,provider,attachments,attachmentsComplete}, {loadRequestFile}){
 if(!ASSISTANTS.includes(provider))throw Error('ASSISTANT_REQUIRED');
 if(!request||!uuid.test(request.id)||!Number.isSafeInteger(request.revision)||request.revision<1||!request.ready_at||request.deleting_at)throw Error('INVALID_REQUEST');
 const details=requestDetails(request.payload);
 if(attachmentsComplete!==true||!Array.isArray(attachments)||attachments.length>200)throw Error('INCOMPLETE_ATTACHMENT_LIST');
 const ids=new Set();
 for(const a of attachments){
  if(!a||!uuid.test(a.id)||ids.has(a.id)||a.request_id!==request.id||!hash.test(a.file_hash)||!Number.isSafeInteger(a.size_bytes)||a.size_bytes<1||a.size_bytes>5242880||typeof a.storage_path!=='string'||!a.storage_path||a.storage_path.includes('..')||/^https?:/i.test(a.storage_path))throw Error('INVALID_ATTACHMENT');
  string(a.file_name,300);string(a.content_type,200);
  if(!a.file_name?.trim()||!a.content_type?.trim())throw Error('INVALID_ATTACHMENT');
  ids.add(a.id);
 }
 // A malformed replacement chain must not silently eliminate all documents.
 const byId=new Map(attachments.map(a=>[a.id,a]));
 for(const a of attachments){let cursor=a;const chain=new Set();while(cursor?.supersedes){if(chain.has(cursor.id))throw Error('INVALID_REPLACEMENT_CHAIN');chain.add(cursor.id);cursor=byId.get(cursor.supersedes);}}
 const active=currentAttachments(attachments).sort((a,b)=>a.id.localeCompare(b.id));
 if(!active.length&&!details.requirements.trim()&&!details.methodNotes.trim())throw Error('MATERIALS_REQUIRED');
 if(active.reduce((sum,a)=>sum+a.size_bytes,0)>MAX_ASSISTANT_BYTES)throw Error('MATERIALS_TOO_BIG');
 const files=[];
 for(const a of active){
  const bytes=await loadRequestFile(a.storage_path,a.size_bytes,a.file_hash);
  if(!(bytes instanceof Uint8Array)||bytes.length!==a.size_bytes||await digest(bytes)!==a.file_hash)throw Error('DAMAGED_ATTACHMENT');
  files.push({id:a.id,name:a.file_name,type:a.content_type,size:a.size_bytes,hash:a.file_hash,bytes});
 }
 const manifest={schema:1,requestId:request.id,revision:request.revision,provider,details,files:files.map(({bytes,...f})=>f)};
 return {...manifest,fingerprint:await digest(new TextEncoder().encode(JSON.stringify(manifest))),files};
}
