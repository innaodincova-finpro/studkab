// Keep the normal passport and its approval gates. Semantic candidates add
// unverified obligations, never replace required checks or approve anything.
export function addIntakeCandidates(passport,context){
 if(!context||context.stale||passport.status&&passport.status!=='draft')return passport;
 const candidates=[...(context.analysis.requirements||[]).map((v,index)=>({...v,field:'requirement',index})),...['structure','length','formatting','data','sources'].flatMap(k=>(context.analysis.fields[k]?.values||[]).map((v,index)=>({...v,field:k,index})))];
 const additions=candidates.map((v,index)=>{
  const id='INTAKE_'+(index+1),a=context.answers['c:'+v.field+':'+v.index];
  const refs=v.refs||[],first=refs.find(r=>r.fileId),source=refs.map(r=>`${r.fileName||'Примечание студента'}: ${r.quote}`).join('\n');
  const note=v.condition?' Условие: '+v.condition+'. Ответ студента: '+({applies:'применяется',not_applies:'не применяется',unknown:'не знает — требуется уточнение'}[a?.type]||'не подтверждён')+'.':'';
  const text=v.value+note;
  if(text.length>2000||source.length>1000||!source.trim())throw Error('Кандидат требований требует отдельного уточнения: текст или источники превышают предел паспорта. Исходные документы сохранены');
  return {id,category:['length','formatting'].includes(v.field)?'measurable':'expert',required:true,verified:false,answer_ids:[],text,source,...(first?{source_attachment_id:first.fileId}:{})};
 }).filter(item=>!passport.items.some(old=>old.id===item.id));
 if(passport.items.length+additions.length>100)throw Error('В комплекте больше требований, чем допускает текущий паспорт. Требования не обрезаны; требуется расширение паспорта перед утверждением');
 return additions.length?{...passport,items:passport.items.concat(additions)}:passport;
}
