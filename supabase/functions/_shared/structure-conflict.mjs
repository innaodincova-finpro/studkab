// A narrow check of numbered headings in each original document. Repeated
// references to the same heading are not a conflict; two nearby titles with
// the same number are. Unknown structure remains unknown, never approved here.
export function duplicateNumberedHeadings(text=''){
 const matches=[];
 const pattern=/(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,2}){1,2})[ \t]+([^\n]{5,180})/gu;
 for(const match of String(text).matchAll(pattern)){
  const title=match[2].replace(/\.{3,}\s*\d*\s*$/u,'').trim().replace(/\s+/gu,' ').toLocaleLowerCase();
  if(!title||/^(?:таблица|рисунок|формула)\s/iu.test(title))continue;
  matches.push({number:match[1],title,display:match[2].trim().slice(0,180),offset:match.index});
 }
 const conflicts=[];
 for(let i=0;i<matches.length;i++){
  const current=matches[i];
  for(let j=i-1;j>=0&&current.offset-matches[j].offset<2000;j--){
   const prior=matches[j];
   if(prior.number!==current.number||prior.title===current.title||prior.title.startsWith(current.title)||current.title.startsWith(prior.title))continue;
   conflicts.push({number:current.number,first:prior.display,second:current.display});break;
  }
  if(conflicts.length===3)break;
 }
 return conflicts;
}

export function structureConflicts(attachments=[]){
 for(const file of attachments){
  if(!['assignment','methodology'].includes(file.category))continue;
  const conflicts=duplicateNumberedHeadings(file.extracted_text);
  if(conflicts.length)return {fileName:String(file.file_name||'приложенный документ').slice(0,180),fileHash:file.file_hash,conflicts};
 }
 return null;
}

export function structureFindings(attachments=[],items=[]){
 const item=items.find(q=>q?.id==='STRUCTURE');
 const resolutions=item?.structure_resolutions||[];
 const result=[];
 for(const file of attachments){
  if(!['assignment','methodology'].includes(file.category))continue;
  const numbered=Array.from(String(file.extracted_text||'').matchAll(/(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,2}){1,2})[ \t]+[^\n]{5,180}/gu),m=>m[1]);
  for(const conflict of duplicateNumberedHeadings(file.extracted_text)){
   const resolved=item?.verified===true&&typeof item.source==='string'&&!!item.source.trim()&&!/нумерацию следует уточнить/iu.test(item.text||'')&&Array.isArray(resolutions)&&resolutions.some(r=>r&&r.fileHash===file.file_hash&&r.number===conflict.number&&r.first===conflict.first&&r.second===conflict.second&&r.verified===true&&typeof r.reason==='string'&&r.reason.trim().length>=10&&typeof r.chosenNumber==='string'&&/^\d{1,2}(?:\.\d{1,2}){1,2}$/u.test(r.chosenNumber)&&r.chosenNumber!==r.number&&r.chosenNumber.split('.').slice(0,-1).join('.')===r.number.split('.').slice(0,-1).join('.')&&!numbered.includes(r.chosenNumber)&&String(item.text).includes(r.chosenNumber)&&String(item.text).includes(r.second));
   result.push({fileName:String(file.file_name||'приложенный документ').slice(0,180),fileHash:file.file_hash,...conflict,resolved});
   if(result.length>=12)return result;
  }
 }
 return result;
}
