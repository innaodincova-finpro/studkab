// «Передать Claude»: материалы заявки копируются в базу для Claude; готовый файл Claude прикрепляется
// к заявке как готовая работа при открытии заявки в реестре. Студенту файл уходит только после
// «Передать студенту». Только исполнитель, только заявки по форме (ROUTE-03).
import {resultBytes} from './r3-work.mjs';
export const CLAUDE_ACTIONS=['claude-queue','claude-state'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
function view(j,files){
 if(!j)return null;
 return {queuedAt:j.queued_at,startedAt:j.started_at,readyAt:j.result_ready_at,attachedAt:j.attached_at,error:j.error||null,files};
}
export async function claudeAction(input,user,{db,config,loadRequestFile,saveResult}){
 if(!uuid.test(String(input.id||'')))return {status:400,data:{error:'Неверная заявка'}};
 const cfg=await config(),executor=!!cfg?.executor_email&&(user.email||'').toLowerCase()===cfg.executor_email.toLowerCase();
 if(!executor)return {status:403,data:{error:'Доступно исполнителю'}};
 const [request]=await db('studkab_requests?select=id,number,ready_at,payload&deleting_at=is.null&id=eq.'+input.id+'&limit=1');
 if(!request||!request.ready_at||request.payload?.route!=='r3')return {status:404,data:{error:'Заявка не найдена'}};
 const job=async()=>(await db('studkab_claude_jobs?request_id=eq.'+input.id+'&limit=1'))[0]||null;
 const count=async()=>(await db('studkab_claude_files?select=attachment_id&request_id=eq.'+input.id)).length;
 if(input.action==='claude-queue'){
  const note=typeof input.note==='string'?input.note.trim().slice(0,2000):'';
  const q=await db('rpc/studkab_claude_queue','POST',{p_request:input.id,p_note:note});
  if(q.missing)return {status:404,data:{error:'Заявка не найдена'}};
  // Текущие материалы: без файлов, заменённых студентом.
  const all=await db('studkab_request_attachments?select=id,file_name,content_type,size_bytes,file_hash,storage_path,supersedes&request_id=eq.'+input.id+'&order=created_at.asc&limit=200');
  const replaced=new Set(all.map(a=>a.supersedes).filter(Boolean));
  const current=all.filter(a=>!replaced.has(a.id));
  for(const a of current){
   const bytes=await loadRequestFile(a.storage_path,a.size_bytes,a.file_hash);
   const r=await db('rpc/studkab_claude_file_put','POST',{p_request:input.id,p_attachment:a.id,p_name:a.file_name,p_type:a.content_type,p_size:a.size_bytes,p_hash:a.file_hash,p_b64:toBase64(bytes)});
   if(!r?.ok)throw Error('Claude copy failed');
  }
  return {data:{claude:view(await job(),current.length)}};
 }
 // claude-state: если Claude положил готовый файл — прикрепить его как готовую работу.
 let j=await job();
 if(j&&j.result_ready_at&&!j.attached_at){
  const [res]=await db('studkab_claude_results?request_id=eq.'+input.id+'&limit=1');
  try{
   if(!res)throw Error('Файл Claude не найден');
   const f=await resultBytes({fileName:res.name,contentType:res.type,sizeBytes:res.size,fileHash:res.hash,base64:res.content_b64});
   const path='r3-results/'+input.id+'/'+f.hash;
   await saveResult(path,f.type,f.bytes,f.hash);
   const set=await db('rpc/studkab_r3_result_set','POST',{p_request:input.id,p_name:f.name,p_type:f.type,p_size:f.size,p_hash:f.hash,p_path:path});
   if(set.missing||set.not_taken||set.invalid)throw Error('Не удалось прикрепить работу');
   await db('rpc/studkab_claude_attached','POST',{p_request:input.id});
  }catch(e){
   await db('studkab_claude_jobs?request_id=eq.'+input.id,'PATCH',{error:String(e?.message||'Не удалось прикрепить работу').slice(0,500)});
  }
  j=await job();
 }
 return {data:{claude:view(j,j?await count():0)}};
}
