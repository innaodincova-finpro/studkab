// Server-only OneDrive conversion candidate. Caller must provide an authenticated,
// short-lived delegated Files.ReadWrite token; never pass the token from the browser.
const ROOT='https://graph.microsoft.com/v1.0';
const sha=/^[a-f0-9]{64}$/;
const safeFailures=new Set(['GRAPH_UPLOAD_FAILED','GRAPH_ITEM_UNCONFIRMED','GRAPH_CONTENT_TOO_LARGE',
 'GRAPH_EMPTY_CONTENT','GRAPH_UPLOADED_WORD_MISMATCH','GRAPH_CONVERSION_FAILED','GRAPH_PDF_INVALID']);
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
 .map(b=>b.toString(16).padStart(2,'0')).join('');
async function limited(response,max){
 if(Number(response.headers.get('content-length'))>max)throw Error('GRAPH_CONTENT_TOO_LARGE');
 if(!response.body)throw Error('GRAPH_EMPTY_CONTENT');
 const reader=response.body.getReader(),parts=[];let length=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;
  length+=value.byteLength;if(length>max)throw Error('GRAPH_CONTENT_TOO_LARGE');parts.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 const out=new Uint8Array(length);let at=0;
 for(const part of parts){out.set(part,at);at+=part.length;}
 return out;
}
function itemId(value){
 const id=value?.id;
 if(typeof id!=='string'||!id||id.length>200)
  throw Error('GRAPH_ITEM_UNCONFIRMED');
 return id;
}

export async function convertWordViaOneDrive({wordBytes,expectedHash,accessToken,journal,fetcher=fetch}){
 if(!(wordBytes instanceof Uint8Array)||wordBytes.length<22||wordBytes.length>3*1024*1024||
  wordBytes[0]!==80||wordBytes[1]!==75||!sha.test(expectedHash||'')||
  typeof accessToken!=='string'||!accessToken||accessToken.length>10000||
  typeof journal?.begin!=='function'||typeof journal?.cleared!=='function')
  throw Error('GRAPH_INPUT_INVALID');
 if(await hash(wordBytes)!==expectedHash)throw Error('GRAPH_WORD_STALE');
 const headers={Authorization:`Bearer ${accessToken}`};
 async function call(url,method='GET',body){
  // Fetch drops Authorization when following a redirect to a different origin.
  return fetcher(url,{method,headers:body===undefined?headers:{...headers,'Content-Type':'application/octet-stream'},
   body,signal:AbortSignal.timeout(30000)});
 }
 // Obtain drive ID before writing anything: upload responses need not include
 // parentReference.driveId, but permanentDelete requires the drive ID.
 let drive;
 try{const response=await call(`${ROOT}/me/drive`);
  if(!response.ok)throw Error('GRAPH_DRIVE_UNAVAILABLE');
  drive=itemId(await response.json());
 }catch{throw Error('GRAPH_DRIVE_UNAVAILABLE');}
 const name=`studkab-${crypto.randomUUID()}.docx`;
 const path=`${ROOT}/me/drive/root:/${encodeURIComponent(name)}`;
 // begin must durably commit the drive, unique name and source hash before PUT.
 // A process crash after PUT can then be reconciled without uploading again.
 try{await journal.begin({driveId:drive,name,sourceSha256:expectedHash});}
 catch{throw Error('GRAPH_JOURNAL_UNAVAILABLE');}
 async function lookup(){
  const response=await call(path);
  if(response.status===404)return null;
  if(!response.ok)throw Error('GRAPH_LOOKUP_FAILED');
  return itemId(await response.json());
 }
 let item,pdfBytes,failure;
 try{
  // Unique name prevents overwriting a previous attempt. Never retry the PUT.
  const uploaded=await call(`${path}:/content`,'PUT',wordBytes);
  if(!uploaded.ok)throw Error('GRAPH_UPLOAD_FAILED');
  item=itemId(await uploaded.json());
  const source=await call(`${ROOT}/me/drive/items/${encodeURIComponent(item)}/content`);
  if(!source.ok||await hash(await limited(source,3*1024*1024))!==expectedHash)
   throw Error('GRAPH_UPLOADED_WORD_MISMATCH');
  const converted=await call(`${ROOT}/me/drive/items/${encodeURIComponent(item)}/content?format=pdf`);
  if(!converted.ok)throw Error('GRAPH_CONVERSION_FAILED');
  pdfBytes=await limited(converted,32*1024*1024);
  if(pdfBytes.length<5||new TextDecoder().decode(pdfBytes.subarray(0,5))!=='%PDF-')
   throw Error('GRAPH_PDF_INVALID');
 }catch(error){
  // Do not disclose Graph's response body, token, user path or document text.
  failure=safeFailures.has(error.message)?error.message:'GRAPH_RESULT_UNCONFIRMED';
 }
 // A lost upload response may still have created the file. Look it up by the
 // unique name, then permanently delete. A 404 after such a failure does not
 // prove whether a file was ever created; mark cleanup uncertain.
 let cleared=false;
 try{
  if(!item)item=await lookup();
  if(item){
   const removed=await call(`${ROOT}/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(item)}/permanentDelete`,'POST');
   if(removed.status===204){const after=await call(path);cleared=after.status===404;}
  }
 }catch{ /* cleanup remains unconfirmed */ }
 if(!cleared)throw Error('GRAPH_TEMP_FILE_UNCONFIRMED');
 try{await journal.cleared({driveId:drive,name});}
 catch{throw Error('GRAPH_JOURNAL_UNAVAILABLE');}
 if(failure)throw Error(failure);
 return {pdfBytes,sourceSha256:expectedHash,pdfSha256:await hash(pdfBytes),converter:'Microsoft Graph DOCX to PDF'};
}

