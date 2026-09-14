const categories=new Set(['method','measurable','expert','assumption']);
const statuses=new Set(['draft','approved','stale']);

function text(value,max,label,required=false){
 if(value==null)value='';
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error('Проверьте '+label);
 return value.trim();
}

export function validatePassport(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Проверьте паспорт требований');
 const items=Array.isArray(input.items)?input.items:null;
 if(!items||items.length>100)throw Error('Проверьте пункты требований');
 const seen=new Set();
 return {
  title:text(input.title,200,'название паспорта')||'Требования к работе',
  summary:text(input.summary,4000,'описание паспорта'),
  items:items.map((item,index)=>{
   if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Проверьте пункт '+(index+1));
   const id=text(item.id,80,'номер пункта',true);
   if(!/^[A-Za-z0-9_-]+$/.test(id)||seen.has(id))throw Error('Проверьте номер пункта '+(index+1));seen.add(id);
   if(!categories.has(item.category))throw Error('Проверьте категорию пункта '+(index+1));
   return {id,category:item.category,required:item.required!==false,text:text(item.text,2000,'текст пункта',true),source:text(item.source,1000,'источник')};
  })
 };
}

export async function requirementAction(input,user,{db,config}){
 const cfg=await config();
 if((user.email||'').toLowerCase()!==(cfg.executor_email||'').toLowerCase())return {status:403,data:{error:'Паспорт требований доступен только исполнителю'}};
 const request=typeof input.id==='string'&&/^[a-f0-9-]{36}$/.test(input.id)?input.id:null;
 if(!request)return {status:400,data:{error:'Неверный номер заявки'}};
 const [row]=await db('studkab_requests?select=id&limit=1&id=eq.'+request);
 if(!row)return {status:404,data:{error:'Заявка не найдена'}};
 if(input.action==='passport-get'){
  const rows=await db('studkab_requirement_passports?select=id,request_id,revision,status,title,summary,items,source_fingerprint,created_at,approved_at&request_id=eq.'+request+'&order=revision.desc&limit=20');
  return {status:200,data:{passports:rows}};
 }
 let passport;
 try{passport=validatePassport(input.passport);}catch(e){return {status:400,data:{error:e.message}};}
 if(input.action==='passport-save'){
  const result=await db('rpc/studkab_requirement_passport_save','POST',{p_request:request,p_actor:user.id,p_title:passport.title,p_summary:passport.summary,p_items:passport.items,p_source_fingerprint:text(input.sourceFingerprint,128,'версию материалов')});
  return {status:200,data:{passport:result}};
 }
 if(input.action==='passport-approve'){
  const version=typeof input.passportId==='string'&&/^[a-f0-9-]{36}$/.test(input.passportId)?input.passportId:null;
  if(!version)return {status:400,data:{error:'Выберите версию паспорта'}};
  const result=await db('rpc/studkab_requirement_passport_approve','POST',{p_request:request,p_passport:version,p_actor:user.id,p_expected_items:passport.items});
  return {status:200,data:{passport:result}};
 }
 return {status:400,data:{error:'Неизвестное действие'}};
}

export {categories,statuses};
