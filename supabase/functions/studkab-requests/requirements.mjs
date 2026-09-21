import {sourceMinimumGuard} from '../_shared/source-minimum.mjs';
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

export function formatRequirement(format={}){
 const value=(long,short)=>format[long]??format[short];
 const parts=[];
 const font=value('font','fn'),size=value('size','sz');
 if(font||size)parts.push('шрифт '+[font,size&&size+' пт'].filter(Boolean).join(', '));
 const margins=[['слева',value('mLeft','ml')],['справа',value('mRight','mr')],['сверху',value('mTop','mt')],['снизу',value('mBottom','mb')]].filter(([,v])=>v!==undefined&&v!==null&&v!=='');
 if(margins.length)parts.push('поля: '+margins.map(([label,v])=>label+' '+v+' мм').join(', '));
 const spacing=value('spacing','sp'),indent=value('indent','ind');
 if(spacing)parts.push('межстрочный интервал '+String(spacing).replace('.',','));
 if(indent)parts.push('абзацный отступ '+String(indent).replace('.',',')+' см');
 return parts.join('; ')||'Не указано — требуется уточнить';
}

// Only explicit statements in the submission are candidates; ambiguity stays unresolved.
export function statedRequirements(payload={}){
 const entries=[['rq','Заявка студента'],['mn','Методические требования']];
 const volumes=[],sources=[];
 for(const [key,source] of entries){
  const body=typeof payload[key]==='string'?payload[key]:'';
  for(const match of body.matchAll(/(?:Об[ъь][её]м\s*:\s*\d+\s*(?:[–—-]\s*\d+\s*)?(?:страниц[а-я]*|стр\.)|\d+\s*(?:[–—-]\s*\d+\s*)?страниц[а-я]*\s+основного\s+текста)/giu)){
   const raw=match[0].replace(/^Об[ъь][её]м\s*:\s*/iu,'');
   volumes.push({text:raw,source,key:raw.match(/\d+/g).join('-')});
  }
  for(const match of body.matchAll(/(?:^|[.\n;]\s*)Источники\s*:\s*([^\n]+?)(?=\s*Оригинальность(?=\s|[:.,;]|$)|\n|$)/giu)){
   const raw=match[1].trim();
   if(raw&&raw.length<1900&&!/не указано|требуется уточнить|не заданы/i.test(raw))sources.push({text:raw,source,key:raw.toLowerCase().replace(/\s+/g,' ').replace(/[.\s]+$/,'')});
  }
 }
 const unique=rows=>rows.length&&new Set(rows.map(row=>row.key)).size===1?rows[0]:null;
 return {VOLUME:unique(volumes),SOURCES:unique(sources)};
}

export function fillMissingDraft(passport,payload){
 if(passport.status!=='draft')return passport;
 const facts=statedRequirements(payload);
 let changed=false;
 const labels={VOLUME:'Объём',SOURCES:'Источники'};
 const items=passport.items.map(item=>{
  const label=labels[item.id],fact=facts[item.id];
  if(!label||!fact||item.text!==label+': Не указано — требуется уточнить')return item;
  changed=true;return {...item,text:label+': '+fact.text,source:fact.source};
 });
 return changed?{...passport,items}:passport;
}

