import {parseReviewReport} from '../studkab-generation-api/review-pass.mjs';
export function withContext(claim,parts){
 const preceding=parts.filter(p=>p.ordinal<claim.ordinal&&p.state==='done')
  .filter(p=>typeof claim.spec?.section_id!=='string'||p.spec?.section_id===claim.spec.section_id)
  .sort((a,b)=>a.ordinal-b.ordinal);
 if(claim.input?.review_protocol===2&&claim.spec?.id==='quality_review'){
  const first=preceding.filter(p=>p.spec?.id==='quality_evidence');
  const packet=claim.input.review_packet,hash=claim.input.review_target?.fileHash;
  if(typeof hash!=='string'||!/^[a-f0-9]{64}$/i.test(hash)||claim.ordinal!==1||first.length!==1||first[0].ordinal!==0||packet?.word?.fileHash!==hash||!parseReviewReport(first[0].result,hash,packet))
   throw Error('REVIEW_FIRST_INVALID');
 }
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
