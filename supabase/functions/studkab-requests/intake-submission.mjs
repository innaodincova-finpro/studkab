const required={t:'тему',k:'вид работы',n:'ФИО студента',u:'вуз',d:'дисциплину',dl:'срок',cn:'контакт'};
const limits={t:300,k:100,d:200,u:300,fc:300,kf:300,ct:100,n:200,g:100,pr:200,fo:100,co:50,s:200,dl:10,rq:500,org:1500,mn:1500,cn:200};
export async function intakeSubmission(input,user,{db,transferIntake,validatePayload}){
 const contact=user.email||''; // Verified app-account email, never a guessed contact.
 const args={p_student:user.id,p_draft:input.id,p_contact:contact};
 const src=await db('rpc/studkab_intake_submission_snapshot','POST',args);
 if(src.missing)return {status:404,data:{error:'Черновик не найден'}};
 if(src.gone)return {status:410,data:{error:'Переданная заявка удалена исполнителем. Повторно она не создаётся'}};
 if(src.submitted)return {data:{submission:src}};
 if(src.unconfirmed)return {status:409,data:{error:'Подтвердите актуальные сведения перед отправкой'}};
 const missing=Object.keys(required).filter(k=>!String(src.payload[k]||'').trim());
 const oversized=Object.keys(limits).filter(k=>src.payload[k].length>limits[k]);
 const assignment=(src.analysis.roles||[]).some(r=>r.role==='assignment'&&r.refs.some(ref=>src.files.some(f=>f.id===ref.fileId)));
 let payload,error;
 try{payload=validatePayload(src.payload,{newSubmission:true});}catch(e){error=e.message;}
 if(!assignment&&src.payload.rq.trim().length<15)error='В комплекте не найдено задание. Добавьте документ с заданием; сохранённые материалы останутся в кабинете';
 const state={state:'confirmed',analysisId:src.confirmation.analysisId,revision:src.confirmation.revision,files:src.files.length,contact,missing,oversized,...(error?{error}:{}),canSubmit:!error};
 if(input.action==='intake-submission-state')return {data:{submission:state}};
 if(input.analysisId!==state.analysisId||input.revision!==state.revision)return {status:409,data:{error:'Карточка изменилась. Проверьте и подтвердите актуальные сведения'}};
 if(error)return {status:409,data:{error,submission:state}};
 if(typeof transferIntake!=='function')throw Error('Transfer unavailable');
 // Bounded serial copies. Stable paths and verified collision handling make a
 // lost storage response safe. Never remove private originals on partial failure.
 for(const f of src.files)await transferIntake(f);
 const r=await db('rpc/studkab_intake_submit','POST',{p_student:user.id,p_draft:input.id,p_analysis:state.analysisId,p_revision:state.revision,p_contact:contact,p_content:payload});
 if(r.missing)return {status:404,data:{error:'Черновик не найден'}};
 if(r.gone)return {status:410,data:{error:'Переданная заявка удалена исполнителем'}};
 if(r.limited)return {status:429,data:{error:'Достигнут дневной лимит заявок. Материалы сохранены; попробуйте завтра'}};
 if(r.conflict||r.unconfirmed)return {status:409,data:{error:'Материалы или ответы изменились во время отправки. Откройте актуальную карточку; комплект сохранён'}};
 if(r.invalid||r.incomplete)return {status:409,data:{error:'Проверьте обязательные сведения перед отправкой'}};
 if(!r.submitted||!r.ready&&!r.duplicate)throw Error('Submission not confirmed');
 return {data:{submission:r}};
}
