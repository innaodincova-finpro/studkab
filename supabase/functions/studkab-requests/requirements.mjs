import {validateMaterialManifest,resetMaterialEvidence,materialManifestGuard} from '../_shared/material-manifest.mjs';
import {sourceMinimumGuard} from '../_shared/source-minimum.mjs';
import {structureFindings} from '../_shared/structure-conflict.mjs';
import {currentAttachments} from '../_shared/current-attachments.mjs';
const categories=new Set(['method','measurable','expert','assumption']);
const statuses=new Set(['draft','approved','stale']);
const originalityModes=new Set(['university_threshold','university_threshold_no_service','university_no_threshold','service_only']);

function originality(item){
 const o=item.originality;
 if(o==null)return null;
 if(!o||typeof o!=='object'||Array.isArray(o)||!originalityModes.has(o.mode))throw Error('Проверьте основание проверки оригинальности');
 const service=text(o.service,200,'систему оригинальности');
 const hasThreshold=['university_threshold','university_threshold_no_service'].includes(o.mode);
 const thresholdPercent=hasThreshold?Number(o.thresholdPercent):null;
 if(o.mode==='university_threshold'&&(!service||!Number.isFinite(thresholdPercent)||thresholdPercent<0||thresholdPercent>100||typeof o.thresholdPercent!=='number'))throw Error('Подтвердите систему и порог вуза');
 if(o.mode==='university_threshold_no_service'&&(service||!Number.isFinite(thresholdPercent)||thresholdPercent<0||thresholdPercent>100||typeof o.thresholdPercent!=='number'))throw Error('Подтвердите порог в задании без выдуманной системы');
 if(!hasThreshold&&o.thresholdPercent!==null)throw Error('Порог без требования вуза указывать нельзя');
 if(o.mode==='university_no_threshold'&&!service)throw Error('Подтвердите систему проверки вуза');
 return {mode:o.mode,service,thresholdPercent};
}
export function originalityText(o){
 if(o.mode==='university_threshold')return 'Оригинальность: не менее '+o.thresholdPercent+'% в системе '+o.service+'.';
 if(o.mode==='university_threshold_no_service')return 'Оригинальность: не менее '+o.thresholdPercent+'%; система проверки в задании не указана.';
 if(o.mode==='university_no_threshold')return 'Оригинальность: проверка в системе '+o.service+'; числовое условие вуза отсутствует.';
 return 'Внешний отчёт по стандарту STUDKAB; в предоставленных материалах числовое условие вуза не обнаружено.';
}

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
  material_manifest:validateMaterialManifest(input.material_manifest),
  title:text(input.title,200,'название паспорта')||'Требования к работе',
  summary:text(input.summary,4000,'описание паспорта'),
  items:items.map((item,index)=>{
   if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Проверьте пункт '+(index+1));
   const id=text(item.id,80,'номер пункта',true);
   if(!/^[A-Za-z0-9_-]+$/.test(id)||seen.has(id))throw Error('Проверьте номер пункта '+(index+1));seen.add(id);
   if(!categories.has(item.category))throw Error('Проверьте категорию пункта '+(index+1));
   const answer_ids=Array.isArray(item.answer_ids)?item.answer_ids:[];
   if(answer_ids.length>100||answer_ids.some(x=>typeof x!=='string'||!/^[a-f0-9-]{36}$/i.test(x)))throw Error('Проверьте ответы студента');
   let structure_resolutions=[];
   if(id==='STRUCTURE'){
    const values=item.structure_resolutions??[];
    if(!Array.isArray(values)||values.length>96)throw Error('Проверьте решения по нумерации');
    structure_resolutions=values.map(r=>{
     if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Проверьте решение по нумерации');
     const fileHash=text(r.fileHash,64,'хеш материала',true),number=text(r.number,10,'исходный номер',true),chosenNumber=text(r.chosenNumber,10,'выбранный номер',true);
     if(!/^[a-f0-9]{64}$/u.test(fileHash)||!/^\d{1,2}(?:\.\d{1,2}){1,2}$/u.test(number)||!/^\d{1,2}(?:\.\d{1,2}){1,2}$/u.test(chosenNumber))throw Error('Проверьте номер и исходный материал');
     return {fileHash,number,chosenNumber,first:text(r.first,180,'первый заголовок',true),second:text(r.second,180,'второй заголовок',true),reason:text(r.reason,1000,'основание исправления'),verified:r.verified===true};
    });
   }
   return {verified:item.verified===true,answer_ids,id,category:item.category,required:item.required!==false,text:text(item.text,2000,'текст пункта',true),source:text(item.source,1000,'источник'),...(id==='ANTIPLAGIARISM'?{originality:originality(item)}:{}),...(id==='STRUCTURE'?{structure_resolutions}:{})};
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
 const facts=statedRequirements(payload),semantic=semanticRequirements(payload);
 let changed=false;
 const labels={VOLUME:'Объём',SOURCES:'Источники'};
 const items=passport.items.map(item=>{
  const replacement=semantic[item.id];
  if(replacement&&item.text===replacement.previous){
   changed=true;return {...item,verified:false,answer_ids:[],text:replacement.text,source:replacement.source};
  }
  const label=labels[item.id],fact=facts[item.id];
  if(!label||!fact||item.text!==label+': Не указано — требуется уточнить')return item;
  changed=true;return {...item,verified:false,answer_ids:[],text:label+': '+fact.text,source:fact.source};
 });
 return changed?{...passport,items}:passport;
}

// Interpret only explicit section lists. Never infer research methods or waive checks.
export function semanticRequirements(payload={}){
 const rq=typeof payload.rq==='string'?payload.rq.trim():'';
 const mn=typeof payload.mn==='string'?payload.mn.trim():'';
 const candidates=[...rq.matchAll(/страниц[а-я]*\s+основного\s+текста\s*:\s*([^.!?\n]+)/giu)];
 const result={};
 if(candidates.length===1&&/^введение\s+\d/iu.test(candidates[0][1])&&/заключение\s+\d/iu.test(candidates[0][1])){
  const list=candidates[0][1].trim();
  // A separately labelled structure may contradict the extracted list.
  const sectionNumbers=list.match(/\d+\s*(?:[–—-]\s*\d+)?/gu)||[];
  const noteSections=mn.match(/разделы\s+([\d\s/–—-]+)страницы?/iu);
  const normalize=value=>value.replace(/\s/g,'').replace(/[–—]/g,'-');
  const consistent=!noteSections||JSON.stringify(sectionNumbers.map(normalize))===JSON.stringify(noteSections[1].split('/').map(normalize));
  if(consistent&&!/(?:^|[.!?\n]\s*)Структура\s*:/iu.test(mn)){
   result.STRUCTURE={previous:'Структура: '+(mn||'Не указано — требуется уточнить'),text:'Структура: '+list,source:'Заявка студента'};
   const notes=mn.replace(/Использовать обновл[её]нное задание:\s*разделы\s+[\d\s/–—-]+страницы?\s*\([^)]*\)\./iu,'Использовать обновлённое задание.');
   if(notes&&notes!==mn)result.METHODOLOGY={previous:'Методология: '+mn,text:'Методические указания: '+notes,source:'Методические требования'};
  }
 }
 // Keep the unresolved marker: a test label is never an approval exemption.
 if(/Оригинальность не проверена, порог не задан\./u.test(rq)&&!/(?:\d\s*%|оригинальност[ьи]\s*(?:не менее|от|выше|>=|≥)\s*\d)/iu.test(rq+' '+mn)){
  result.ANTIPLAGIARISM={previous:'Система и порог оригинальности: Не указано — требуется уточнить',text:'Оригинальность: Порог в заявке не задан. Проверка не проводилась. Требуется уточнить условие оригинальности перед утверждением паспорта. Это не подтверждение прохождения проверки.',source:'Заявка студента'};
 }
 return result;
}

