const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX=15728640;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
function ascii(bytes,start=0,end=bytes.length){return String.fromCharCode(...bytes.subarray(start,Math.min(end,bytes.length)));}
function zipNames(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)return null;
 const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
 if(!count||start+size>end)return null;
 const names=new Set();let pos=start;
 for(let i=0;i<count;i++){
  if(pos+46>bytes.length||view.getUint32(pos,true)!==0x02014b50)return null;
  const nameLength=view.getUint16(pos+28,true),extraLength=view.getUint16(pos+30,true),commentLength=view.getUint16(pos+32,true),local=view.getUint32(pos+42,true);
  if(pos+46+nameLength+extraLength+commentLength>bytes.length||local+30>bytes.length||view.getUint32(local,true)!==0x04034b50)return null;
  const name=ascii(bytes,pos+46,pos+46+nameLength),localNameLength=view.getUint16(local+26,true);
  if(name!==ascii(bytes,local+30,local+30+localNameLength))return null;
  names.add(name);pos+=46+nameLength+extraLength+commentLength;
 }
 return pos===start+size?names:null;
}
function detect(bytes,declared){
 if(bytes.length<4)return {error:'empty_or_truncated'};
 if(ascii(bytes,0,5)==='%PDF-'){
  const text=new TextDecoder('latin1').decode(bytes),tail=text.slice(-2048);
  const pages=(text.match(/\/Type\s*\/Page(?!s)\b/g)||[]).length;
  if(!tail.includes('%%EOF')||pages<1)return {error:'invalid_pdf'};
  if(pages>150)return {error:'page_limit'};
  return {mime:'application/pdf',pages};
 }
 if(bytes[0]===0x50&&bytes[1]===0x4b){
  const names=zipNames(bytes);if(!names)return {error:'invalid_zip'};
  if(names.has('[Content_Types].xml')&&names.has('word/document.xml'))return {mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  if(names.has('[Content_Types].xml')&&names.has('xl/workbook.xml'))return {mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  return {error:'unsupported_zip'};
 }
 if(bytes.length>24&&bytes[0]===0x89&&ascii(bytes,1,4)==='PNG'&&ascii(bytes,12,16)==='IHDR'&&textAtEnd(bytes,'IEND'))return {mime:'image/png'};
 if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9)return {mime:'image/jpeg'};
 if(bytes.length>12&&ascii(bytes,4,8)==='ftyp'&&/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii(bytes,8,12)))return {mime:'image/heic'};
 if(declared==='text/plain'||declared==='text/csv'){
  if(bytes.includes(0))return {error:'binary_text'};
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return {error:'invalid_utf8'};}
  if(!text.trim())return {error:'empty_text'};
  if(declared==='text/csv'&&!/[;,\t]/.test(text))return {error:'invalid_csv'};
  return {mime:declared};
 }
 return {error:'signature_mismatch'};
}
function textAtEnd(bytes,value){return ascii(bytes,Math.max(0,bytes.length-64)).includes(value);}
function objectUrl(base,path){return base+'/storage/v1/object/authenticated/studkab-private/'+path.split('/').map(encodeURIComponent).join('/');}
export async function verifyUpload({base,key,input,user,db,executor=false,request=fetch}){
 const fileId=String(input.payload.fileId||'');if(!UUID.test(fileId))throw Error('invalid_file');
 const ownerFilter=executor?'&purpose=eq.result_docx':'&student_id=eq.'+user.id+'&purpose=neq.result_docx';
 const rows=await db('studkab_request_files?id=eq.'+fileId+'&request_id=eq.'+input.requestId+ownerFilter+'&select=id,storage_path,declared_mime,size_bytes,state','GET');
 const file=Array.isArray(rows)?rows[0]:rows;if(!file)throw Error('file_not_found');
 if(file.state==='accepted'||file.state==='rejected')return {fileId,state:file.state,duplicate:true};
 if(file.state!=='uploading')throw Error('file_not_ready');
 const response=await request(objectUrl(base,file.storage_path),{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('object_not_found');
 const length=Number(response.headers.get('content-length')||0);if(length>MAX||(length&&length!==Number(file.size_bytes)))throw Error('size_mismatch');
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>MAX||bytes.length!==Number(file.size_bytes))throw Error('size_mismatch');
 const found=detect(bytes,file.declared_mime),accepted=!found.error&&found.mime===file.declared_mime;
 const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
 const result=await db('rpc/studkab_accept_upload','POST',{request:input.requestId,command_id:input.commandId,actor:null,payload:{fileId,accepted,detectedMime:found.mime||'application/octet-stream',sha256:digest,pageCount:found.pages||null,rejectionCode:accepted?null:(found.error||'mime_mismatch')}});
 return {...result,duplicate:false};
}
export {detect};
