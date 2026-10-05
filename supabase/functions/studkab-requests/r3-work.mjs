// ROUTE-03, R3-C: работа исполнителя по заявке, поданной по форме.
// Исполнитель: «Взять в работу», прикрепить готовый файл, «Передать студенту».
// Студент: видит этап и скачивает переданный файл. Рабочий файл студенту не виден до передачи.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashRe=/^[a-f0-9]{64}$/;
export const R3_RESULT_TYPES={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
export const R3_ACTIONS=['r3-state','r3-take','r3-result-upload','r3-result-download','r3-deliver','r3-download'];
async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function resultBytes(input){
 const name=typeof input.fileName==='string'?input.fileName.replace(/[\\/\u0000-\u001f]/g,'_').trim():'';
 const type=R3_RESULT_TYPES[name.toLowerCase().split('.').at(-1)],size=input.sizeBytes,encoded=input.base64;
 if(!name||name.length>180||!type||input.contentType!==type||!Number.isSafeInteger(size)||size<1||size>5242880||
  !hashRe.test(String(input.fileHash||''))||typeof encoded!=='string'||encoded.length!==4*Math.ceil(size/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
  throw Error('Прикрепите файл Word, PDF или Excel до 5 МБ');
 let raw;try{raw=atob(encoded);}catch{throw Error('Не удалось прочитать файл');}
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(bytes.length!==size||await sha256(bytes)!==input.fileHash)throw Error('Файл передан не полностью. Повторите');
 const ok=type==='application/pdf'?new TextDecoder().decode(bytes.slice(0,5))==='%PDF-':bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4;
 if(!ok)throw Error('Содержимое не соответствует формату файла');
 return {name,type,size,hash:input.fileHash,bytes};
}
function view(w,executor){
 if(!w)return {takenAt:null,result:null,delivered:null,downloadedAt:null};
 return {takenAt:w.taken_at,
  result:executor&&w.result_path?{name:w.result_name,size:w.result_size,at:w.result_at,hash:w.result_hash}:null,
  delivered:w.delivered_at?{name:w.delivered_name,size:w.delivered_size,at:w.delivered_at,...(executor?{hash:w.delivered_hash}:{})}:null,
  downloadedAt:w.downloaded_at};
}
export async function r3WorkAction(input,user,{db,config,download,saveResult}){
 if(!uuid.test(String(input.id||'')))return {status:400,data:{error:'Неверная заявка'}};
 const cfg=await config(),executor=!!cfg?.executor_email&&(user.email||'').toLowerCase()===cfg.executor_email.toLowerCase();
 const [request]=await db('studkab_requests?select=id,student_id,ready_at,payload&deleting_at=is.null&id=eq.'+input.id+'&limit=1');
 if(!request||!request.ready_at||request.payload?.route!=='r3'||(!executor&&request.student_id!==user.id))return {status:404,data:{error:'Заявка не найдена'}};
 const work=async()=>(await db('studkab_r3_work?request_id=eq.'+input.id+'&limit=1'))[0]||null;
 if(input.action==='r3-state')return {data:{work:view(await work(),executor)}};
 if(input.action==='r3-download'){
  const w=await work();if(!w?.delivered_path)return {status:404,data:{error:'Работа ещё не передана'}};
  const link=await download(w.delivered_path,w.delivered_name);
  if(!executor)await db('rpc/studkab_r3_downloaded','POST',{p_request:input.id,p_student:user.id});
  return {data:link};
 }
 if(!executor)return {status:403,data:{error:'Доступно исполнителю'}};
 if(input.action==='r3-take'){const r=await db('rpc/studkab_r3_take','POST',{p_request:input.id});if(r.missing)return {status:404,data:{error:'Заявка не найдена'}};return {data:{work:view(await work(),true)}};}
 if(input.action==='r3-result-download'){const w=await work();if(!w?.result_path)return {status:404,data:{error:'Файл не прикреплён'}};return {data:await download(w.result_path,w.result_name)};}
 if(input.action==='r3-result-upload'){
  let f;try{f=await resultBytes(input);}catch(e){return {status:400,data:{error:e.message}};}
  const w=await work();if(!w?.taken_at)return {status:409,data:{error:'Сначала нажмите «Взять в работу»'}};
  const path='r3-results/'+input.id+'/'+f.hash;
  await saveResult(path,f.type,f.bytes,f.hash);
  const r=await db('rpc/studkab_r3_result_set','POST',{p_request:input.id,p_name:f.name,p_type:f.type,p_size:f.size,p_hash:f.hash,p_path:path});
  if(r.missing)return {status:404,data:{error:'Заявка не найдена'}};if(r.not_taken)return {status:409,data:{error:'Сначала нажмите «Взять в работу»'}};if(r.invalid)throw Error('Result path mismatch');
  return {data:{work:view(await work(),true)}};
 }
 if(input.action==='r3-deliver'){
  if(!hashRe.test(String(input.fileHash||'')))return {status:400,data:{error:'Неверный файл'}};
  const r=await db('rpc/studkab_r3_deliver','POST',{p_request:input.id,p_hash:input.fileHash});
  if(r.missing)return {status:404,data:{error:'Заявка не найдена'}};
  if(r.not_taken)return {status:409,data:{error:'Сначала нажмите «Взять в работу»'}};
  if(r.no_result)return {status:409,data:{error:'Сначала прикрепите готовую работу'}};
  if(r.changed)return {status:409,data:{error:'Файл заменили в другом окне. Откройте заявку заново'}};
  return {data:{work:view(await work(),true),duplicate:!!r.duplicate}};
 }
 return {status:400,data:{error:'Неизвестное действие'}};
}
