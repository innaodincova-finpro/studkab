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
  out.chapters.push({id:c.id,name:text(c.name,300)});out.structure[c.id]={text:body};
 }
 if(total>500000 || !out.chapters.some(c=>out.structure[c.id].text.trim()))throw Error('Документ пустой или слишком большой');
 const f=value.format||{};
 for(const k of ['univ','faculty','kafedra','program','form','course','city','supervisor','workType','discipline','org','year','font'])out.format[k]=text(f[k]||'',500);
 for(const [k,min,max,def] of [['mTop',0,100,20],['mRight',0,100,15],['mBottom',0,100,20],['mLeft',0,100,30],['size',8,24,14],['spacing',1,3,1.5],['indent',0,5,1.25]]){
  const v=f[k]??def;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Проверьте оформление');out.format[k]=v;
 }
 out.format.font=out.format.font||'Times New Roman';out.format.toc=f.toc!==false;
 return out;
}
export const reviewCodes=Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']);
export function validateReview(criteria){
 if(!criteria||typeof criteria!=='object'||Array.isArray(criteria)||Object.keys(criteria).length!==16)throw Error('Заполните все пункты проверки');
 for(const code of reviewCodes){const c=criteria[code];if(c?.status!=='pass'||typeof c.evidence!=='string'||c.evidence.trim().length<10||c.evidence.length>2000)throw Error('Не подтверждён пункт '+code+': укажите результат и место проверки');}
 return Object.fromEntries(reviewCodes.map(code=>[code,{status:'pass',evidence:criteria[code].evidence.trim()}]));
}
const hash=/^[a-f0-9]{64}$/;
const errors={recipient:'Получатель не совпадает с автором заявки',file:'Некорректный или слишком большой Word',conflict:'Номер операции уже использован. Откройте проверку заново.',stale:'Версия документа или получатель изменились. Повторите проверку.',criteria:'Не все пункты проверки подтверждены',review_required:'Требуется сохранённая проверка этой версии Word. Обновите приложение и повторите проверку.'};
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
 if(!uuid.test(input.versionId||''))return {status:428,data:{error:errors.review_required}};
 let result;
 if(input.action==='prepare-result'){
  let document;try{document=validateResult(input.document);}catch(e){return {status:400,data:{error:e.message}};}
  if(request.payload?.n&&document.student.trim()!==request.payload.n.trim())return {status:409,data:{error:errors.recipient}};
  const file=input.docxBase64;
  if(typeof file!=='string'||file.length>4194304||file.length<8||!/^UEsDB[A-Za-z0-9+/]*={0,2}$/.test(file))return {status:400,data:{error:errors.file}};
  result=await db('rpc/prepare_studkab_result','POST',{request:input.id,version:input.versionId,recipient:request.student_id,content:document,file_base64:file});
 }else{
  if(!uuid.test(input.recipientId||'')||!hash.test(input.fileHash||'')||!hash.test(input.documentHash||'')||!uuid.test(input.reviewId||''))return {status:400,data:{error:'Не хватает данных сохранённой проверки'}};
  if(input.recipientId!==request.student_id)return {status:409,data:{error:errors.recipient}};
  const args={request:input.id,version:input.versionId,review:input.reviewId,recipient:request.student_id,file_hash:input.fileHash,document_hash:input.documentHash};
  if(input.action==='review-result'){
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
