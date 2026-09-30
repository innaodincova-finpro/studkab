// Inventory of explicit numbered equations, not a semantic inventory of every
// calculation required by a task. Never converts arithmetic diagnostics to pass.
export function inventoryNumberedCalculations(packet){
 const entries=[],gaps=[],materials=packet?.materials;
 if(!Array.isArray(materials))return {status:'not_checked',entries,gaps:['materials_missing'],complete:false};
 const seenSources=new Set();
 for(const source of materials){
  if(!['assignment','methodology'].includes(source?.category))continue;
  if(typeof source.id!=='string'||seenSources.has(source.id)||
   !/^[a-f0-9]{64}$/i.test(source.fileHash||'')||typeof source.text!=='string'){
   gaps.push('source_context_invalid');continue;
  }
  seenSources.add(source.id);
  const seenNumbers=new Set(),lines=source.text.split('\n');
  for(let index=0;index<lines.length;index++){
   // References within prose and bibliographic lists are deliberately excluded.
   const match=lines[index].match(/\((\d{1,3}(?:\.\d{1,3}){0,2})\)\s*[,;.]?\s*$/u);
   if(!match)continue;
   const start=Math.max(0,index-5),quote=lines.slice(start,index+1).join('\n');
   // Some PDF fractions lose their operator in extraction. List the numbered
   // equation anyway, but retain the extracted excerpt rather than invent it.
   if(!quote.includes('='))continue;
   if(entries.length>=256){gaps.push('inventory_limit');break;}
   const repeated=seenNumbers.has(match[1]);seenNumbers.add(match[1]);
   if(repeated)gaps.push('duplicate_formula_number');
   entries.push({id:source.id+':'+match[1]+':'+(index+1),sourceId:source.id,
    sourceHash:source.fileHash,formulaNumber:match[1],sourceLine:index+1,
    sourceQuote:quote.slice(-2000),status:'not_checked',
    reason:repeated?'duplicate_formula_number':'method_and_instances_unverified'});
  }
 }
 if(!entries.length)gaps.push('numbered_formulas_not_found');
 // Unnumbered operations, repeated applications, tables, formula interpretation
 // and rounding rules require separate evidence. Even all numbers present is
 // not proof that this preliminary inventory is complete.
 gaps.push('unnumbered_and_repeated_calculations_unverified');
 return {status:'not_checked',complete:false,entries,gaps:[...new Set(gaps)]};
}
