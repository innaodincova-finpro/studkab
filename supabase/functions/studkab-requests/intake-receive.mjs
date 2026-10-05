import {checkCloudLink} from './cloud-link.mjs';
// ROUTE-03, R3-A/R3-B: заявка по форме. Программа не читает и не толкует файлы:
// сведения для титульного листа берутся только из формы студента.
// Материалы — сохранённые файлы любого допустимого вида и/или ссылка на папку в облаке.
export const R3_FIELDS={k:100,d:200,u:300,kf:300,pr:200,fo:100,g:100,n:200,s:200};
export const R3_REQUIRED=['k','d','u','fo','g','n'];
export const R3_LINK=/^https:\/\/(disk\.yandex\.(ru|com|by|kz)|yadi\.sk|disk\.360\.yandex\.ru|drive\.google\.com|docs\.google\.com|cloud\.mail\.ru)\/[^\s<>"]+$/;
export function r3Details(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return {error:'Заполните сведения для титульного листа'};
 const out={};
 for(const [k,v] of Object.entries(value)){
  if(!Object.hasOwn(R3_FIELDS,k)||typeof v!=='string')return {error:'Проверьте сведения для титульного листа'};
  if(v.length>R3_FIELDS[k])return {error:'Слишком длинное значение в сведениях для титульного листа'};
  out[k]=v.trim();
 }
 if(R3_REQUIRED.some(k=>!out[k]))return {error:'Заполните обязательные сведения: вид работы, дисциплина, вуз, форма обучения, курс и группа, фамилия, имя, отчество'};
 return {details:out};
}
export async function intakeReceive(input,user,{db,transferIntake,fetchCloud=globalThis.fetch}){
 const src=await db('rpc/studkab_intake_receive_snapshot','POST',{p_student:user.id,p_draft:input.id});
 if(src.missing)return {status:404,data:{error:'Черновик не найден'}};
 if(src.gone)return {status:410,data:{error:'Заявка удалена или передана другому аккаунту. Повторно она не создаётся'}};
 if(src.submitted)return {data:{submission:src}};
 const allSaved=src.files.every(f=>f.state==='saved');
 const state={state:'saved',revision:src.revision,files:src.files.length,canReceive:allSaved};
 if(input.action==='intake-receive-state')return {data:{submission:state}};
 if(!Number.isSafeInteger(input.revision)||input.revision!==src.revision)return {status:409,data:{error:'Комплект изменился. Обновите сохранённые материалы'}};
 if(!allSaved)return {status:409,data:{error:'Сначала завершите сохранение всех выбранных файлов'}};
 const deadline=input.deadline,description=input.description??'',contact=user.email||'',link=typeof input.link==='string'?input.link.trim():input.link??'';
 if(typeof deadline!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||Number.isNaN(Date.parse(deadline))||new Date(deadline).toISOString().slice(0,10)!==deadline)
  return {status:400,data:{error:'Укажите, когда нужна работа'}};
 if(typeof description!=='string'||description.length>500)return {status:400,data:{error:'Пожелания — до 500 символов'}};
 if(typeof link!=='string'||link.length>500||(link&&!R3_LINK.test(link)))return {status:400,data:{error:'Ссылка должна начинаться с https:// и вести на Яндекс Диск, Google Диск или Облако Mail.ru'}};
 if(!src.files.length&&!link)return {status:400,data:{error:'Приложите файлы задания или ссылку на папку в облаке'}};
 const checked=r3Details(input.details);if(checked.error)return {status:400,data:{error:checked.error}};
 // R3-B: закрытая или удалённая папка не принимается; если облако не ответило, исполнитель проверит ссылку сам.
 if(link){const state=(await checkCloudLink(link,{fetcher:fetchCloud})).state;
  if(state==='closed')return {status:400,data:{error:'Ссылка закрыта. Откройте доступ «всем, у кого есть ссылка» и отправьте снова'}};
  if(state==='missing')return {status:400,data:{error:'Папка по ссылке не найдена. Проверьте ссылку'}};}
 if(!contact.trim()||contact.length>200)return {status:400,data:{error:'Нужна подтверждённая почта аккаунта'}};
 if(typeof transferIntake!=='function')throw Error('Transfer unavailable');
 // Проверенные файлы копируются до публикации. При частичном сбое оригиналы сохраняются.
 for(const file of src.files)await transferIntake(file);
 const result=await db('rpc/studkab_intake_receive_form','POST',{p_student:user.id,p_draft:input.id,p_revision:src.revision,p_deadline:deadline,p_description:description,p_contact:contact,p_details:checked.details,p_link:link});
 if(result.missing)return {status:404,data:{error:'Черновик не найден'}};
 if(result.gone)return {status:410,data:{error:'Заявка недоступна прежнему аккаунту'}};
 if(result.limited)return {status:429,data:{error:'Достигнут дневной лимит заявок. Материалы сохранены'}};
 if(result.conflict||result.incomplete)return {status:409,data:{error:'Комплект изменился во время отправки. Сохранённые файлы доступны'}};
 if(result.invalid)return {status:400,data:{error:'Проверьте срок, ссылку и сведения для титульного листа'}};
 if(!result.submitted||!result.ready&&!result.duplicate)throw Error('Receipt not confirmed');
 return {data:{submission:result}};
}