// Called by a separate server recovery worker for entries left pending after a
// crash. The caller supplies a fresh delegated token for the same drive and a
// durable journal; no PDF is reused. Unknown outcomes remain pending.
export async function recoverOneDriveTempFile({entry,accessToken,journal,fetcher=fetch}){
 if(typeof entry?.driveId!=='string'||!entry.driveId||entry.driveId.length>200||
  !/^studkab-[a-f0-9-]{36}\.docx$/i.test(entry.name||'')||!sha.test(entry.sourceSha256||'')||
  typeof accessToken!=='string'||!accessToken||accessToken.length>10000||
  typeof journal?.cleared!=='function')throw Error('GRAPH_INPUT_INVALID');
 const headers={Authorization:`Bearer ${accessToken}`};
 const path=`${ROOT}/drives/${encodeURIComponent(entry.driveId)}/root:/${encodeURIComponent(entry.name)}`;
 try{
  const found=await fetcher(path,{method:'GET',headers,signal:AbortSignal.timeout(30000)});
  if(!found.ok)throw Error('GRAPH_TEMP_FILE_UNCONFIRMED');
  const id=itemId(await found.json());
  const removed=await fetcher(`${ROOT}/drives/${encodeURIComponent(entry.driveId)}/items/${encodeURIComponent(id)}/permanentDelete`,
   {method:'POST',headers,signal:AbortSignal.timeout(30000)});
  if(removed.status!==204)throw Error('GRAPH_TEMP_FILE_UNCONFIRMED');
  const after=await fetcher(path,{method:'GET',headers,signal:AbortSignal.timeout(30000)});
  if(after.status!==404)throw Error('GRAPH_TEMP_FILE_UNCONFIRMED');
 }catch{throw Error('GRAPH_TEMP_FILE_UNCONFIRMED');}
 try{await journal.cleared({driveId:entry.driveId,name:entry.name});}
 catch{throw Error('GRAPH_JOURNAL_UNAVAILABLE');}
 return {cleared:true};
}
