// ROUTE-02-B: receive saved originals without semantic approval or paid calls.
export async function intakeReceive(input,user,{db,transferIntake}){
 const src=await db('rpc/studkab_intake_receive_snapshot','POST',{p_student:user.id,p_draft:input.id});
 if(src.missing)return {status:404,data:{error:'Черновик не найден'}};
 if(src.gone)return {status:410,data:{error:'Заявка удалена или передана другому аккаунту. Повторно она не создаётся'}};
 if(src.submitted)return {data:{submission:src}};
 const state={state:'saved',revision:src.revision,files:src.files.length,canReceive:src.canReceive===true};
 if(input.action==='intake-receive-state')return {data:{submission:state}};
 if(!Number.isSafeInteger(input.revision)||input.revision!==src.revision)return {status:409,data:{error:'Комплект изменился. Обновите сохранённые материалы'}};
 if(!state.canReceive)return {status:409,data:{error:'Сначала завершите сохранение всех выбранных документов'}};
 const deadline=input.deadline,description=input.description??'',contact=user.email||'';
 if(typeof deadline!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||Number.isNaN(Date.parse(deadline))||new Date(deadline).toISOString().slice(0,10)!==deadline)
  return {status:400,data:{error:'Укажите действительный срок'}};
 if(typeof description!=='string'||description.length>500)return {status:400,data:{error:'Описание результата — до 500 символов'}};
 if(!contact.trim()||contact.length>200)return {status:400,data:{error:'Нужна подтверждённая почта аккаунта'}};
 if(typeof transferIntake!=='function')throw Error('Transfer unavailable');
 // Verified bytes are copied before publication. Partial failures keep originals.
 for(const file of src.files)await transferIntake(file);
 const result=await db('rpc/studkab_intake_receive','POST',{p_student:user.id,p_draft:input.id,p_revision:src.revision,p_deadline:deadline,p_description:description,p_contact:contact});
 if(result.missing)return {status:404,data:{error:'Черновик не найден'}};
 if(result.gone)return {status:410,data:{error:'Заявка недоступна прежнему аккаунту'}};
 if(result.limited)return {status:429,data:{error:'Достигнут дневной лимит заявок. Материалы сохранены'}};
 if(result.conflict||result.incomplete)return {status:409,data:{error:'Комплект изменился во время отправки. Сохранённые документы доступны'}};
 if(result.invalid)return {status:400,data:{error:'Проверьте срок и описание результата'}};
 if(!result.submitted||!result.ready&&!result.duplicate)throw Error('Receipt not confirmed');
 return {data:{submission:result}};
}
