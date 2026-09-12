// Chunking is an execution bound, not proof of academic completeness.
export function expandParts(parts,cost){
 const plan=[];
 for(const p of parts){
  const target=p.target_chars==null?4500:p.target_chars;
  if(!Number.isSafeInteger(target)||target<1||target>200000)throw Error('INVALID_TARGET');
  const count=Math.ceil(target/4500);
  for(let i=0;i<count;i++){
   const id=count===1?p.id:p.id+'__part_'+(i+1);
   const prompt=p.prompt+'\n\nОГРАНИЧЕНИЕ ТЕКУЩЕГО ЗАПРОСА: исходное задание выше относится ко всему разделу. '+
    'Сейчас напиши только часть '+(i+1)+' из '+count+' раздела '+p.id+'. '+
    'Ориентир этой части — '+Math.ceil(target/count)+' знаков с пробелами. '+
    'Продолжай сохранённые части, не повторяй их. Раздели содержание по смыслу; '+
    'не начинай новое введение и не пиши заключение всего раздела до последней части. '+
    'Не выдумывай факты, числа или источники для заполнения объёма.';
   plan.push({id,section_id:p.id,part_index:i,part_count:count,prompt,max_cost_microusd:cost});
   if(plan.length>100)throw Error('TOO_MANY_PARTS');
  }
 }
 if(new Set(plan.map(p=>p.id)).size!==plan.length)throw Error('DUPLICATE_PART');
 return plan;
}
