export function withContext(claim,parts){
 const preceding=parts.filter(p=>p.ordinal<claim.ordinal&&p.state==='done')
  .sort((a,b)=>a.ordinal-b.ordinal);
 if(preceding.some(p=>typeof p.result!=='string'))throw Error('CONTEXT_INVALID');
 const context=preceding.map(p=>'Сохранённая часть '+p.ordinal+':\n'+p.result).join('\n\n');
 let original='';
 if(claim.spec.prompt_ref!==undefined){
  original=claim.input?.prompts?.[claim.spec.prompt_ref];
  if(typeof original!=='string'||!original.trim())throw Error('CONTEXT_INVALID');
 }
 const prompt=original+claim.spec.prompt+(context?'\n\nСОХРАНЁННЫЕ ЧАСТИ ЭТОЙ ВЕРСИИ:\n'+context:'');
 if(typeof claim.input?.system!=='string'||claim.input.system.length+prompt.length>180000)
  throw Error('CONTEXT_TOO_BIG');
 return {...claim,spec:{...claim.spec,prompt}};
}