export function defaultPassport(payload={}){
 const value=(v,missing='Не указано — требуется уточнить')=>typeof v==='string'&&v.trim()?v.trim():missing;
 const format=payload.fm&&typeof payload.fm==='object'?payload.fm:{};
 const formatting=formatRequirement(format);
 const facts=statedRequirements(payload);
 const passport={title:'Паспорт требований к работе',summary:'Автоматически создан по заявке. Перед запуском проверьте, дополните и утвердите каждый пункт.',items:[
  {id:'WORK_TYPE',category:'method',required:true,text:'Вид работы: '+value(payload.k),source:'Заявка студента'},
  {id:'DISCIPLINE',category:'method',required:true,text:'Дисциплина: '+value(payload.d),source:'Заявка студента'},
  {id:'STRUCTURE',category:'method',required:true,text:'Структура: '+value(payload.mn),source:'Методические требования'},
  {id:'VOLUME',category:'measurable',required:true,text:'Объём: '+(facts.VOLUME?.text||'Не указано — требуется уточнить'),source:facts.VOLUME?.source||'Методические требования'},
  {id:'METHODOLOGY',category:'expert',required:true,text:'Методология: '+value(payload.mn),source:'Методические требования'},
  {id:'FORMATTING',category:'measurable',required:true,text:'Оформление: '+formatting,source:'Заявка студента'},
  {id:'SOURCES',category:'method',required:true,text:'Источники: '+(facts.SOURCES?.text||'Не указано — требуется уточнить'),source:facts.SOURCES?.source||'Методические требования'},
  {id:'CALCULATIONS',category:'expert',required:true,text:'Расчёты и исходные данные: Не указано — требуется уточнить',source:''},
  {id:'ANTIPLAGIARISM',category:'measurable',required:true,text:'Система и порог оригинальности: Не указано — требуется уточнить',source:'',originality:null},
  {id:'TEACHER',category:'method',required:true,text:'Условия преподавателя: Не указано — требуется уточнить',source:''}
 ]};
 const semantic=semanticRequirements(payload);
 passport.items=passport.items.map(item=>semantic[item.id]?{...item,text:semantic[item.id].text,source:semantic[item.id].source}:item);
 return passport;
}

