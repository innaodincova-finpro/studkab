// KIT-03: замена файла в принятой заявке. Байты сохраняются в то же закрытое хранилище,
// что и при первичной загрузке; новая редакция файла встаёт вместо прежней, прежняя
// остаётся в истории. Чтение и новый разбор комплекта запускает сервер.
import {intakeBytes} from './intake.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failure(r){
 if(r?.missing)return {status:404,data:{error:'Файл или заявка не найдены. Откройте материалы заново'}};
 if(r?.locked)return {status:409,data:{error:r.reason||'Изменения материалов закрыты'}};
 // UX-01: причина отказа называется точно, без общего «уже заменён или уже есть».
 if(r?.same)return {status:409,data:{error:'Этот файл уже загружен в заявку и стоит на этом месте. Замена не нужна',same:true}};
 if(r?.conflict&&r.kind==='duplicate')return {status:409,data:{error:'Такой же файл уже есть в заявке на другом месте. Выберите другой файл'}};
 if(r?.conflict)return {status:409,data:{error:'Этот файл уже заменён новой редакцией. Закройте окно и откройте материалы заново'}};
 if(r?.limit)return {status:409,data:{error:'В заявке уже 8 файлов. Замените один из них новой редакцией'}};
 if(r?.quota)return {status:429,data:{error:'Достигнут предел 100 МБ с учётом прежних редакций'}};
 if(r?.invalid)return {status:400,data:{error:'Проверьте файл: DOCX, PDF или XLSX, до 5 МБ'}};
 return null;
}
export async function registeredReplaceAction(input,user,{db,isMember,saveIntake}){
 if(typeof isMember!=='function'||await isMember(user.id)!==true)return {status:403,data:{error:'Нет доступа'}};
 if(!uuid.test(input.id||'')||!uuid.test(input.attachmentId||''))return {status:400,data:{error:'Неверная заявка или файл'}};
 let f;try{f=await intakeBytes(input);}catch(e){return {status:400,data:{error:e.message}};}
 const reserved=await db('rpc/studkab_registered_replace_reserve','POST',{p_student:user.id,p_request:input.id,p_attachment:input.attachmentId,p_name:f.name,p_type:f.type,p_size:f.size,p_hash:f.hash});
 const error=failure(reserved);if(error)return error;
 const file=reserved.file;
 if(!uuid.test(file?.id||'')||file.file_hash!==f.hash||!file.storage_path?.startsWith(user.id+'/')||!file.storage_path.endsWith('/'+file.id))throw Error('Replace unavailable');
 // Повтор после потерянного ответа: байты уже сохранены, повторно не пишутся.
 if(file.state!=='saved')await saveIntake(file.storage_path,f.type,f.bytes,f.hash);
 const finished=await db('rpc/studkab_registered_replace_finish','POST',{p_student:user.id,p_request:input.id,p_file:file.id,p_hash:f.hash});
 return failure(finished)||{data:{attachment:finished.attachment,duplicate:finished.duplicate===true}};
}

// UX-02a: новый файл к принятой заявке — например, недостающие данные в ответ на вопрос
// исполнителя. Те же проверки и то же хранилище, что при замене; прежние файлы не меняются.
export async function registeredAddAction(input,user,{db,isMember,saveIntake}){
 if(typeof isMember!=='function'||await isMember(user.id)!==true)return {status:403,data:{error:'Нет доступа'}};
 if(!uuid.test(input.id||''))return {status:400,data:{error:'Неверная заявка'}};
 let f;try{f=await intakeBytes(input);}catch(e){return {status:400,data:{error:e.message}};}
 const reserved=await db('rpc/studkab_registered_add_reserve','POST',{p_student:user.id,p_request:input.id,p_name:f.name,p_type:f.type,p_size:f.size,p_hash:f.hash});
 if(reserved?.conflict)return {status:409,data:{error:reserved.kind==='replaced'?'Это прежняя редакция файла, она уже заменена. Выберите нужный файл':'Такой файл уже есть в заявке'}};
 const error=failure(reserved);if(error)return error;
 const file=reserved.file;
 if(!uuid.test(file?.id||'')||file.file_hash!==f.hash||file.supersedes||!file.storage_path?.startsWith(user.id+'/')||!file.storage_path.endsWith('/'+file.id))throw Error('Add unavailable');
 if(reserved.duplicate===true)return {data:{attachment:{id:file.id,file_name:file.file_name,file_hash:file.file_hash,supersedes:null},duplicate:true}};
 if(file.state!=='saved')await saveIntake(file.storage_path,f.type,f.bytes,f.hash);
 const finished=await db('rpc/studkab_registered_add_finish','POST',{p_student:user.id,p_request:input.id,p_file:file.id,p_hash:f.hash});
 return failure(finished)||{data:{attachment:finished.attachment,duplicate:finished.duplicate===true}};
}
