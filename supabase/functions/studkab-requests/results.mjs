import {inspectWord} from '../_shared/external-word.mjs';
import {sourceMinimumGuard} from '../_shared/source-minimum.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validateResult(value) {
 if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('Проверьте документ');
 const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error('Проверьте размер и текст документа');return v;};
 const out={topic:text(value.topic,300),student:text(value.student||'',200),group:text(value.group||'',100),format:{},structure:{},chapters:[]};
 if(!out.topic.trim()||!Array.isArray(value.chapters)||!value.chapters.length||value.chapters.length>40)throw Error('Добавьте тему и разделы документа');
 const ids=new Set();let total=0;
 for(const c of value.chapters){
  if(!c || typeof c.id!=='string'|| !/^[a-zA-Z0-9_-]{1,100}$/.test(c.id)||['__proto__','constructor','prototype'].includes(c.id)||ids.has(c.id))throw Error('Проверьте разделы документа');
  ids.add(c.id);const body=text(value.structure?.[c.id]?.text,100000);total+=body.length;
  if(!body.trim()||/\[(?:ДАННЫЕ СТУДЕНТА|СФОРМУЛИРОВАТЬ САМОСТОЯТЕЛЬНО|ПРОВЕРИТЬ ИСТОЧНИК|выше\/ниже|соответствует\/не соответствует|больше\/меньше)[^\]]*\]/i.test(body))throw Error('Документ не готов к передаче: есть пустые разделы или незаполненные пометки');
  const figures=value.structure?.[c.id]?.figures;
  const cleanFigures=[];
  if(figures!==undefined){
   if(!Array.isArray(figures)||figures.length>20)throw Error('Проверьте изображения документа');
   for(const figure of figures){
    const mime=text(figure?.mimeType||'',20),data=text(figure?.dataBase64||'',1400000),caption=text(figure?.caption||'',300);
    if(!['image/png','image/jpeg'].includes(mime)||!data||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw Error('Проверьте изображения документа');
    const widthMm=Number(figure.widthMm)||150,heightMm=Number(figure.heightMm)||90;
    if(!Number.isFinite(widthMm)||widthMm<30||widthMm>160||!Number.isFinite(heightMm)||heightMm<20||heightMm>220)throw Error('Проверьте размеры изображений документа');
    cleanFigures.push({mimeType:mime,dataBase64:data,caption,widthMm,heightMm});
   }
  }
  out.chapters.push({id:c.id,name:text(c.name,300)});out.structure[c.id]={text:body};
  if(cleanFigures.length)out.structure[c.id].figures=cleanFigures;
 }
 if(total>500000 || !out.chapters.some(c=>out.structure[c.id].text.trim()))throw Error('Документ пустой или слишком большой');
 const f=value.format||{};
 for(const k of ['univ','faculty','kafedra','program','form','course','city','supervisor','workType','discipline','org','year','font'])out.format[k]=text(f[k]||'',500);
 for(const [k,min,max,def] of [['mTop',0,100,20],['mRight',0,100,15],['mBottom',0,100,20],['mLeft',0,100,30],['size',8,24,14],['spacing',1,3,1.5],['indent',0,5,1.25]]){
  const v=f[k]??def;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Проверьте оформление');out.format[k]=v;
 }
 out.format.font=out.format.font||'Times New Roman';out.format.toc=f.toc!==false;
 if(value.reviewContext!==undefined){
  const c=value.reviewContext;
  if(!c||!uuid.test(c.passportId||'')||!hash.test(c.sourceFingerprint||'')||!hash.test(c.fingerprint||''))throw Error('Не подтверждён паспорт проверки');
  out.reviewContext={passportId:c.passportId,sourceFingerprint:c.sourceFingerprint,fingerprint:c.fingerprint};
 }
 if(value.uploadedWord!==undefined){
  const u=value.uploadedWord;
  if(!u||!hash.test(u.fileHash||'')||!out.reviewContext)throw Error('Не подтверждены файл и паспорт проверки');
  out.uploadedWord={name:text(u.name,200),fileHash:u.fileHash};
  if(!/\.docx$/i.test(out.uploadedWord.name))throw Error('Выберите Word .docx');
 }
 return out;
}
export const reviewCodes=Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']);
export function validateReview(criteria){
 if(!criteria||typeof criteria!=='object'||Array.isArray(criteria)||Object.keys(criteria).length!==16)throw Error('Заполните все пункты проверки');
 for(const code of reviewCodes){const c=criteria[code];if(!['pass','not_applicable'].includes(c?.status)||typeof c.evidence!=='string'||c.evidence.trim().length<10||c.evidence.length>2000)throw Error('Не подтверждён пункт '+code+': нужен результат без блокера и доказательство');}
 return Object.fromEntries(reviewCodes.map(code=>[code,{status:criteria[code].status,evidence:criteria[code].evidence.trim()}]));
}
export function validateReviewNotes(criteria){
 if(!criteria||typeof criteria!=='object'||Array.isArray(criteria)||!Object.keys(criteria).length||Object.keys(criteria).some(c=>!reviewCodes.includes(c)))throw Error('Выберите пункты замечаний');
 const out={};let blocked=false;
 for(const [code,c] of Object.entries(criteria)){
  if(!['pass','not_applicable','fail','manual'].includes(c?.status)||typeof c.evidence!=='string'||c.evidence.trim().length<10||c.evidence.length>2000||typeof c.section!=='string'||!c.section.trim()||c.section.length>300)throw Error('Укажите результат, место и замечание: '+code);
  blocked ||= ['fail','manual'].includes(c.status);
  out[code]={status:c.status,evidence:c.evidence.trim(),section:c.section.trim()};
 }
 if(!blocked)throw Error('Для замечаний нужен пункт «Не пройден» или «Нужна ручная проверка»');
 return out;
}
const hash=/^[a-f0-9]{64}$/;
const errors={recipient:'Получатель не совпадает с автором заявки',file:'Некорректный или слишком большой Word',conflict:'Номер операции уже использован. Откройте проверку заново.',stale:'Версия документа или получатель изменились. Повторите проверку.',criteria:'Не все пункты проверки подтверждены',review_required:'Требуется сохранённая проверка этой версии Word. Обновите приложение и повторите проверку.'};
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
async function currentPassport(document,request,db){
 const c=document?.reviewContext;if(!c)return false;
 if(await db('rpc/studkab_result_context_version')!==1)throw Error('Серверная защита проверки ещё не установлена');
 const [p]=await db('studkab_requirement_passports?select=id,status,source_fingerprint&request_id=eq.'+request+'&order=revision.desc&limit=1');
 return !!p&&p.status==='approved'&&p.id===c.passportId&&p.source_fingerprint===c.sourceFingerprint;
}
async function readReviewState(input,request,db){
 let document;try{document=validateResult(input.document);}catch(e){return {status:400,data:{error:e.message}};}
 if(!await currentPassport(document,input.id,db))return {status:409,data:{error:'Паспорт изменился или не утверждён. Повторите проверку требований.'}};
 const [version]=await db('studkab_result_versions?select=id,revision,recipient_id,document,document_hash,file_hash,docx_base64&request_id=eq.'+input.id+'&order=revision.desc&limit=1');
 if(!version)return {data:{state:'none'}};
 if(version.recipient_id!==request.student_id||canonical(version.document)!==canonical(document))return {data:{state:'stale'}};
 const [delivery]=await db('studkab_results?select=delivery_id,review_id,created_at&request_id=eq.'+input.id+'&version_id=eq.'+version.id+'&order=created_at.desc,id.desc&limit=1');
 const reviews=await db('studkab_result_reviews?select=id,version_id,criteria,created_at&version_id=eq.'+version.id+(delivery?'&id=eq.'+delivery.review_id:'&order=created_at.desc,id.desc')+'&limit=1');
 const review=reviews[0];
 let changes=false;
 if(review){try{validateReview(review.criteria);}catch{try{validateReviewNotes(review.criteria);changes=true;}catch{return {status:409,data:{error:errors.criteria}};}}}
 if(delivery&&changes)return {status:409,data:{error:errors.criteria}};
 if(delivery&&!review)return {status:409,data:{error:errors.review_required}};
 return {data:{state:delivery?'delivered':changes?'changes_requested':review?'reviewed':'prepared',receipt:{versionId:version.id,recipientId:version.recipient_id,fileHash:version.file_hash,documentHash:version.document_hash,revision:version.revision},docxBase64:version.docx_base64,review:review?{reviewId:review.id,versionId:review.version_id,criteria:review.criteria,reviewedAt:review.created_at}:null,delivery:delivery?{deliveryId:delivery.delivery_id,createdAt:delivery.created_at}:null}};
}
export async function resultAction(input,user,{db,config}) {
 if(input.action!=='result'){
  const cfg=await config();
  if((user.email||'').toLowerCase()!==(cfg.executor_email||'').toLowerCase())return {status:403,data:{error:'Передача и проверка доступны только исполнителю'}};
 }
 if(!uuid.test(input.id||''))return {status:400,data:{error:'Неверный номер заявки'}};
 const [request]=await db('studkab_requests?select=id,student_id,payload&limit=1&id=eq.'+input.id);
 if(!request)return {status:404,data:{error:'Заявка не найдена'}};
 if(input.action==='result'){
  if(request.student_id!==user.id)return {status:404,data:{error:'Заявка не найдена'}};
  const [result]=await db('studkab_results?select=delivery_id,document,created_at,version_id&request_id=eq.'+input.id+'&order=created_at.desc,id.desc&limit=1');
  if(result?.version_id){
   const [version]=await db('studkab_result_versions?select=docx_base64,file_hash,recipient_id&id=eq.'+result.version_id+'&request_id=eq.'+input.id+'&limit=1');
   if(!version||version.recipient_id!==user.id)return {status:409,data:{error:'Версия результата не подтверждена'}};
   result.docxBase64=version.docx_base64;result.fileHash=version.file_hash;
  }
  return {data:{result:result||null}};
 }
 if(input.action==='result-review-history'){
  const reviews=await db('studkab_result_reviews?select=id,version_id,criteria,created_at,studkab_result_versions!inner(request_id,revision,file_hash)&studkab_result_versions.request_id=eq.'+input.id+'&order=created_at.desc,id.desc&limit=100');
  return {data:{reviews,limit:100}};
 }
 if(input.action==='result-review-state')return readReviewState(input,request,db);
 if(!uuid.test(input.versionId||''))return {status:428,data:{error:errors.review_required}};
 let result;
 if(input.action==='prepare-result'){
  let document;try{document=validateResult(input.document);}catch(e){return {status:400,data:{error:e.message}};}
  if(request.payload?.n&&document.student.trim()!==request.payload.n.trim())return {status:409,data:{error:errors.recipient}};
  if(document.reviewContext&&!await currentPassport(document,input.id,db))return {status:409,data:{error:errors.stale}};
  const file=input.docxBase64;
  if(typeof file!=='string'||file.length>4194304||file.length<8||!/^UEsDB[A-Za-z0-9+/]*={0,2}$/.test(file))return {status:400,data:{error:errors.file}};
  if(document.uploadedWord){
   try{
    const bytes=Uint8Array.from(atob(file),c=>c.charCodeAt(0)),inspected=await inspectWord(bytes);
    if(inspected.fileHash!==document.uploadedWord.fileHash||document.chapters.map(c=>document.structure[c.id].text).join('')!==inspected.text)throw Error('Выбранный Word и его текст не совпадают. Прикрепите файл заново.');
   }catch(e){return {status:400,data:{error:e.message}};}
  }
  result=await db('rpc/prepare_studkab_result','POST',{request:input.id,version:input.versionId,recipient:request.student_id,content:document,file_base64:file});
 }else{
  if(!uuid.test(input.recipientId||'')||!hash.test(input.fileHash||'')||!hash.test(input.documentHash||'')||!uuid.test(input.reviewId||''))return {status:400,data:{error:'Не хватает данных сохранённой проверки'}};
  if(input.recipientId!==request.student_id)return {status:409,data:{error:errors.recipient}};
  if(input.document!==undefined){
   let document;try{document=validateResult(input.document);}catch(e){return {status:400,data:{error:e.message}};}
   const [v]=await db('studkab_result_versions?select=document&request_id=eq.'+input.id+'&id=eq.'+input.versionId+'&limit=1');
   if(!v||canonical(v.document)!==canonical(document)||!await currentPassport(document,input.id,db))return {status:409,data:{error:errors.stale}};
  }
  const [passport]=await db('studkab_requirement_passports?request_id=eq.'+input.id+'&select=id,status,items&order=revision.desc&limit=1');
  const conflict=input.action==='review-notes'?null:await sourceMinimumGuard(db,input.id,passport?.items);
  if(conflict)return {status:409,data:conflict};
  const args={request:input.id,version:input.versionId,review:input.reviewId,recipient:request.student_id,file_hash:input.fileHash,document_hash:input.documentHash};
  if(input.action==='review-notes'){
   let criteria;try{criteria=validateReviewNotes(input.criteria);}catch(e){return {status:400,data:{error:e.message}};}
   result=await db('rpc/record_studkab_review_notes','POST',{...args,reviewer:user.id,criteria});
  }else if(input.action==='review-result'){
   let criteria;try{criteria=validateReview(input.criteria);}catch(e){return {status:400,data:{error:e.message}};}
   result=await db('rpc/review_studkab_result','POST',{...args,reviewer:user.id,criteria});
  }else{
   if(!uuid.test(input.deliveryId||''))return {status:400,data:{error:'Неверный номер передачи'}};
   result=await db('rpc/deliver_reviewed_studkab_result','POST',{...args,delivery:input.deliveryId});
  }
 }
 if(result.error)return {status:result.error==='review_required'?428:409,data:{error:errors[result.error]||'Проверка не подтверждена'}};
 return {data:{saved:true,...result}};
}