export async function requirementAction(input,user,{db,config}){
 const cfg=await config();
 if((user.email||'').toLowerCase()!==(cfg.executor_email||'').toLowerCase())return {status:403,data:{error:'Паспорт требований доступен только исполнителю'}};
 const request=typeof input.id==='string'&&/^[a-f0-9-]{36}$/.test(input.id)?input.id:null;
 if(!request)return {status:400,data:{error:'Неверный номер заявки'}};
 const [row]=await db('studkab_requests?select=id,payload,revision,ready_at,studkab_material_revisions(id,closed_at),studkab_request_reassignments(operation_id)&deleting_at=is.null&limit=1&id=eq.'+request);
 if(!row)return {status:404,data:{error:'Заявка не найдена'}};
 if(row.ready_at===null)return {status:409,data:{error:'Заявка ещё не отправлена исполнителю'}};
 if(input.action==='passport-structure-audit'){
  const [latest]=await db('studkab_requirement_passports?select=items&request_id=eq.'+request+'&order=revision.desc&limit=1');
  const attached=await db('studkab_request_attachments?request_id=eq.'+request+'&select=id,supersedes,category,file_name,file_hash,extracted_text');
  if(!Array.isArray(attached))throw Error('Не удалось прочитать исходные материалы');
  return {status:200,data:{findings:structureFindings(currentAttachments(attached),latest?.items||[]),materialRevision:row.revision}};
 }
 const revisionOpen=(row.studkab_material_revisions||[]).some(c=>c.closed_at===null);
 if(revisionOpen&&input.action!=='passport-get'){
  if(input.action!=='passport-ensure')return {status:409,data:{error:'Завершите дополнение материалов перед изменением паспорта'}};
  const rows=await db('studkab_requirement_passports?select=id,request_id,revision,status,title,summary,items,material_manifest,source_fingerprint,created_at,approved_at&request_id=eq.'+request+'&order=revision.desc&limit=20');
  const state=await db('rpc/studkab_material_revision_state','POST',{p_request:request,p_actor:user.id});
  return {status:200,data:{passports:rows,created:false,materials:state.materials,materialRevision:row.revision}};
 }
 if(input.action!=='passport-get'&&input.expectedRevision!==undefined&&(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0))return {status:400,data:{error:'Откройте паспорт заново'}};
 if(input.action!=='passport-get'&&((row.studkab_material_revisions||[]).length||(row.studkab_request_reassignments||[]).length)&&input.expectedRevision!==row.revision)return {status:409,data:{error:'Материалы изменились. Откройте паспорт заново'}};
 if(input.action==='passport-get'){
  const rows=await db('studkab_requirement_passports?select=id,request_id,revision,status,title,summary,items,material_manifest,source_fingerprint,created_at,approved_at&request_id=eq.'+request+'&order=revision.desc&limit=20');
  return {status:200,data:{passports:rows,materialRevision:row.revision}};
 }
 if(input.action==='passport-ensure'){
  if(!/^[a-f0-9]{64}$/.test(input.sourceFingerprint||''))return {status:400,data:{error:'Сначала сохраните актуальные материалы'}};
  const rows=await db('studkab_requirement_passports?select=id,request_id,revision,status,title,summary,items,material_manifest,source_fingerprint,created_at,approved_at&request_id=eq.'+request+'&order=revision.desc&limit=20');
  const filled=rows.length?fillMissingDraft(rows[0],row.payload):null;
  if(rows.length&&rows[0].status!=='stale'&&rows[0].source_fingerprint===input.sourceFingerprint&&filled===rows[0])return {status:200,data:{passports:rows,created:false,materialRevision:row.revision}};
  const passport=rows.length?{title:rows[0].title,summary:filled!==rows[0]?'Требования уточнены по исходной заявке без изменения исходных сведений. Проверьте новую версию перед утверждением.':'Материалы изменились. Проверьте новую версию перед утверждением.',items:rows[0].status==='stale'||rows[0].source_fingerprint!==input.sourceFingerprint?filled.items.map(item=>({...item,verified:false,answer_ids:[]})):filled.items}:defaultPassport(row.payload);
  passport.material_manifest=rows.length?(rows[0].status==='stale'||rows[0].source_fingerprint!==input.sourceFingerprint?resetMaterialEvidence(rows[0].material_manifest):rows[0].material_manifest):null;
  const created=await db('rpc/studkab_requirement_passport_save','POST',{p_request:request,p_actor:user.id,p_title:passport.title,p_summary:passport.summary,p_items:passport.items,p_material_manifest:passport.material_manifest??null,p_source_fingerprint:input.sourceFingerprint,p_expected_revision:input.expectedRevision??null});
  if(created.error)return {status:409,data:created};
  return {status:200,data:{passports:[created].concat(rows),created:true,materialRevision:row.revision}};
 }
 let passport;
 try{passport=validatePassport(input.passport);}catch(e){return {status:400,data:{error:e.message}};}
 if(input.action==='passport-save'){
  const result=await db('rpc/studkab_requirement_passport_save','POST',{p_request:request,p_actor:user.id,p_title:passport.title,p_summary:passport.summary,p_items:passport.items,p_material_manifest:passport.material_manifest??null,p_source_fingerprint:text(input.sourceFingerprint,128,'версию материалов'),p_expected_revision:input.expectedRevision??null});
  if(result.error)return {status:409,data:result};
  return {status:200,data:{passport:result,materialRevision:row.revision}};
 }
 if(input.action==='passport-approve'){
  const version=typeof input.passportId==='string'&&/^[a-f0-9-]{36}$/.test(input.passportId)?input.passportId:null;
  if(!version)return {status:400,data:{error:'Выберите версию паспорта'}};
  const required=['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER'];
  if(required.some(id=>!passport.items.some(q=>q.id===id))||passport.items.some(item=>(item.required||required.includes(item.id))&&(!item.verified||!item.source||(/не указано|требуется уточнить|порог не задан|ожидается ответ/i.test(item.text)&&!(item.id==='ANTIPLAGIARISM'&&item.originality?.mode==='university_threshold_no_service'&&item.text===originalityText(item.originality))))))return {status:409,data:{error:'Заполните все обязательные требования паспорта'}};
  const anti=passport.items.find(item=>item.id==='ANTIPLAGIARISM');
  if(!anti.originality||anti.text!==originalityText(anti.originality)||anti.originality.mode==='service_only'&&!/STUDKAB/i.test(anti.source)||['university_threshold','university_no_threshold'].includes(anti.originality.mode)&&!anti.originality.service)return {status:409,data:{error:'Укажите подтверждённое основание проверки оригинальности'}};
  const [saved]=await db('studkab_requirement_passports?request_id=eq.'+request+'&id=eq.'+version+'&select=items&limit=1');
  if(!saved)return {status:409,data:{error:'Версия паспорта не найдена'}};
  const materials=await materialManifestGuard(db,request,version);
  if(materials)return {status:409,data:materials};
  const conflict=await sourceMinimumGuard(db,request,saved.items);
  if(conflict)return {status:409,data:conflict};
  const expected=text(input.sourceFingerprint,128,'версию материалов',true);
  const result=await db('rpc/studkab_requirement_passport_approve','POST',{p_request:request,p_passport:version,p_actor:user.id,p_expected_items:passport.items,p_expected_manifest:passport.material_manifest,p_expected_fingerprint:expected,p_expected_revision:input.expectedRevision??null});
  if(result.error)return {status:409,data:result};
  return {status:200,data:{passport:result,materialRevision:row.revision}};
 }
 return {status:400,data:{error:'Неизвестное действие'}};
}

export {categories,statuses};
