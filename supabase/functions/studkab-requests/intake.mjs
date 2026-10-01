import {intakeRead} from './intake-reading.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const formats={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const missing={status:404,data:{error:'Черновик не найден'}};
const safeFile=f=>({id:f.id,file_name:f.file_name,content_type:f.content_type,size_bytes:f.size_bytes,file_hash:f.file_hash,state:f.state,supersedes:f.supersedes,created_at:f.created_at,saved_at:f.saved_at,roles:f.roles||[],read_status:f.read_status||'idle',read_version:f.read_version||null,read_summary:f.read_result?{status:f.read_result.status,summary:f.read_result.summary||{},warnings:f.read_result.warnings}:f.read_version?{status:f.read_status,summary:f.read_summary||{},warnings:f.read_warnings||[]}:null});
function resultError(r){
 if(r?.missing)return missing;
 if(r?.conflict)return {status:409,data:{error:'Черновик изменился. Откройте материалы заново'}};
 if(r?.limited)return {status:429,data:{error:'В черновике можно сохранить до 8 файлов по 5 МБ'}};
 if(r?.quota)return {status:429,data:{error:'Черновик достиг 100 МБ с учётом прежних версий. Сохранённые материалы не удалены'}};
 if(r?.invalid)return {status:400,data:{error:'Проверьте сведения черновика'}};
 return null;
}
export async function intakeBytes(input){
 const name=typeof input.fileName==='string'?input.fileName.replace(/[\\/\u0000-\u001f]/g,'_').trim():'';
 const ext=name.toLowerCase().split('.').at(-1),type=formats[ext],size=input.sizeBytes,hash=input.fileHash,encoded=input.base64;
 if(!name||name.length>180||!type||input.contentType!==type||!Number.isSafeInteger(size)||size<1||size>5242880||
  typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)||typeof encoded!=='string'||encoded.length!==4*Math.ceil(size/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('Проверьте файл: DOCX, PDF или XLSX, до 5 МБ');
 let raw;try{raw=atob(encoded);}catch{throw Error('Не удалось прочитать выбранный файл');}
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(bytes.length!==size||actual!==hash)throw Error('Файл передан не полностью. Повторите загрузку');
 // Only a container signature here; semantic readability is checked in step 3.
 const signature=type==='application/pdf'?new TextDecoder().decode(bytes.slice(0,5))==='%PDF-':bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4;
 if(!signature)throw Error('Содержимое не соответствует формату файла');
 return {name,type,size,hash,bytes};
}
export async function intakeAction(input,user,{db,isMember,saveIntake,downloadIntake,loadIntake,readIntake}){
 if(typeof isMember!=='function'||await isMember(user.id)!==true)return {status:403,data:{error:'Загрузка доступна после входа по приглашению исполнителя'}};
 if(input.action==='intake-open'){
  const draft=await db('rpc/studkab_intake_open','POST',{p_student:user.id});
  if(draft?.denied)return {status:403,data:{error:'Нет доступа'}};
  if(!uuid.test(draft?.id))throw Error('Intake unavailable');
  const files=await db('studkab_intake_files?draft_id=eq.'+draft.id+'&order=created_at.asc,id.asc&select=id,file_name,content_type,size_bytes,file_hash,state,supersedes,created_at,saved_at,roles,read_status,read_version,read_summary:read_result->summary,read_warnings:read_result->warnings');
  return {data:{draft:{id:draft.id,state:draft.state,revision:draft.revision,notes:draft.notes},files:files.map(safeFile),limits:{files:8,bytes:5242880,historyBytes:104857600}}};
 }
 if(!uuid.test(input.id||''))return {status:400,data:{error:'Неверный черновик'}};
 const [draft]=await db('studkab_intake_drafts?id=eq.'+input.id+'&student_id=eq.'+user.id+'&state=eq.open&select=id,revision');
 if(!draft)return missing;
 if(input.action==='intake-notes'){
  if(typeof input.notes!=='string'||input.notes.length>5000||!Number.isSafeInteger(input.revision)||input.revision<1)return {status:400,data:{error:'Проверьте сведения черновика'}};
  const r=await db('rpc/studkab_intake_notes','POST',{p_student:user.id,p_draft:input.id,p_revision:input.revision,p_notes:input.notes});
  return resultError(r)||{data:{draft:{id:r.id,state:r.state,revision:r.revision,notes:r.notes}}};
 }
 if(input.action==='intake-read'){
  if(!uuid.test(input.fileId||''))return {status:400,data:{error:'Неверный файл'}};
  return intakeRead(input,user,{db,loadIntake,readIntake});
 }
 if(input.action==='intake-download'){
  if(!uuid.test(input.fileId||''))return {status:400,data:{error:'Неверный файл'}};
  const [file]=await db('studkab_intake_files?id=eq.'+input.fileId+'&draft_id=eq.'+input.id+'&state=eq.saved');
  if(!file)return {status:404,data:{error:'Файл не найден'}};
  return {data:await downloadIntake(file.storage_path,file.file_name)};
 }
 if(input.action!=='intake-upload')return {status:400,data:{error:'Неизвестное действие черновика'}};
 const supersedes=input.replacesId??null;
 if(supersedes!==null&&!uuid.test(supersedes))return {status:400,data:{error:'Неверная версия файла'}};
 let f;try{f=await intakeBytes(input);}catch(e){return {status:400,data:{error:e.message}};}
 const reserved=await db('rpc/studkab_intake_reserve','POST',{p_student:user.id,p_draft:input.id,p_name:f.name,p_type:f.type,p_size:f.size,p_hash:f.hash,p_supersedes:supersedes});
 const error=resultError(reserved);if(error)return error;
 const file=reserved.file;
 if(!uuid.test(file?.id)||file.file_hash!==f.hash||file.storage_path!==user.id+'/'+input.id+'/'+file.id)throw Error('Intake unavailable');
 if(file.state==='saved')return {data:{file:safeFile(file),duplicate:true}};
 await saveIntake(file.storage_path,f.type,f.bytes,f.hash);
 // A lost finish response is safe: the next upload reserves the same file/path.
 const finished=await db('rpc/studkab_intake_finish','POST',{p_student:user.id,p_draft:input.id,p_file:file.id,p_hash:f.hash});
 return resultError(finished)||{data:{file:safeFile(finished.file),duplicate:finished.duplicate}};
}
