const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const markers=/\[(?:ДАННЫЕ СТУДЕНТА|СФОРМУЛИРОВАТЬ САМОСТОЯТЕЛЬНО|ПРОВЕРИТЬ ИСТОЧНИК|выше\/ниже|соответствует\/не соответствует|больше\/меньше)[^\]]*\]/i;
function paragraphs(content){
 const out=[];for(const part of Object.values(content?.structure||{}))for(const p of String(part?.text||'').split(/\n+/)){const n=p.trim().toLowerCase().replace(/\s+/g,' ');if(n.length>=120)out.push(n);}return out;
}
function result(code,{document,file,request}){
 const content=document.content||{},parts=Object.values(content.structure||{}),all=parts.map(x=>String(x?.text||'')).join('\n');
 if(code==='TXT-04')return !markers.test(all)&&parts.length>0&&parts.every(x=>String(x?.text||'').trim());
 if(code==='TXT-05'){const p=paragraphs(content);return new Set(p).size===p.length;}
 if(code==='DOC-06')return !!file&&file.state==='accepted'&&file.detected_mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 if(code==='DOC-07')return !!file&&file.sha256===document.docx_sha256;
 if(code==='DOC-08')return !!file&&!!request&&file.student_id===request.student_id;
 return null;
}
export async function runAutomaticChecks({input,user,db}){
 const documentId=String(input.payload.documentId||'');if(!UUID.test(documentId))throw Error('invalid_document');
 const document=await db('studkab_document_versions?id=eq.'+documentId+'&request_id=eq.'+input.requestId+'&select=id,passport_id,content,docx_file_id,docx_sha256','GET');
 if(!document)throw Error('document_not_found');
 const requirements=await db('studkab_requirement_items?passport_id=eq.'+document.passport_id+'&applicability=eq.applicable&verification_method=in.(automatic,combined)&select=id,code','GET');
 const file=document.docx_file_id?await db('studkab_request_files?id=eq.'+document.docx_file_id+'&select=id,student_id,state,detected_mime,sha256','GET'):null;
 const request=await db('studkab_requests?id=eq.'+input.requestId+'&select=id,student_id','GET');
 const list=Array.isArray(requirements)?requirements:requirements?[requirements]:[];
 const checks=list.map(r=>{const pass=result(r.code,{document,file,request});return {requirementId:r.id,status:pass===true?'pass':pass===false?'fail':'unable_to_verify',evaluatorType:'automatic',evidence:{check:r.code},comment:pass===null?'Критерий требует ручной или специализированной проверки':null,checkerVersion:'workflow-deterministic-1'};});
 return db('rpc/studkab_record_checks','POST',{request:input.requestId,command_id:input.commandId,actor:user.id,payload:{documentId,checks}});
}
export {result};
