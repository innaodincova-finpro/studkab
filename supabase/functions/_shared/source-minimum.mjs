import {currentAttachments} from './current-attachments.mjs';
import {structureFindings} from './structure-conflict.mjs';
// Deliberately narrow evidence extraction; unmatched prose is NOT verified.
export function explicitMinima(text='') {
 const value=String(text).replace(/\r/g,'');
 const patterns=[
  /(?:не\s+менее|минимум)\s+(\d{1,4})\s+(?:библиографических\s+)?источник[а-я]*/giu,
  /минимальн(?:ое\s+(?:количество|число)|ый\s+объём)\s+источников\s*[:—–-]?\s*(\d{1,4})(?![\d.,])/giu,
  /(?:список\s+(?:использованных\s+)?источников)[^\n.!?]{0,100}(?:\n[ \t]*\n?)?[ \t]*(?:не\s+менее|минимум)\s+(\d{1,4})\s+позиций/giu
 ];
 return patterns.flatMap(pattern=>Array.from(value.matchAll(pattern)).filter(m=>{
  // Only unqualified totals. Subset/age/language requirements need human review.
  const before=value.slice(Math.max(0,m.index-512),m.index).split(/[.!?;\n]/u).at(-1);
  const after=value.slice(m.index+m[0].length);
  if(/из\s+них|в\s+том\s+числе|среди\s+них|иностранн|зарубежн|отечественн|электронн|за\s+последни/iu.test(before))return false;
  return /^[ \t]*(?:$|[.;,!?:\n]|и\s+приложения(?:[.;,!?:\n]|$))/iu.test(after);
 }).map(m=>({minimum:Number(m[1]),quote:m[0].trim()}))).filter(x=>x.minimum>0);
}
export function findings({attachments=[],items=[]}={}) {
 const original=attachments.filter(a=>['assignment','methodology'].includes(a.category)).flatMap(a=>explicitMinima(a.extracted_text).map(x=>({...x,fileName:a.file_name,fileHash:a.file_hash})));
 const passport=items.flatMap(item=>explicitMinima(item.text).map(x=>({...x,itemId:item.id})));
 // One strongest original and at most 20 conflicting passport quotes suffice.
 // Avoid a Cartesian product of matches from uploaded documents.
 const strongest=original.reduce((max,source)=>!max||source.minimum>max.minimum?source:max,null);
 const conflicts=strongest?passport.filter(p=>p.minimum<strongest.minimum).slice(0,20).map(p=>({source:strongest,passport:p})):[];
 return {status:conflicts.length?'conflict':original.length&&passport.length?'no_detected_conflict':'unparsed',conflicts,original,passport};
}
export async function sourceMinimumGuard(db,request,items) {
 if(!Array.isArray(items)||items.some(item=>!item||typeof item.text!=='string'))throw Error('Не удалось прочитать требования паспорта');
 const attachments=await db('studkab_request_attachments?request_id=eq.'+request+'&select=id,supersedes,category,file_name,file_hash,extracted_text');
 if(!Array.isArray(attachments))throw Error('Не удалось проверить исходные требования');
 const result=findings({attachments:currentAttachments(attachments),items});
 if(!result.conflicts.length){
  const structure=structureFindings(currentAttachments(attachments),items).find(x=>!x.resolved);
  if(structure)return {error:structure.tooMany?'В исходном файле '+structure.fileName+' слишком много неоднозначных номеров. Проверьте исправленную методичку вручную.':'В исходном файле '+structure.fileName+' повторён номер '+structure.number+' у разных разделов. Уточните нумерацию до утверждения паспорта.',code:'STRUCTURE_NUMBER_CONFLICT',findings:structure};
  return null;
 }
 const {source,passport}=result.conflicts[0];
 return {error:'Исходное задание требует минимум '+source.minimum+' источников, а паспорт — '+passport.minimum+'. Проверьте требования: '+(source.fileName||'приложенный документ')+'.',code:'SOURCE_MINIMUM_CONFLICT',findings:result.conflicts};
}
