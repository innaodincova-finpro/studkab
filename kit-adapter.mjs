import {KIT_FIELDS,KIT_REQUIREMENTS} from '../supabase/functions/_shared/kit-analysis.mjs';
export {toKit};
// KIT-02: прежние синтетические ответы переводятся в формат разбора всего комплекта (номера фрагментов вместо цитат).
const FIELD_NAME=Object.fromEntries(Object.entries(KIT_FIELDS).map(([k,v])=>[v,k])),REQ_NAME=Object.fromEntries(Object.entries(KIT_REQUIREMENTS).map(([k,v])=>[v,k]));
const ids=refs=>[...new Set((refs||[]).map(r=>r.blockId))];
function toKit(spec,x){
 if(spec.kind==='kit_extraction'){const file=b=>spec.blocks.find(v=>v.blockId===b)?.fileName;return {fields:x.candidates.filter(c=>FIELD_NAME[c.field]).map(c=>({field:FIELD_NAME[c.field],value:c.value,ids:ids(c.refs)})),requirements:x.candidates.filter(c=>REQ_NAME[c.field]).map(c=>({type:REQ_NAME[c.field],ids:ids(c.refs),condition:c.condition})),roles:x.roles.map(r=>({file:file(r.refs[0].blockId),role:r.role}))};}
 const strip=v=>{const {refs,covered,...rest}=v;return {...rest,ids:ids(refs)};};
 return {gaps:(x.gaps||[]).map(strip),answerReviews:(x.answerReviews||[]).map(strip),returnedReviews:(x.returnedReviews||[]).map(strip)};
}
export const kitAdapt=provider=>async c=>{const r=await provider(c);if(c.spec?.method!=='whole-kit-2'||typeof r?.text!=='string')return r;let x;try{x=JSON.parse(r.text);}catch{return r;}return {...r,text:JSON.stringify(toKit(c.spec,x))};};
