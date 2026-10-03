// KIT-03: замена файла в принятой заявке. Байты сохраняются в то же закрытое хранилище,
// что и при первичной загрузке; новая редакция файла встаёт вместо прежней, прежняя
// остаётся в истории. Чтение и новый разбор комплекта запускает сервер.
import {intakeBytes} from './intake.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failure(r){
 if(r?.missing)return {status:404,data:{error:'Файл или заявка не найдены. Откройте материалы заново'}};
 if(r?.locked)return {status:409,data:{error:r.reason||'Изменения материалов закрыты'}};
 if(r?.conflict)return {status:409,data:{error:'Этот файл уже заменён или такой файл уже есть в заявке. Откройте материалы заново'}};
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
