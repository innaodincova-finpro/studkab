import {Buffer} from 'node:buffer';
import mammoth from 'npm:mammoth@1.12.3';
import {extractText as extractPdfText,getDocumentProxy} from 'npm:unpdf@1.8.1';

const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function normalize(value:string){return value.replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();}
export async function extract(bytes:Uint8Array,type:string){
 let value='';
 if(type==='text/plain')value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 else if(type===DOCX)value=(await mammoth.extractRawText({buffer:Buffer.from(bytes)})).value;
 else if(type==='application/pdf'){
  const pdf=await getDocumentProxy(bytes);const result=await extractPdfText(pdf,{mergePages:true});value=String(result.text||'');
 }
 value=normalize(value);
 if(!value||value.length>500000)throw Error('Extracted text unavailable');
 return value;
}
