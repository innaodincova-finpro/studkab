// Unpaid planning from explicit assignment output items. Never infer chapters
// from discipline/work type or use a placeholder whole-document section.
function outputItems(text){
 const lines=String(text||'').split(/\r?\n/).map(x=>x.trim());
 const blocks=[];
 for(let i=0;i<lines.length;i++){
  if(!/^(?:Структура(?: работы)?|Задания|Вопросы(?: для ответа)?|Выполните следующие задания)\s*:?$/i.test(lines[i]))continue;
  const sections=[],numbers=new Set();
  for(let j=i+1;j<lines.length;j++){
   if(!lines[j])continue;
   const m=/^(\d+(?:\.\d+)*)[.)]?\s+(.{1,200})$/.exec(lines[j]);
   // Do not silently truncate a multiline task or miss following numbered
   // tasks. Ambiguous mixed prose requires richer planning, not partial scope.
   if(!m)return null;
   if(numbers.has(m[1]))return null;
   numbers.add(m[1]);sections.push('section_'+m[1].replaceAll('.','_'));
  }
  if(sections.length&&sections.length<=96)blocks.push(sections);
 }
 if(blocks.length!==1)return null;
 return blocks[0];
}
export async function sourceAssistantPlan({source,bundle},{readFile}){
 const candidates=[];
 for(const key of ['rq','mn']){
  const sections=outputItems(source.request.payload[key]);
  if(sections)candidates.push({sections,ref:'request.'+key});
 }
 for(const file of bundle.files){
  const read=await readFile(file.bytes,file.type);
  if(read?.status!=='ready'||read.warnings?.length||read.unread_parts?.length)continue;
  const sections=outputItems(read.extracted_text);
  if(sections)candidates.push({sections,ref:file.id});
 }
 // Multiple scopes may be contradictory: preserve the kit for planning, never
 // arbitrarily discard one source or append guessed output items.
 if(candidates.length!==1)return null;
 return {sections:candidates[0].sections,evidence:{method:'server-source-plan',sourceFingerprint:bundle.fingerprint,readerVersion:'explicit-output-items-v1',sourceRefs:[candidates[0].ref]}};
}
