// Arithmetic diagnostic for one explicitly described calculation. This module
// cannot establish that the passport lists every required calculation, and its
// result must never be mapped directly to a passport pass or delivery gate.
const decimal=/^-?(?:0|[1-9]\d{0,11})(?:[.,]\d{1,6})?$/;
const power=n=>10n**BigInt(n);
const parsed=value=>{
 if(typeof value!=='string'||!decimal.test(value))return null;
 const negative=value.startsWith('-'),[whole,fraction='']=value.replace('-','').replace(',','.').split('.');
 return {n:(negative?-1n:1n)*BigInt(whole+fraction),d:power(fraction.length)};
};
const reduced=({n,d})=>{
 if(d<0n){n=-n;d=-d;}
 let a=n<0n?-n:n,b=d;
 while(b){const t=a%b;a=b;b=t;}
 return {n:n/a,d:d/a};
};
const calculate=(op,a,b)=>{
 if(op==='add')return reduced({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
 if(op==='subtract')return reduced({n:a.n*b.d-b.n*a.d,d:a.d*b.d});
 if(op==='multiply')return reduced({n:a.n*b.n,d:a.d*b.d});
 if(op==='divide'&&b.n!==0n)return reduced({n:a.n*b.d,d:a.d*b.n});
 return null;
};
const rounded=(value,places)=>{
 const scaled=value.n*power(places),abs=scaled<0n?-scaled:scaled;
 const integer=(abs/value.d)+(abs%value.d*2n>=value.d?1n:0n);
 return scaled<0n?-integer:integer;
};
const count=(haystack,needle)=>haystack.split(needle).length-1;
const hasNumber=(text,value)=>{
 const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/[.,]/g,'[.,]');
 return new RegExp('(^|[^\\d.,])'+escaped+'(?=$|[^\\d.,]|[.,](?=\\s|$))','u').test(text);
};
const oneParagraph=(text,quote)=>
 String(text||'').split('\n').filter(paragraph=>paragraph===quote).length===1;
const onlyPeriod=(text,period)=>{
 const years=new Set(text.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/gu)||[]);
 return years.size===1&&years.has(period);
};
const error=(status,reason)=>({status,reason});

export function verifyCalculationEvidence(packet,claim){
 if(!packet||!claim||!Array.isArray(packet.passport?.items)||!Array.isArray(packet.materials)||
  typeof packet.word?.text!=='string')return error('not_checked','context_missing');
 if(!/^[a-f0-9]{64}$/i.test(claim.wordHash||'')||claim.wordHash!==packet.word.fileHash||
  !claim.passportFingerprint||claim.passportFingerprint!==packet.passport.sourceFingerprint)
  return error('not_checked','version_mismatch');
 if(packet.word.textCoverage?.unreadParts?.length)return error('not_checked','word_incomplete');
 const item=packet.passport.items.find(row=>row.id===claim.requirementId);
 if(!item||!item.source_attachment_id)return error('not_checked','requirement_unlinked');
 if(!['add','subtract','multiply','divide'].includes(claim.operation)||
  !Array.isArray(claim.operands)||claim.operands.length!==2||
  !Number.isInteger(claim.decimals)||claim.decimals<0||claim.decimals>6)
  return error('not_checked','method_unsupported');
 if(typeof claim.period!=='string'||!/^\d{4}$/.test(claim.period)||
  typeof claim.unit!=='string'||!claim.unit.trim()||claim.unit.length>40||
  typeof claim.wordQuote!=='string'||claim.wordQuote.length>2000||
  !oneParagraph(packet.word.text,claim.wordQuote)||
  !onlyPeriod(claim.wordQuote,claim.period)||!claim.wordQuote.includes(claim.unit))
  return error('not_checked','word_evidence_missing');
 const values=[];
 for(const operand of claim.operands){
  if(!operand||typeof operand!=='object')return error('not_checked','source_evidence_missing');
  const source=packet.materials.find(m=>m.id===operand.sourceId);
  if(!source||operand.sourceId!==item.source_attachment_id)
   return error('not_checked','source_mismatch');
  if(typeof source.text!=='string'||typeof operand.sourceQuote!=='string'||
   operand.sourceQuote.length>2000||
   !operand.sourceQuote.trim()||count(source.text,operand.sourceQuote)!==1||
   !onlyPeriod(operand.sourceQuote,claim.period)||!operand.sourceQuote.includes(claim.unit)||
   !hasNumber(operand.sourceQuote,operand.value||''))
   return error('not_checked','source_evidence_missing');
  const value=parsed(operand.value);
  if(!value)return error('not_checked','number_unsupported');
  values.push(value);
 }
 const result=parsed(claim.result);
 if(!result||!hasNumber(claim.wordQuote,claim.result||''))
  return error('not_checked','result_evidence_missing');
 const fraction=claim.result.split(/[.,]/)[1]||'';
 if(fraction.length!==claim.decimals)return error('not_checked','rounding_unsupported');
 const calculated=calculate(claim.operation,...values);
 if(!calculated)return error('not_checked','method_unsupported');
 if(rounded(calculated,claim.decimals)!==result.n*power(claim.decimals)/result.d)
  return error('fail','arithmetic_mismatch');
 return {status:'verified_arithmetic',reason:'single_operation_only',wordHash:claim.wordHash,
  requirementId:claim.requirementId};
}
