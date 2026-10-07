import {READER_VERSION} from './structured-reader.mjs';
export async function intakeRead(input,user,{db,loadIntake,readIntake}){
 const reserved=await db('rpc/studkab_intake_read_begin','POST',{p_student:user.id,p_draft:input.id,p_file:input.fileId,p_version:READER_VERSION});
 if(reserved.missing)return {status:404,data:{error:'Файл не найден'}};
 if(reserved.busy)return {data:{reading:{status:'reading'},retryAfter:90}};
 const file=reserved.file;if(!file)throw Error('Reading unavailable');
 if(reserved.cached)return {data:{reading:file.read_result,cached:true}};
 let reading;
 try{
  const bytes=await loadIntake(file.storage_path,file.size_bytes,file.file_hash);
  reading=await readIntake(bytes,file.content_type);
 }catch{
  // Unexpected parser/transport failure is recoverable, never interpreted as empty successful reading.
  reading={schema:1,readerVersion:READER_VERSION,status:'failed',blocks:[],warnings:[{code:'reading_unavailable',source:{}}],extracted_text:''};
 }
 reading={...reading,fileId:file.id,fileHash:file.file_hash};
 const result=await db('rpc/studkab_intake_read_finish','POST',{p_student:user.id,p_draft:input.id,p_file:file.id,p_lease:file.read_lease,p_version:READER_VERSION,p_result:reading});
 if(result.missing)return {status:404,data:{error:'Файл не найден'}};
 if(result.conflict)return {status:409,data:{error:'Чтение уже продолжено в другом окне. Откройте материалы заново'}};
 if(result.invalid)throw Error('Invalid reading result');
 return {data:{reading:result.file.read_result,cached:false}};
}
export async function loadOriginal({base,key,path,size,hash,bucket='studkab-intake-materials',fetcher=fetch}){
 if(!['studkab-intake-materials','studkab-request-materials'].includes(bucket))throw Error('Invalid storage');
 const response=await fetcher(base+'/storage/v1/object/'+bucket+'/'+path,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body)throw Error('Storage unavailable');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>size||length>5242880)throw Error('Storage mismatch');chunks.push(value);}}catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
 if(length!==size)throw Error('Storage mismatch');const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
 if(actual!==hash)throw Error('Storage mismatch');return bytes;
}