export function defaultPassport(payload={}){
 const value=(v,missing='Не указано — требуется уточнить')=>typeof v==='string'&&v.trim()?v.trim():missing;
 const format=payload.fm&&typeof payload.fm==='object'?payload.fm:{};
 const formatting=formatRequirement(format);
 const facts=statedRequirements(payload);
 return {title:'Паспорт требований к работе',summary:'Автоматически создан по заявке. Перед запуском проверьте, дополните и утвердите каждый пункт.',items:[
  {id:'WORK_TYPE',category:'method',required:true,text:'Вид работы: '+value(payload.k),source:'Заявка студента'},
  {id:'DISCIPLINE',category:'method',required:true,text:'Дисциплина: '+value(payload.d),source:'Заявка студента'},
  {id:'STRUCTURE',category:'method',required:true,text:'Структура: '+value(payload.mn),source:'Методические требования'},
  {id:'VOLUME',category:'measurable',required:true,text:'Объём: '+(facts.VOLUME?.text||'Не указано — требуется уточнить'),source:facts.VOLUME?.source||'Методические требования'},
  {id:'METHODOLOGY',category:'expert',required:true,text:'Методология: '+value(payload.mn),source:'Методические требования'},
  {id:'FORMATTING',category:'measurable',required:true,text:'Оформление: '+formatting,source:'Заявка студента'},
  {id:'SOURCES',category:'method',required:true,text:'Источники: '+(facts.SOURCES?.text||'Не указано — требуется уточнить'),source:facts.SOURCES?.source||'Методические требования'},
  {id:'CALCULATIONS',category:'expert',required:true,text:'Расчёты: '+value(payload.org),source:'Заявка и материалы'},
  {id:'ANTIPLAGIARISM',category:'measurable',required:true,text:'Система и порог оригинальности: Не указано — требуется уточнить',source:'Требования вуза'},
  {id:'TEACHER',category:'method',required:true,text:'Условия преподавателя: '+value(payload.rq),source:'Заявка студента'}
 ]};
}

export async function requirementAction(input,user,{db,config}){
 const cfg=await config();
 if((user.email||'').toLowerCase()!==(cfg.executor_email||'').toLowerCase())return {status:403,data:{error:'Паспорт требований доступен только исполнителю'}};
 const request=typeof input.id==='string'&&/^[a-f0-9-]{36}$/.test(input.id)?input.id:null;
 if(!request)return {status:400,data:{error:'Неверный номер заявки'}};
 const [row]=await db('studkab_requests?select=id,payload&limit=1&id=eq.'+request);
 if(!row)return {status:404,data:{error:'Заявка не найдена'}};
 if(input.action==='passport-get'){
  const rows=await db('studkab_requirement_passports?select=id,request_id,revision,status,title,summary,items,source_fingerprint,created_at,approved_at&request_id=eq.'+request+'&order=revision.desc&limit=20');
  return {status:200,data:{passports:rows}};
 }
 if(input.action==='passport-ensure'){
  if(!/^[a-f0-9]{64}$/.test(input.sourceFingerprint||''))return {status:400,data:{error:'Сначала сохраните актуальные материалы'}};
  const rows=await db('studkab_requirement_passports?select=id,request_id,revision,status,title,summary,items,source_fingerprint,created_at,approved_at&request_id=eq.'+request+'&order=revision.desc&limit=20');
  const filled=rows.length?fillMissingDraft(rows[0],row.payload):null;
  if(rows.length&&rows[0].source_fingerprint===input.sourceFingerprint&&filled===rows[0])return {status:200,data:{passports:rows,created:false}};
  const passport=rows.length?{title:rows[0].title,summary:filled!==rows[0]?'Заполнены объём и/или источники из исходной заявки. Проверьте новую версию перед утверждением.':'Материалы изменились. Проверьте новую версию перед утверждением.',items:filled.items}:defaultPassport(row.payload);
  const created=await db('rpc/studkab_requirement_passport_save','POST',{p_request:request,p_actor:user.id,p_title:passport.title,p_summary:passport.summary,p_items:passport.items,p_source_fingerprint:input.sourceFingerprint});
  return {status:200,data:{passports:[created].concat(rows),created:true}};
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
  if(passport.items.some(item=>item.required&&/не указано|требуется уточнить/i.test(item.text)))return {status:409,data:{error:'Заполните все обязательные требования паспорта'}};
  const [saved]=await db('studkab_requirement_passports?request_id=eq.'+request+'&id=eq.'+version+'&select=items&limit=1');
  if(!saved)return {status:409,data:{error:'Версия паспорта не найдена'}};
  const conflict=await sourceMinimumGuard(db,request,saved.items);
  if(conflict)return {status:409,data:conflict};
  const expected=text(input.sourceFingerprint,128,'версию материалов',true);
  const result=await db('rpc/studkab_requirement_passport_approve','POST',{p_request:request,p_passport:version,p_actor:user.id,p_expected_items:passport.items,p_expected_fingerprint:expected});
  return {status:200,data:{passport:result}};
 }
 return {status:400,data:{error:'Неизвестное действие'}};
}

export {categories,statuses};
