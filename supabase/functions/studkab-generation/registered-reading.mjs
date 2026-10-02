import {READER_VERSION} from '../studkab-requests/structured-reader.mjs';
// Runs only within the authenticated machine handler. Never calls an AI provider.
export async function runRegisteredReading({rpc,loadIntake,readIntake}){
 let claim;
 try{claim=await rpc('studkab_registered_read_claim',{p_version:READER_VERSION});}
 catch{return {status:'registered_read_claim_unavailable'};}
 if(!claim)return null;
 const f=claim.file;let result;
 try{
  const bytes=await loadIntake(f.storage_path,f.size_bytes,f.file_hash);
  result=await readIntake(bytes,f.content_type);
 }catch{
  result={schema:1,readerVersion:READER_VERSION,status:'failed',blocks:[],warnings:[{code:'reading_unavailable',source:{}}],extracted_text:''};
 }
 result={...result,fileId:f.id,fileHash:f.file_hash};
 try{
  const saved=await rpc('studkab_registered_read_finish',{p_request:claim.request_id,p_revision:claim.revision,p_file:f.id,p_lease:f.read_lease,p_version:READER_VERSION,p_result:result});
  return {status:saved.saved?'registered_read_'+saved.status:saved.stale?'registered_read_stale':'registered_read_invalid',request:claim.request_id};
 }catch{return {status:'registered_read_save_unconfirmed',request:claim.request_id};}
}
