import {r3WorkAction,R3_ACTIONS,R3_UPLOADS} from './r3-work.mjs';
import {qualityAction,qualityError} from './quality-evidence.mjs';
import {testDeliveryAction} from './test-delivery.mjs';
import {registeredStudyAction} from './registered-study.mjs';
import {clarificationAction} from './clarifications.mjs';
import {materialRevisionAction} from './material-revision.mjs';
import {kindCorrectionAction} from './kind-correction.mjs';
import {sameSecret} from '../_shared/secret-equal.mjs';
import {emailConfigured} from './request-email.mjs';
import {resultAction} from './results.mjs';
import {requirementAction} from './requirements.mjs';
import {attachmentAction} from './attachments.mjs';
import {intakeAction} from './intake.mjs';
import {registeredReplaceAction,registeredAddAction} from './registered-replace.mjs';
const fields={id:100,t:300,k:100,d:200,u:300,fc:300,kf:300,ct:100,n:200,g:100,pr:200,fo:100,co:50,s:200,dl:10,rq:500,org:1500,mn:1500,cn:200};
const intakeFields={k:'вид работы',n:'ФИО студента',u:'вуз',d:'дисциплину',dl:'срок'};
export function validatePayload(p,{newSubmission=false,previous=null}={}) {
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Неверная заявка');
 const out={v:1};
 for(const [k,max] of Object.entries(fields)) {
  const v=p[k]??'';
  if(typeof v!=='string'||v.length>max)throw Error('Проверьте поля заявки');
  out[k]=v;
 }
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(out.id)||!out.t.trim()||!out.cn.trim())throw Error('Заполните тему и контакт для ответа');
 if(out.dl.trim()&&(!/^\d{4}-\d{2}-\d{2}$/.test(out.dl)||Number.isNaN(Date.parse(out.dl))||new Date(out.dl).toISOString().slice(0,10)!==out.dl))throw Error('Проверьте срок');
 const missing=Object.entries(intakeFields).filter(([key])=>!out[key].trim()&&(newSubmission||(previous&&typeof previous[key]==='string'&&previous[key].trim()))).map(([,label])=>label);
 if(missing.length)throw Error('Заполните перед отправкой: '+missing.join(', '));
 const f=p.fm??{};
 if(typeof f!=='object'||Array.isArray(f))throw Error('Проверьте оформление');
 out.fm={};
 for(const [k,min,max] of [['mt',0,100],['mr',0,100],['mb',0,100],['ml',0,100],['sz',8,24],['sp',1,3],['ind',0,5]]) {
  if(f[k]==null)continue;
  if(typeof f[k]!=='number'||!Number.isFinite(f[k])||f[k]<min||f[k]>max)throw Error('Проверьте оформление');
  out.fm[k]=f[k];
 }
 if(f.fn!=null){if(typeof f.fn!=='string'||f.fn.length>100)throw Error('Проверьте шрифт');out.fm.fn=f.fn;}
 return out;
}
const headers={'access-control-allow-origin':'https://innaodincova-finpro.github.io','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST,OPTIONS','content-type':'application/json','cache-control':'no-store'};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
export function handler({auth,config,db,send,sendEmail,emailSettings,invite,isMember,upload,download,remove,removeIntake,saveIntake,downloadIntake,loadIntake,readIntake,transferIntake,saveResult,fetchCloud=globalThis.fetch,now=()=>Date.now()}) {
 return async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return json({error:'Используйте POST'},405);
  try {
   const job=req.headers.get('x-job-key');
   if(job){
    const cfg=await config();
    if(!sameSecret(job,cfg?.cron_token))return json({error:'Нет доступа'},403);
    const rows=await db('rpc/claim_studkab_requests','POST',{});
    let sent=0,failed=0;
    for(const row of rows){
     try{
      await send(row);
      await db('studkab_requests?id=eq.'+row.id,'PATCH',{telegram_sent_at:new Date(now()).toISOString(),lease_until:null,last_error:null});sent++;
     }catch{
      failed++;
      await db('studkab_requests?id=eq.'+row.id,'PATCH',{lease_until:null,retry_at:new Date(now()+Math.min(3600000,60000*2**row.telegram_attempts)).toISOString(),last_error:'Telegram: отправка не подтверждена'});
     }
    }
    let email={configured:false,accepted:0,pending:0,unknown:0,failed:0};
    await db('rpc/reconcile_studkab_request_emails','POST',{});
    const settings=typeof emailSettings==='function'?emailSettings(cfg):null;
    if(emailConfigured(settings||{})){
     email.configured=true;
     const letters=await db('rpc/claim_studkab_request_emails','POST',{});
     for(const letter of letters){
      let outcome;
      try{outcome=await sendEmail(letter,settings);}catch{outcome={status:'unknown'};}
      const status=['accepted','pending','failed','unknown'].includes(outcome?.status)?outcome.status:'unknown';
      const confirmed=await db('rpc/finish_studkab_request_email','POST',{
       p_request:letter.request_id,p_lease:letter.lease_id,p_status:status,p_message_id:outcome?.messageId||null
      });
      if(confirmed!==true)throw Error('Email queue state changed');
      email[status]++;
     }
    }
    return json({sent,failed,email});
   }
   const bearer=req.headers.get('authorization');
   const user=bearer?.startsWith('Bearer ') ? await auth(bearer) : null;
   if(!user||!user.email_confirmed_at||user.is_anonymous)return json({error:'Сначала войдите в аккаунт приложения'},401);
   const raw=await req.text();if(raw.length>8500000)return json({error:'Заявка слишком большая'},413);
   let input;try{input=JSON.parse(raw);}catch{return json({error:'Неверный запрос'},400);}
   if(['intake-open','intake-notes','intake-upload','intake-download','intake-read','intake-analyze','intake-analysis-state','intake-confirmation-state','intake-confirmation-save','intake-submission-state','intake-submit','intake-receive-state','intake-receive','intake-link-check','intake-link-copy'].includes(input?.action)){
    if(input.action!=='intake-upload'&&raw.length>(input.action==='intake-confirmation-save'?300000:16000))return json({error:'Запрос слишком большой'},413);
    const r=await intakeAction(input,user,{db,isMember,saveIntake,downloadIntake,loadIntake,readIntake,transferIntake,validatePayload,fetchCloud});return json(r.data,r.status||200);
   }
   if(input.action==='registered-replace'){
    const r=await registeredReplaceAction(input,user,{db,isMember,saveIntake});return json(r.data,r.status||200);
   }
   if(input.action==='registered-add'){
    const r=await registeredAddAction(input,user,{db,isMember,saveIntake});return json(r.data,r.status||200);
   }
   if(input.action==='request-kind-correct'){
    const r=await kindCorrectionAction(input,user,{db,config});return json(r.data,r.status||200);
   }
   if(['quality-state','quality-scan','quality-save','quality-report'].includes(input.action)){
    const r=await qualityAction(input,user,{db,config});return json(r.data,r.status||200);
   }
   if(['deliver','result','prepare-result','review-result','auto-review-result','review-notes','result-review-state','result-review-history','rebind-result'].includes(input.action)){
    const r=await resultAction(input,user,{db,config});return json(r.data,r.status||200);
   }
   if(['registered-study-state','registered-question-decide','registered-material-classify','registered-private-message'].includes(input.action)){
    const r=await registeredStudyAction(input,user,{db,config});return json(r.data,r.status||200);
   }
   if(['clarification-list','clarification-unread','clarification-read','clarification-ask','clarification-answer'].includes(input.action)){
    const r=await clarificationAction(input,user,{db,config,isMember});return json(r.data,r.status||200);
   }
   if(['material-revision-state','material-revision-open','material-revision-complete'].includes(input.action)){
    const r=await materialRevisionAction(input,user,{db,config,isMember});return json(r.data,r.status||200);
   }
   if(['passport-get','passport-ensure','passport-save','passport-approve','passport-structure-audit'].includes(input.action)){
    const r=await requirementAction(input,user,{db,config});return json(r.data,r.status||200);
   }
   // ROUTE-03, R3-C: работа исполнителя и выдача результата по заявке, поданной по форме.
   if(R3_ACTIONS.includes(input.action)){
    if(!R3_UPLOADS.includes(input.action)&&raw.length>16000)return json({error:'Запрос слишком большой'},413);
    const r=await r3WorkAction(input,user,{db,config,download,saveResult,remove});return json(r.data,r.status||200);
   }
   if(['attachment-upload','attachment-list','attachment-context','attachment-download'].includes(input.action)){
    const r=await attachmentAction(input,user,{db,config,upload,download,remove});return json(r.data,r.status||200);
   }
   if(raw.length>16000)return json({error:'Заявка слишком большая'},413);
   if(input.action==='delete-request'){
    const cfg=await config();
    if(user.email.toLowerCase()!==cfg.executor_email.toLowerCase())return json({error:'Удаление доступно только исполнителю'},403);
    const id=typeof input.id==='string'&&/^[a-f0-9-]{36}$/.test(input.id)?input.id:null;
    const reason=typeof input.reason==='string'?input.reason.trim():'';
    if(!id||input.confirmId!==id||reason.length<10||reason.length>500)return json({error:'Не подтверждено удаление заявки'},400);
    const plan=await db('rpc/prepare_studkab_request_delete','POST',{p_request:id});
    if(plan.absent)return json({deleted:true,absent:true,id});
    for(const path of plan.paths||[])await remove(path);
    // Полное удаление: исходные файлы студента и оставшиеся без записей файлы этого студента.
    const leftovers=Array.isArray(plan.leftovers)?plan.leftovers:[];
    if((plan.intakePaths||[]).length||leftovers.some(l=>l.bucket==='studkab-intake-materials')){if(typeof removeIntake!=='function')throw Error('Intake storage cleanup unavailable');}
    for(const path of plan.intakePaths||[])await removeIntake(path);
    for(const l of leftovers)await (l.bucket==='studkab-intake-materials'?removeIntake:remove)(l.path);
    const result=await db('rpc/delete_studkab_request','POST',{p_request:id,p_actor:user.id,p_reason:reason});
    if(plan.student&&((plan.drafts||[]).length||leftovers.length))result.intake=await db('rpc/studkab_request_delete_intake','POST',{p_drafts:plan.drafts||[],p_student:plan.student,p_leftovers:leftovers});
    return json(result);
   }
   if(['test-delivery-state','test-deliver','test-result'].includes(input.action)){
    const r=await testDeliveryAction(input,user,{db,config});return json(r.data,r.status||200);
   }
   if(input.action==='student-progress'){
    if(typeof isMember!=='function'||await isMember(user.id)!==true)return json({error:'Нет доступа'},403);
    if(!/^[a-f0-9-]{36}$/i.test(String(input.id||'')))return json({error:'Неверная заявка'},400);
    const [row]=await db('studkab_requests?select=id,ready_at,payload&deleting_at=is.null&id=eq.'+input.id+'&student_id=eq.'+user.id+'&limit=1');
    if(!row)return json({error:'Заявка не найдена'},404);
    if(!row.ready_at)return json({stage:'awaiting_materials',openQuestions:0});
    // R3-C/R3-D: заявка по форме — этапы «Задание / Вопросы / В работе / Готово / Сдача».
    if(row.payload?.route==='r3'){
     const [questions,work]=await Promise.all([
      db('studkab_clarifications?select=id&request_id=eq.'+input.id+'&answered_at=is.null&limit=100'),
      db('studkab_r3_work?select=taken_at,delivered_name,delivered_size,delivered_at,downloaded_at,handed_at,returns,returned_at&request_id=eq.'+input.id+'&limit=1')]);
     const w=work[0],openQuestions=questions.length,returns=w?.returns||0;
     // Работа на доработке, пока после возврата не передана новая версия (передача очищает returned_at).
     const reworking=!!w?.returned_at;
     const current=!!w?.delivered_at&&!reworking;
     const stage=current?(w.handed_at?'r3_handed':'r3_ready'):openQuestions?'needs_answer':w?.taken_at?'r3_in_work':'r3_received';
     let lastReturn=null;
     if(reworking){
      const [ret]=await db('studkab_r3_returns?select=n,comment,created_at&request_id=eq.'+input.id+'&order=n.desc&limit=1');
      const files=ret?await db('studkab_r3_return_files?select=name&request_id=eq.'+input.id+'&return_n=eq.'+ret.n+'&order=created_at.asc&limit=10'):[];
      if(ret)lastReturn={n:ret.n,comment:ret.comment,at:ret.created_at,files:files.map(f=>f.name)};
     }
     return json({stage,openQuestions,route:'r3',returns,...(lastReturn?{lastReturn}:{}),
      ...(current?{result:{name:w.delivered_name,size:w.delivered_size,at:w.delivered_at,downloadedAt:w.downloaded_at,handedAt:w.handed_at}}:{})});
    }
    const [questions,passports,delivered]=await Promise.all([
     db('studkab_clarifications?select=id,answered_at&request_id=eq.'+input.id+'&answered_at=is.null&limit=100'),
     db('studkab_requirement_passports?select=status&request_id=eq.'+input.id+'&order=revision.desc&limit=1'),
     db('studkab_results?select=delivery_id&request_id=eq.'+input.id+'&order=created_at.desc,id.desc&limit=1')
    ]);
    const openQuestions=questions.length;
    const stage=delivered[0]?.delivery_id?'delivered':openQuestions?'needs_answer':passports[0]?.status==='approved'?'requirements_approved':passports.length?'requirements_review':'received';
    return json({stage,openQuestions});
   }
   if(input.action==='request-state'||input.action==='update-request'){
    if(typeof isMember!=='function'||await isMember(user.id)!==true)return json({error:'Нет доступа'},403);
    if(!/^[a-f0-9-]{36}$/i.test(String(input.id||'')))return json({error:'Неверная заявка'},400);
    const [row]=await db('studkab_requests?select=id,number,payload&deleting_at=is.null&id=eq.'+input.id+'&student_id=eq.'+user.id);
    if(!row)return json({error:'Заявка не найдена'},404);
    if(input.action==='request-state')return json({payload:row.payload});
    let payload;try{payload=validatePayload(input.payload,{previous:row.payload});}catch(e){return json({error:e.message},400);}
    if(!input.expectedPayload||typeof input.expectedPayload!=='object')return json({error:'Откройте заявку заново'},400);
    const result=await db('rpc/update_studkab_request','POST',{p_request:input.id,p_student:user.id,p_expected:input.expectedPayload,p_content:payload});
    if(result.missing)return json({error:'Заявка не найдена'},404);
    if(result.conflict)return json({error:'Заявка изменена в другом окне. Откройте её заново'},409);
    if(result.locked)return json({error:'Подготовка уже началась. Согласуйте изменения с исполнителем'},409);
    return json({...result,saved:true});
   }
   if(input.action==='submit'){
    // C-054: заявку подаёт только студент, которому исполнитель выдал доступ.
    if(typeof isMember!=='function'||(await isMember(user.id))!==true)return json({error:'Подача заявок открывается после приглашения исполнителя. Попросите у исполнителя приглашение.'},403);
    if(input.materialsFlow!==2)return json({error:'Обновите кабинет перед отправкой заявки с материалами'},409);
    let payload;try{payload=validatePayload(input.payload,{newSubmission:true});}catch(e){return json({error:e.message},400);}
    const result=await db('rpc/submit_studkab_request','POST',{student:user.id,content:payload});
    if(result.conflict)return json({error:'Эта заявка уже передана. Для изменения условий свяжитесь с исполнителем.'},409);
    if(result.limited)return json({error:'Достигнут дневной лимит заявок. Попробуйте завтра.'},429);
    return json({...result,saved:true,telegram:'awaiting_materials',email:'awaiting_materials'});
   }
   if(input.action==='request-publish'){
    if(typeof isMember!=='function'||await isMember(user.id)!==true)return json({error:'Нет доступа'},403);
    if(!/^[a-f0-9-]{36}$/i.test(String(input.id||'')))return json({error:'Неверная заявка'},400);
    const result=await db('rpc/studkab_request_publish','POST',{p_request:input.id,p_student:user.id});
    if(result.missing)return json({error:'Заявка не найдена'},404);
    if(result.incomplete)return json({error:'Приложите задание либо опишите задачу и недостающие сведения (от 15 знаков)'},409);
    const cfg=typeof emailSettings==='function'?await config():null;
    return json({...result,telegram:'queued',email:emailConfigured(typeof emailSettings==='function'?emailSettings(cfg):{})?'queued':'not_configured'});
   }
   if(input.action==='invite'||input.action==='recover'){
    if(input.action==='recover'&&input.identityVerified!==true)return json({error:'Сначала подтвердите личность получателя'},400);
    const cfg=await config();
    if(user.email.toLowerCase()!==cfg.executor_email.toLowerCase())return json({error:'Приглашения доступны только исполнителю'},403);
    const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
    if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Проверьте адрес почты'},400);
    const link=await invite(email,input.action==='recover');
    const {userId,...answer}=link||{};
    // C-054: приглашение выдаёт допуск к кабинету; восстановление допуск не меняет.
    if(input.action==='invite'&&userId&&(answer.url||answer.existing)){
     if(!/^[0-9a-f-]{36}$/i.test(userId))throw Error('Invalid account');
     await db('rpc/studkab_member_add','POST',{p_user:userId});
    }
    return json(answer);
   }
   if(input.action==='inbox'){
    const cfg=await config();
    if(user.email.toLowerCase()!==cfg.executor_email.toLowerCase())return json({error:'Входящие доступны только исполнителю'},403);
    const id=input.id;
    if(id!=null&&!/^[a-f0-9-]{36}$/.test(id))return json({error:'Неверный номер'},400);
    const after=input.after??0;
    if(!Number.isSafeInteger(after)||after<0)return json({error:'Неверная страница'},400);
    const rows=await db('studkab_requests?select=id,number,payload,created_at,revision&ready_at=not.is.null&deleting_at=is.null&order=number.asc&limit=100'+(id?'&id=eq.'+id:'&number=gt.'+after));
    if(input.includeDeliveryState===true){
     // Bounded per-request reads avoid silently truncating history across requests.
     for(let i=0;i<rows.length;i+=10)await Promise.all(rows.slice(i,i+10).map(async row=>{
      const [last]=await db('studkab_results?select=delivery_id,version_id,created_at&request_id=eq.'+row.id+'&order=created_at.desc,id.desc&limit=1');
      row.deliveryState={checkedAt:new Date(now()).toISOString(),last:last?{deliveryId:last.delivery_id,versionId:last.version_id,createdAt:last.created_at}:null};
     }));
    }
    // R3-E (часть 4): этап маршрута заявок по форме — одной выборкой на страницу входящих.
    if(input.includeR3===true){
     const ids=rows.filter(r=>r.payload?.route==='r3').map(r=>r.id);
     if(ids.length){
      const list='('+ids.join(',')+')';
      const [work,open]=await Promise.all([
       db('studkab_r3_work?select=request_id,taken_at,result_at,delivered_at,downloaded_at,handed_at,returns,returned_at&request_id=in.'+list),
       db('studkab_clarifications?select=request_id&answered_at=is.null&request_id=in.'+list+'&limit=1000')]);
      for(const row of rows){
       if(row.payload?.route!=='r3')continue;
       const w=work.find(x=>x.request_id===row.id);
       row.r3Summary={takenAt:w?.taken_at||null,resultAt:w?.result_at||null,deliveredAt:w?.delivered_at||null,downloadedAt:w?.downloaded_at||null,handedAt:w?.handed_at||null,returns:w?.returns||0,returnedAt:w?.returned_at||null,openQuestions:open.filter(x=>x.request_id===row.id).length};
      }
     }
    }
    return json({rows,next:rows.length===100?rows.at(-1).number:null});
   }
   return json({error:'Неизвестное действие'},400);
  }catch(e){if(/\bQUALITY_[A-Z_]+\b/.test(String(e?.message)))return json(qualityError(/\bQUALITY_[A-Z_]+\b/.exec(String(e.message))[0]),409);return json({error:'Сервис временно недоступен. Повторите отправку — дубликат заявки не создастся.'},503);}
 };
}
