// Integrity check for a bundle returned by a trusted server-side renderer.
// Never use client-supplied pages as proof that a DOCX rendered this way.
const sha=/^[a-f0-9]{64}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const pngSignature=[137,80,78,71,13,10,26,10];
async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
 .map(b=>b.toString(16).padStart(2,'0')).join('');}
function png(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<33||bytes.length>6*1024*1024||
  pngSignature.some((value,i)=>bytes[i]!==value)||
  bytes[12]!==73||bytes[13]!==72||bytes[14]!==68||bytes[15]!==82)return false;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const width=view.getUint32(16),height=view.getUint32(20);
 return width>0&&height>0&&width<=4096&&height<=4096;
}

export async function bindVisualEvidence({wordBytes,version,passport,recipientId,rendered}){
 if(!(wordBytes instanceof Uint8Array)||!wordBytes.length||wordBytes.length>3*1024*1024||
  !uuid.test(version?.id)||!uuid.test(version?.request_id)||!uuid.test(version?.recipient_id)||
  !uuid.test(recipientId)||version.recipient_id!==recipientId||
  !sha.test(version.file_hash||'')||!sha.test(version.document_hash||'')||
  !uuid.test(passport?.id)||passport.request_id!==version.request_id||passport.status!=='approved'||
  !sha.test(passport.source_fingerprint||''))throw Error('VISUAL_BINDING_STALE');
 const sourceHash=await digest(wordBytes);
 if(sourceHash!==version.file_hash||rendered?.sourceSha256!==sourceHash)throw Error('VISUAL_SOURCE_MISMATCH');
 const pdf=rendered.pdfBytes;
 if(!(pdf instanceof Uint8Array)||pdf.length<5||pdf.length>32*1024*1024||
  new TextDecoder().decode(pdf.subarray(0,5))!=='%PDF-')throw Error('VISUAL_PDF_INVALID');
 const pages=rendered.pages,count=rendered.pageCount;
 if(!Number.isInteger(count)||count<1||count>200||!Array.isArray(pages)||pages.length!==count||
  typeof rendered.converter!=='string'||!rendered.converter.trim()||rendered.converter.length>200)
  throw Error('VISUAL_PAGES_INCOMPLETE');
 let total=0;const pageHashes=[];
 for(let i=0;i<count;i++){
  const page=pages[i];
  if(page?.number!==i+1||!png(page.bytes))throw Error('VISUAL_PAGES_INCOMPLETE');
  total+=page.bytes.length;
  if(total>64*1024*1024)throw Error('VISUAL_PAGES_TOO_BIG');
  pageHashes.push({number:i+1,sha256:await digest(page.bytes)});
 }
 return {requestId:version.request_id,versionId:version.id,recipientId,wordHash:sourceHash,
  documentHash:version.document_hash,passportId:passport.id,
  sourceFingerprint:passport.source_fingerprint,converter:rendered.converter.trim(),
  pdfSha256:await digest(pdf),pageCount:count,pages:pageHashes};
}

export function visualEvidenceCurrent(evidence,version,passport,recipientId){
 return !!evidence&&evidence.requestId===version?.request_id&&evidence.versionId===version?.id&&
  evidence.recipientId===recipientId&&version?.recipient_id===recipientId&&
  evidence.wordHash===version?.file_hash&&evidence.documentHash===version?.document_hash&&
  evidence.passportId===passport?.id&&passport?.status==='approved'&&
  passport?.request_id===version?.request_id&&evidence.sourceFingerprint===passport?.source_fingerprint;
}
