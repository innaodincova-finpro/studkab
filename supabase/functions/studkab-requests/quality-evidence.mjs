import {inspectWord} from '../_shared/external-word.mjs';
import {currentAttachments} from '../_shared/current-attachments.mjs';
import {scanInternalBorrowing} from '../_shared/internal-borrowing.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/;
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const digest=async x=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(x))))].map(b=>b.toString(16).padStart(2,'0')).join('');
const messages={
 QUALITY_FORBIDDEN:'Проверку качества сохраняет исполнитель заявки.',
 QUALITY_STALE:'Версия Word, получатель или паспорт изменились. Откройте текущий документ и повторите проверку.',
 QUALITY_PASSPORT:'Актуальный паспорт не утверждён или материалы не подтверждены. Сначала проверьте паспорт.',
 QUALITY_SCAN_STALE:'Документ или доступные фрагменты источников изменились. Запустите внутреннюю проверку заново.',
 QUALITY_SCAN_INCOMPLETE:'Не все источники доступны для сравнения либо достигнут предел проверки. Добавьте читаемые фрагменты источников; пока сохраните результат как ручную проверку.',
 QUALITY_FINDING_UNREVIEWED:'Не все найденные совпадения рассмотрены. Для каждого укажите решение и пояснение; непроверенный результат сохраните как ручную проверку.',
 QUALITY_BELOW_THRESHOLD:'Оригинальность в отчёте ниже указанного требования. Сохраните непройденный результат и доработайте документ.',
 QUALITY_SYSTEM_UNCONFIRMED:'В задании есть порог, но не названа система проверки. Отчёт можно сохранить для разбора, положительную приёмку подтвердить нельзя.',
 QUALITY_REPORT_INVALID:'Проверьте систему, номер и дату отчёта, основание и порог из паспорта (если установлен), результат и файл PDF до 5 МБ.',
 QUALITY_REPORT_NOT_FOUND:'Сохранённый PDF отчёта не найден. Откройте историю проверки и выберите запись с отчётом.',
 QUALITY_EVIDENCE_REQUIRED:'Для итоговой приёмки нужны сохранённые положительные внутренняя проверка и внешний отчёт для этой версии Word.',
 QUALITY_REVIEW_STALE:'Основания проверки изменились. Повторите итоговую проверку этой версии Word перед передачей.',
 QUALITY_CONFLICT:'Этот номер сохранения уже использован с другими данными. Откройте проверку заново и сохраните новую запись.',
 QUALITY_INVALID:'Заполните результат и пояснение проверки; проверьте отмеченные поля.',
 QUALITY_SCAN_INVALID:'Внутренняя проверка не подтверждена. Запустите сравнение сохранённого Word заново.',
 QUALITY_UNAVAILABLE:'Сервис проверки сейчас недоступен или не удалось прочитать Word. Повторите позже; при повторном отказе проверьте, что файл открывается в Word.'
};
export function qualityError(code){const safe=Object.hasOwn(messages,code)?code:'QUALITY_UNAVAILABLE';return {code:safe,error:messages[safe]};}
const fail=(code,status=409)=>({status,data:qualityError(code)});
const clean=e=>e?{id:e.id,kind:e.kind,payload:e.payload,createdAt:e.created_at,reportHash:e.report_hash}:null;
async function scan(db,id,version,bindings){
 const [v]=await db('studkab_result_versions?select=docx_base64,file_hash&id=eq.'+version+'&request_id=eq.'+id);
 if(!v||v.file_hash!==bindings.fileHash)throw Error('QUALITY_STALE');
 const extracted=await inspectWord(Uint8Array.from(atob(v.docx_base64),c=>c.charCodeAt(0)));
 if(extracted.fileHash!==bindings.fileHash)throw Error('QUALITY_STALE');
 const all=await db('studkab_request_attachments?request_id=eq.'+id+'&select=id,supersedes,category,file_name,file_hash,extracted_text&order=id.asc');
 const sources=currentAttachments(all).filter(a=>a.category==='sources').sort((a,b)=>a.id.localeCompare(b.id));
 const report=await scanInternalBorrowing({text:extracted.text,fileHash:extracted.fileHash,sources:sources.map(a=>({id:a.id,text:a.extracted_text||''}))});
 report.sourceDescriptors=sources.map(a=>({id:a.id,name:a.file_name,fileHash:a.file_hash}));
 report.textScope='word/document.xml body paragraphs; excludes headers, footnotes and images';
 const sourceBindings=sources.map(a=>({id:a.id,fileHash:a.file_hash}));
 const scanHash=await digest({report,sourceBindings});
 return {scan:report,scanHash,sourceBindings};
}
export async function qualityAction(input,user,{db,config}){
 const cfg=await config();if(!user.email||user.email.toLowerCase()!==cfg.executor_email?.toLowerCase())return fail('QUALITY_FORBIDDEN',403);
 if(!uuid.test(input.id||''))return fail('QUALITY_INVALID',400);
 try{
  if(input.action==='quality-report'){
   if(!uuid.test(input.evidenceId||''))return fail('QUALITY_INVALID',400);
   const [e]=await db('studkab_quality_evidence?select=payload,report_base64,report_hash&id=eq.'+input.evidenceId+'&request_id=eq.'+input.id);
   if(!e?.report_base64)return fail('QUALITY_REPORT_NOT_FOUND',404);
   return {data:{reportName:e.payload.reportName,reportBase64:e.report_base64,reportHash:e.report_hash}};
  }
  if(!uuid.test(input.versionId||''))return fail('QUALITY_INVALID',400);
  const state=await db('rpc/studkab_quality_check','POST',{p_request:input.id,p_version:input.versionId});
  const bindings=state?.bindings;
  if(typeof state?.eligible!=='boolean'||!bindings||!uuid.test(bindings.passportId||''))return fail('QUALITY_UNAVAILABLE');
  if(input.action==='quality-state'){
   const kinds=['internal_borrowing','external_originality'];
   const rows=(await Promise.all(kinds.map(k=>db('studkab_quality_evidence?select=id,kind,payload,created_at,report_hash&version_id=eq.'+input.versionId+'&kind=eq.'+k+'&order=sequence.desc&limit=1')))).flat();
   return {data:{bindings,thresholdRequirement:bindings.thresholdRequirement,eligible:state.eligible,blockingCodes:state.blockingCodes,latest:Object.fromEntries(['internal_borrowing','external_originality'].map(k=>[k,clean(rows.find(e=>e.kind===k))]))}};
  }
  if(input.action==='quality-scan'){const computed=await scan(db,input.id,input.versionId,bindings);return {data:{scan:computed.scan,scanHash:computed.scanHash}};}
  if(input.action!=='quality-save'||!uuid.test(input.evidenceId||''))return fail('QUALITY_INVALID',400);
  for(const k of ['recipientId','passportId','fileHash','documentHash','sourceFingerprint'])if(input[k]!==bindings[k])return fail('QUALITY_STALE');
  const p=input.payload;if(!p||!['pass','fail','manual'].includes(p.disposition)||typeof p.notes!=='string'||p.notes.trim().length<10||p.notes.length>4000)return fail('QUALITY_INVALID',400);
  let payload,report=null;
  if(input.kind==='internal_borrowing'){
   const computed=await scan(db,input.id,input.versionId,bindings);
   if(p.scanHash!==computed.scanHash)return fail('QUALITY_SCAN_STALE');
   const decisions=p.findingDecisions??[];
   if(!Array.isArray(decisions)||decisions.length>100||decisions.some(d=>!d||typeof d.findingId!=='string'||d.findingId.length>150||!['explained','needs_revision'].includes(d.disposition)||typeof d.notes!=='string'||d.notes.length>2000))return fail('QUALITY_INVALID',400);
   const ids=computed.scan.matches.map(f=>f.id),complete=computed.scan.status!=='not_checked'&&computed.scan.scope.usableSources>0&&computed.scan.scope.usableSources===computed.scan.scope.providedSources&&!computed.scan.limits.truncated;
   if(p.disposition==='pass'&&!complete)return fail('QUALITY_SCAN_INCOMPLETE');
   if(p.disposition==='pass'&&(decisions.length!==ids.length||new Set(decisions.map(d=>d.findingId)).size!==ids.length||decisions.some(d=>!ids.includes(d.findingId)||d.disposition!=='explained'||typeof d.notes!=='string'||d.notes.trim().length<10||d.notes.length>2000)))return fail('QUALITY_FINDING_UNREVIEWED');
   payload={disposition:p.disposition,notes:p.notes.trim(),scan:computed.scan,scanHash:computed.scanHash,sourceBindings:computed.sourceBindings,scanComplete:complete,findingIds:ids,findingDecisions:decisions};
  }else if(input.kind==='external_originality'){
   for(const [k,max] of [['service',200],['checkId',300],['thresholdBasis',4000],['reportName',200]])if(typeof p[k]!=='string'||!p[k].trim()||p[k].length>max)return fail('QUALITY_REPORT_INVALID',400);
   const rule=bindings.thresholdRequirement,mode=rule?.mode;
   if(!['university_threshold','university_threshold_no_service','university_no_threshold','service_only'].includes(mode)||p.thresholdItemId!=='ANTIPLAGIARISM'||p.thresholdBasis!==rule.text||p.requirementConfirmed!==true||p.wordBindingConfirmed!==true||p.thresholdMode!==mode||!Number.isFinite(p.actualPercent)||p.actualPercent<0||p.actualPercent>100||!Number.isFinite(Date.parse(p.checkedAt))||Date.parse(p.checkedAt)>Date.now()+300000)return fail('QUALITY_REPORT_INVALID',400);
   if(mode==='university_threshold'?(p.service!==rule.service||p.thresholdPercent!==rule.thresholdPercent):mode==='university_threshold_no_service'?(rule.service!==''||p.thresholdPercent!==rule.thresholdPercent):((mode==='university_no_threshold'&&p.service!==rule.service)||p.thresholdPercent!==null))return fail('QUALITY_REPORT_INVALID',400);
   if(p.disposition==='pass'&&mode==='university_threshold_no_service')return fail('QUALITY_SYSTEM_UNCONFIRMED');
   if(p.disposition==='pass'&&mode==='university_threshold'&&p.actualPercent<p.thresholdPercent)return fail('QUALITY_BELOW_THRESHOLD');
   if(typeof p.reportBase64!=='string'||p.reportBase64.length>6990508||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.reportBase64))return fail('QUALITY_REPORT_INVALID',400);
   const bytes=Uint8Array.from(atob(p.reportBase64),c=>c.charCodeAt(0));if(bytes.length<5||bytes.length>5242880||!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(new TextDecoder().decode(bytes.slice(0,12)))||!/%%EOF\s*$/.test(new TextDecoder().decode(bytes.slice(-1024))))return fail('QUALITY_REPORT_INVALID',400);
   report=p.reportBase64;payload=Object.fromEntries(['service','checkId','checkedAt','thresholdMode','thresholdPercent','actualPercent','thresholdItemId','thresholdBasis','requirementConfirmed','wordBindingConfirmed','disposition','notes','reportName'].map(k=>[k,p[k]]));
  }else return fail('QUALITY_INVALID',400);
  const e=await db('rpc/studkab_quality_save','POST',{p_request:input.id,p_version:input.versionId,p_id:input.evidenceId,p_actor:user.id,p_recipient:bindings.recipientId,p_passport:bindings.passportId,p_file_hash:bindings.fileHash,p_document_hash:bindings.documentHash,p_source_fingerprint:bindings.sourceFingerprint,p_kind:input.kind,p_payload:payload,p_report_base64:report});
  if(!uuid.test(e?.id||''))return fail('QUALITY_UNAVAILABLE');return {data:{evidence:clean(e)}};
 }catch(e){const code=/\bQUALITY_[A-Z_]+\b/.exec(String(e?.message))?.[0];return fail(code||'QUALITY_UNAVAILABLE');}
}
