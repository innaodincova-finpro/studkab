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
