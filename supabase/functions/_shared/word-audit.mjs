// Read-only observations from extracted DOCX body text. Never grants a quality pass.
export function auditWordText(text,fileHash){
 const lines=text.split('\n'),findings=[];
 const markers=/(?:\[(?:вставить|указать|заполнить|источник|ссылка|TODO|TBD)[^\]\n]{0,100}\]|\{\{[^}\n]{1,100}\}\})/gi;
 for(let i=0;i<lines.length&&findings.length<25;i++){
  for(const m of lines[i].matchAll(markers)){
   findings.push({kind:'unfinished_marker',line:i+1,excerpt:lines[i].slice(Math.max(0,m.index-50),m.index+Math.min(m[0].length+50,150))});
   if(findings.length===25)break;
  }
 }
 return {fileHash,scope:'Извлечённый основной текст DOCX; страницы, изображения, сноски и оформление не проверены.',
  lines:lines.length,words:(text.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[]).length,
  findings,limited:findings.length===25,verdict:'not_evaluated'};
}
