const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
const types=new Set(['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']);
const categories=new Set(['assignment','methodology','data','sources']);
const base64=/^[A-Za-z0-9+/]*={0,2}$/;
const cleanName=value=>String(value||'').replace(/[\\/\u0000-\u001f]/g,'_').trim().slice(0,180);
const denied={status:404,data:{error:'Заявка не найдена'}};

async function access(id,user,{db,config}){
 if(!uuid.test(String(id||'')))return null;
 const rows=await db('studkab_requests?id=eq.'+id+'&select=id,student_id');
 if(!rows?.length)return null;
 if(rows[0].student_id===user.id)return {row:rows[0],executor:false};
 const cfg=await config();
 if(user.email?.toLowerCase()===cfg?.executor_email?.toLowerCase())return {row:rows[0],executor:true};
 return null;
}

export async function attachmentAction(input,user,deps){
 const permit=await access(input.id,user,deps);if(!permit)return denied;
 if(input.action==='attachment-list'){
  const rows=await deps.db('studkab_request_attachments?request_id=eq.'+input.id+'&select=id,category,file_name,content_type,size_bytes,file_hash,created_at&order=created_at.asc');
  return {status:200,data:{attachments:rows}};
 }
 if(input.action==='attachment-context'){
  if(!permit.executor)return {status:403,data:{error:'Материалы доступны исполнителю'}};
  const rows=await deps.db('studkab_request_attachments?request_id=eq.'+input.id+'&select=id,category,file_name,size_bytes,file_hash,extracted_text,created_at&order=created_at.asc');
  return {status:200,data:{attachments:rows}};
 }
 if(input.action==='attachment-download'){
  if(!uuid.test(String(input.attachmentId||'')))return {status:400,data:{error:'Неверный файл'}};
  const rows=await deps.db('studkab_request_attachments?id=eq.'+input.attachmentId+'&request_id=eq.'+input.id+'&select=storage_path,file_name');
  if(!rows?.length)return {status:404,data:{error:'Файл не найден'}};
  return {status:200,data:await deps.download(rows[0].storage_path,rows[0].file_name)};
 }
 if(input.action!=='attachment-upload'||permit.executor)return {status:403,data:{error:'Файлы добавляет автор заявки'}};
 const name=cleanName(input.fileName),type=String(input.contentType||''),category=String(input.category||'');
 const size=input.sizeBytes,fileHash=String(input.fileHash||'');
 const encoded=String(input.base64||'');
 if(!name||!types.has(type)||!categories.has(category)||!Number.isSafeInteger(size)||size<1||size>5242880||!hash.test(fileHash)||encoded.length!==4*Math.ceil(size/3)||!base64.test(encoded))
  return {status:400,data:{error:'Проверьте файл, его тип и размер'}};
 const current=await deps.db('studkab_request_attachments?request_id=eq.'+input.id+'&select=id,file_hash');
 if(current.some(x=>x.file_hash===fileHash))return {status:409,data:{error:'Этот файл уже приложен'}};
 if(current.length>=8)return {status:429,data:{error:'К одной заявке можно приложить не более 8 файлов'}};
 const attachmentId=crypto.randomUUID();
 const path=user.id+'/'+input.id+'/'+attachmentId;
 const extractedText=await deps.upload(path,type,encoded,size,fileHash);
 if(typeof extractedText!=='string'||!extractedText.trim()||extractedText.length>500000)throw Error('Extraction unavailable');
 let row;try{[row]=await deps.db('studkab_request_attachments','POST',{id:attachmentId,request_id:input.id,student_id:user.id,category,file_name:name,content_type:type,size_bytes:size,file_hash:fileHash,storage_path:path,extracted_text:extractedText});}
 catch(error){await deps.remove(path).catch(()=>{});throw error;}
 return {status:200,data:{attachment:{id:row.id,category:row.category,file_name:row.file_name,size_bytes:row.size_bytes,file_hash:row.file_hash}}};
}
