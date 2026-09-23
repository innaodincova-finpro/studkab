export const materialPayloadFields=['mn','rq','org'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateMaterialManifest(value){
 if(value==null)return null;
 const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error('Проверьте перечень обязательных материалов');return v.trim();};
 if(typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.requirements)||value.requirements.length>100)throw Error('Проверьте перечень обязательных материалов');
 const seen=new Set();
 return {basis:text(value.basis,4000),requirements:value.requirements.map(r=>{
  if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Проверьте пункт материалов');
  const id=text(r.id,80),label=text(r.label,2000);
  if(!/^[A-Za-z0-9_-]+$/.test(id)||seen.has(id)||!label||typeof r.required!=='boolean')throw Error('Проверьте пункт материалов');seen.add(id);
  const refs=(key,valid)=>{const a=r[key]??[];if(!Array.isArray(a)||a.length>100||a.some(v=>typeof v!=='string'||!valid(v)))throw Error('Проверьте подтверждение материалов');return [...new Set(a)];};
  return {id,label,required:r.required,attachment_ids:refs('attachment_ids',v=>uuid.test(v)),answer_ids:refs('answer_ids',v=>uuid.test(v)),payload_fields:refs('payload_fields',v=>materialPayloadFields.includes(v)),not_applicable_reason:text(r.not_applicable_reason??'',2000)};
 })};
}
export function resetMaterialEvidence(value){
 if(!value)return null;
 try{value=validateMaterialManifest(value);}catch{return null;}
 return {...value,requirements:value.requirements.map(r=>({...r,attachment_ids:[],answer_ids:[],payload_fields:[],not_applicable_reason:''}))};
}
export async function materialManifestGuard(db,request,passport){
 const result=await db('rpc/studkab_material_manifest_check','POST',{p_request:request,p_passport:passport??null});
 if(result?.valid!==true)return {error:'Проверьте обязательные материалы паспорта: заполните перечень и подтвердите каждый необходимый материал.',code:result?.code||'MATERIAL_MANIFEST_REQUIRED',requirementId:result?.requirementId??null};
 return null;
}
