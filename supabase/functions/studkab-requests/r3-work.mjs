// ROUTE-03, R3-C: работа исполнителя по заявке, поданной по форме.
// Исполнитель: «Взять в работу», прикрепить готовый файл, «Передать студенту».
// Студент: видит этап и скачивает переданный файл. Рабочий файл студенту не виден до передачи.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashRe=/^[a-f0-9]{64}$/;
export const R3_RESULT_TYPES={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
export const R3_ACTIONS=['r3-state','r3-take','r3-result-upload','r3-result-download','r3-deliver','r3-download',
 // R3-D: «Я сдал работу», «Вернули на доработку».
 'r3-hand','r3-return-upload','r3-return-file-remove','r3-return','r3-return-file-download'];
export const R3_UPLOADS=['r3-result-upload','r3-return-upload'];
export const R3_RETURN_TYPES={...R3_RESULT_TYPES,jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function resultBytes(input,types=R3_RESULT_TYPES){
 const name=typeof input.fileName==='string'?input.fileName.replace(/[\\/\u0000-\u001f]/g,'_').trim():'';
 const type=types[name.toLowerCase().split('.').at(-1)],size=input.sizeBytes,encoded=input.base64;
 if(!name||name.length>180||!type||input.contentType!==type||!Number.isSafeInteger(size)||size<1||size>5242880||
  !hashRe.test(String(input.fileHash||''))||typeof encoded!=='string'||encoded.length!==4*Math.ceil(size/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
  throw Error(types===R3_RESULT_TYPES?'Прикрепите файл Word, PDF или Excel до 5 МБ':'Приложите Word, PDF, Excel или фото до 5 МБ');
 let raw;try{raw=atob(encoded);}catch{throw Error('Не удалось прочитать файл');}
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(bytes.length!==size||await sha256(bytes)!==input.fileHash)throw Error('Файл передан не полностью. Повторите');
 const head=new TextDecoder('latin1').decode(bytes.slice(0,12));
 const ok=type==='application/pdf'?head.startsWith('%PDF-'):type==='image/jpeg'?bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff:
  type==='image/png'?bytes[0]===0x89&&head.slice(1,4)==='PNG':type==='image/webp'?head.startsWith('RIFF')&&head.slice(8,12)==='WEBP':
  bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4;
 if(!ok)throw Error('Содержимое не соответствует формату файла');
 return {name,type,size,hash:input.fileHash,bytes};
}
function view(w,executor,extra={}){
 if(!w)return {takenAt:null,result:null,delivered:null,downloadedAt:null,handedAt:null,returns:0,returnedAt:null,...extra};
 return {takenAt:w.taken_at,
  result:executor&&w.result_path?{name:w.result_name,size:w.result_size,at:w.result_at,hash:w.result_hash}:null,
  delivered:w.delivered_at?{name:w.delivered_name,size:w.delivered_size,at:w.delivered_at,...(executor?{hash:w.delivered_hash}:{})}:null,
  downloadedAt:w.downloaded_at,handedAt:w.handed_at||null,returns:w.returns||0,returnedAt:w.returned_at||null,...extra};
}
const fileView=f=>({id:f.id,name:f.name,size:f.size,type:f.type});
// История для карточки: переданные версии, возвраты с замечаниями и файлами, файлы в незаконченной форме.
async function history(db,id){
 const [versions,returns,files]=await Promise.all([
  db('studkab_r3_versions?select=n,name,size,delivered_at&request_id=eq.'+id+'&order=n.asc&limit=100'),
  db('studkab_r3_returns?select=n,comment,created_at&request_id=eq.'+id+'&order=n.asc&limit=50'),
  db('studkab_r3_return_files?select=id,return_n,name,size,type&request_id=eq.'+id+'&order=created_at.asc&limit=500')]);
 return {versions:versions.map(v=>({n:v.n,name:v.name,size:v.size,at:v.delivered_at})),
  returnList:returns.map(r=>({n:r.n,comment:r.comment,at:r.created_at,files:files.filter(f=>f.return_n===r.n).map(fileView)})),
  pendingFiles:files.filter(f=>f.return_n==null).map(fileView)};
}
export async function r3WorkAction(input,user,{db,config,download,saveResult,remove}){
 if(!uuid.test(String(input.id||'')))return {status:400,data:{error:'Неверная заявка'}};
 const cfg=await config(),executor=!!cfg?.executor_email&&(user.email||'').toLowerCase()===cfg.executor_email.toLowerCase();
 const [request]=await db('studkab_requests?select=id,student_id,ready_at,payload&deleting_at=is.null&id=eq.'+input.id+'&limit=1');
 if(!request||!request.ready_at||request.payload?.route!=='r3'||(!executor&&request.student_id!==user.id))return {status:404,data:{error:'Заявка не найдена'}};
 const work=async()=>(await db('studkab_r3_work?request_id=eq.'+input.id+'&limit=1'))[0]||null;
 const full=async(ex)=>view(await work(),ex,await history(db,input.id));
 if(input.action==='r3-state')return {data:{work:await full(executor)}};
 if(input.action==='r3-return-file-download'){
  if(!uuid.test(String(input.fileId||'')))return {status:400,data:{error:'Неверный файл'}};
  const [f]=await db('studkab_r3_return_files?select=name,path&request_id=eq.'+input.id+'&id=eq.'+input.fileId+'&limit=1');
  if(!f)return {status:404,data:{error:'Файл не найден'}};
  return {data:await download(f.path,f.name)};
 }
 // R3-D: действия студента по своей заявке.
 if(['r3-hand','r3-return-upload','r3-return-file-remove','r3-return'].includes(input.action)){
  if(request.student_id!==user.id)return {status:403,data:{error:'Доступно студенту'}};
  if(input.action==='r3-hand'){
   const r=await db('rpc/studkab_r3_hand','POST',{p_request:input.id,p_student:user.id});
   if(r.missing)return {status:409,data:{error:'Работа ещё не передана'}};if(r.returned)return {status:409,data:{error:'Работа возвращена на доработку. Дождитесь исправленной версии'}};
   return {data:{work:await full(false)}};
  }
  if(input.action==='r3-return-upload'){
   let f;try{f=await resultBytes(input,R3_RETURN_TYPES);}catch(e){return {status:400,data:{error:e.message}};}
   const w=await work();if(!w?.handed_at)return {status:409,data:{error:'Сначала нажмите «Я сдал работу»'}};
   const path='r3-returns/'+input.id+'/'+f.hash;
   await saveResult(path,f.type,f.bytes,f.hash);
   const r=await db('rpc/studkab_r3_return_file_add','POST',{p_request:input.id,p_student:user.id,p_name:f.name,p_type:f.type,p_size:f.size,p_hash:f.hash,p_path:path});
   if(r.not_handed)return {status:409,data:{error:'Сначала нажмите «Я сдал работу»'}};if(r.too_many)return {status:400,data:{error:'Можно приложить не больше 10 файлов'}};
   if(r.invalid)throw Error('Return path mismatch');
   return {data:{work:await full(false),fileId:r.id}};
  }
  if(input.action==='r3-return-file-remove'){
   if(!uuid.test(String(input.fileId||'')))return {status:400,data:{error:'Неверный файл'}};
   const r=await db('rpc/studkab_r3_return_file_remove','POST',{p_request:input.id,p_student:user.id,p_file:input.fileId});
   if(r.missing)return {status:404,data:{error:'Файл не найден'}};
   if(r.path&&remove)await remove(r.path);
   return {data:{work:await full(false)}};
  }
  const comment=typeof input.comment==='string'?input.comment.trim():'';
  if(comment.length<3||comment.length>2000)return {status:400,data:{error:'Напишите, что сказал преподаватель (от 3 до 2000 знаков)'}};
  const r=await db('rpc/studkab_r3_return','POST',{p_request:input.id,p_student:user.id,p_comment:comment});
  if(r.not_handed)return {status:409,data:{error:'Сначала нажмите «Я сдал работу»'}};if(r.too_many)return {status:409,data:{error:'Слишком много возвратов. Напишите исполнителю'}};
  if(r.invalid)return {status:400,data:{error:'Напишите, что сказал преподаватель'}};
  return {data:{work:await full(false),n:r.n}};
 }
 if(input.action==='r3-download'){
  const w=await work();if(!w?.delivered_path)return {status:404,data:{error:'Работа ещё не передана'}};
  const link=await download(w.delivered_path,w.delivered_name);
  if(!executor)await db('rpc/studkab_r3_downloaded','POST',{p_request:input.id,p_student:user.id});
  return {data:link};
 }
 if(!executor)return {status:403,data:{error:'Доступно исполнителю'}};
 if(input.action==='r3-take'){const r=await db('rpc/studkab_r3_take','POST',{p_request:input.id});if(r.missing)return {status:404,data:{error:'Заявка не найдена'}};return {data:{work:await full(true)}};}
 if(input.action==='r3-result-download'){const w=await work();if(!w?.result_path)return {status:404,data:{error:'Файл не прикреплён'}};return {data:await download(w.result_path,w.result_name)};}
 if(input.action==='r3-result-upload'){
  let f;try{f=await resultBytes(input);}catch(e){return {status:400,data:{error:e.message}};}
  const w=await work();if(!w?.taken_at)return {status:409,data:{error:'Сначала нажмите «Взять в работу»'}};
  const path='r3-results/'+input.id+'/'+f.hash;
  await saveResult(path,f.type,f.bytes,f.hash);
  const r=await db('rpc/studkab_r3_result_set','POST',{p_request:input.id,p_name:f.name,p_type:f.type,p_size:f.size,p_hash:f.hash,p_path:path});
  if(r.missing)return {status:404,data:{error:'Заявка не найдена'}};if(r.not_taken)return {status:409,data:{error:'Сначала нажмите «Взять в работу»'}};if(r.invalid)throw Error('Result path mismatch');
  return {data:{work:await full(true)}};
 }
 if(input.action==='r3-deliver'){
  if(!hashRe.test(String(input.fileHash||'')))return {status:400,data:{error:'Неверный файл'}};
  const r=await db('rpc/studkab_r3_deliver','POST',{p_request:input.id,p_hash:input.fileHash});
  if(r.missing)return {status:404,data:{error:'Заявка не найдена'}};
  if(r.not_taken)return {status:409,data:{error:'Сначала нажмите «Взять в работу»'}};
  if(r.no_result)return {status:409,data:{error:'Сначала прикрепите готовую работу'}};
  if(r.changed)return {status:409,data:{error:'Файл заменили в другом окне. Откройте заявку заново'}};
  return {data:{work:await full(true),duplicate:!!r.duplicate}};
 }
 return {status:400,data:{error:'Неизвестное действие'}};
}
