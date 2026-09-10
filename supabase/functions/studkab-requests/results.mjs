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
export async function resultAction(input,user,{db,config}) {
 if(input.action==='deliver'){
  const cfg=await config();
  if(user.email.toLowerCase()!==cfg.executor_email.toLowerCase())return {status:403,data:{error:'Передача документа доступна только исполнителю'}};
 }
 if(!uuid.test(input.id||''))return {status:400,data:{error:'Неверный номер заявки'}};
 // Ownership is checked against the immutable server request, never browser metadata.
 const [request]=await db('studkab_requests?select=id,student_id&limit=1&id=eq.'+input.id);
 if(!request)return {status:404,data:{error:'Заявка не найдена'}};
 if(input.action==='result'){
  if(request.student_id!==user.id)return {status:404,data:{error:'Заявка не найдена'}};
  const [result]=await db('studkab_results?select=delivery_id,document,created_at&request_id=eq.'+input.id+'&order=created_at.desc,id.desc&limit=1');
  return {data:{result:result||null}};
 }
 if(!uuid.test(input.deliveryId||''))return {status:400,data:{error:'Неверный номер передачи'}};
 const controlled=await db('studkab_request_process?select=request_id&limit=1&request_id=eq.'+input.id);
 if(controlled.length)return {status:409,data:{error:'Эта заявка передаётся через контрольный лист качества'}};
 let document;try{document=validateResult(input.document);}catch(e){return {status:400,data:{error:e.message}};}
 const result=await db('rpc/deliver_studkab_result','POST',{request:input.id,delivery:input.deliveryId,content:document});
 if(result.conflict)return {status:409,data:{error:'Этот номер передачи уже использован для другого документа. Откройте передачу заново.'}};
 return {data:{saved:true,...result}};
}
