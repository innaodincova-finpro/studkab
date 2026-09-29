// Bounded DOCX inspection. The original bytes, not extracted text, are delivered.
export const MAX_WORD_BYTES=3145728;
const MAX_XML=8*1024*1024, MAX_EXPANDED=24*1024*1024;
const fail=()=>{throw Error('Не удалось прочитать DOCX. Сохраните документ в формате Word .docx без макросов и повторите выбор.');};
async function inflate(bytes,limit){
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
 let size=0,parts=[];
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>limit)fail();parts.push(r.value);}}
 finally{await reader.cancel().catch(()=>{});}
 const out=new Uint8Array(size);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;
}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function decodeXml(s){
 return s.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos);/gi,(_,n,e)=>{
  if(n){const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);if(!c||c>0x10ffff||(c>=0xd800&&c<=0xdfff))fail();return String.fromCodePoint(c);}
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()];
 });
}
export async function inspectWord(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX_WORD_BYTES)throw Error('Выберите непустой Word .docx размером до 3 МБ.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=i=>v.getUint16(i,true),u32=i=>v.getUint32(i,true);
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
 if(end<0||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))fail();
 const count=u16(end+10),dir=u32(end+16),dirSize=u32(end+12);
 if(!count||count>1024||dir+dirSize!==end)fail();
 let at=dir,total=0;const entries=new Map(),decoder=new TextDecoder('utf-8',{fatal:true});
 for(let i=0;i<count;i++){
  if(at+46>end||u32(at)!==0x02014b50)fail();
  const flags=u16(at+8),method=u16(at+10),crc=u32(at+16),packed=u32(at+20),size=u32(at+24),nl=u16(at+28),extra=u16(at+30),comment=u16(at+32),offset=u32(at+42);
  if(at+46+nl+extra+comment>end||flags&1||![0,8].includes(method)||size>MAX_XML||offset+30>dir)fail();
  const name=decoder.decode(bytes.subarray(at+46,at+46+nl));
  if(entries.has(name)||name.includes('..')||name.includes('\\')||/vbaproject|embeddings\/|activex\//i.test(name))fail();
  if(u32(offset)!==0x04034b50||u16(offset+8)!==method||u16(offset+6)!==flags)fail();
  const start=offset+30+u16(offset+26)+u16(offset+28);
  if(start+packed>dir||decoder.decode(bytes.subarray(offset+30,offset+30+u16(offset+26)))!==name)fail();
  total+=size;if(total>MAX_EXPANDED)fail();
  entries.set(name,{start,packed,size,method,crc});at+=46+nl+extra+comment;
 }
 if(at!==end||!entries.has('[Content_Types].xml')||!entries.has('word/document.xml'))fail();
 async function read(name){
  const e=entries.get(name);const data=bytes.subarray(e.start,e.start+e.packed),out=e.method===0?data:await inflate(data,e.size);
  if(out.length!==e.size||crc32(out)!==e.crc)fail();
  const text=decoder.decode(out);if(/<!DOCTYPE|<!ENTITY/i.test(text))fail();return text;
 }
 const types=await read('[Content_Types].xml');
 if(!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')||/macroEnabled/i.test(types))fail();
 const xml=await read('word/document.xml');
 if(!/<w:document\b/.test(xml)||!/<w:body\b/.test(xml)||/<w:altChunk\b/.test(xml))fail();
 const paragraphs=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>
  [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t=>decodeXml(t[1])).join('')
 ).filter(t=>t.trim());
 const text=paragraphs.join('\n');
 if(!text.trim()||text.length>500000)throw Error('В Word нет доступного текста или текст превышает допустимый размер.');
 const printed=[...new Set((text.match(/https?:\/\/[^\s<>«»]+/gi)||[]).map(u=>u.replace(/[.,;!?]+$/,'')))];
 const rels=entries.has('word/_rels/document.xml.rels')?await read('word/_rels/document.xml.rels'):'';
 const targets=new Map();
 for(const tag of rels.match(/<Relationship\b[^>]*\/?\s*>/g)||[]){
  const attrs=Object.fromEntries([...tag.matchAll(/\b(Id|Type|Target|TargetMode)="([^"]*)"/g)].map(a=>[a[1],decodeXml(a[2])]));
  if(attrs.Type==='http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'&&attrs.TargetMode==='External')targets.set(attrs.Id,attrs.Target);
 }
 const active=new Set();
 for(const link of xml.match(/<w:hyperlink\b[^>]*>[\s\S]*?<\/w:hyperlink>/g)||[]){
  const id=/\br:id="([^"]+)"/.exec(link)?.[1],target=targets.get(id);
  const shown=[...link.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t=>decodeXml(t[1])).join('').trim();
  if(target&&shown===target)active.add(target);
 }
 const attr=(tag,name)=>tag&&new RegExp('\\bw:'+name+'="([^"]*)"').exec(tag)?.[1];
 const twips=(tag,name)=>{const value=attr(tag,name);return value!==undefined&&/^-?\d{1,7}$/.test(value)?Number(value):null;};
 const sections=[...xml.matchAll(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g)].slice(0,32).map(m=>{
  const size=/<w:pgSz\b[^>]*\/?\s*>/.exec(m[0])?.[0],margin=/<w:pgMar\b[^>]*\/?\s*>/.exec(m[0])?.[0];
  return {width:twips(size,'w'),height:twips(size,'h'),left:twips(margin,'left'),right:twips(margin,'right'),top:twips(margin,'top'),bottom:twips(margin,'bottom')};
 });
 const styles=entries.has('word/styles.xml')?await read('word/styles.xml'):'';
 const normal=[...styles.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)].find(m=>attr(m[0].slice(0,m[0].indexOf('>')+1),'styleId')==='Normal')?.[0]||'';
 const font=/<w:rFonts\b[^>]*\/?\s*>/.exec(normal)?.[0],size=/<w:sz\b[^>]*\/?\s*>/.exec(normal)?.[0],spacing=/<w:spacing\b[^>]*\/?\s*>/.exec(normal)?.[0],indent=/<w:ind\b[^>]*\/?\s*>/.exec(normal)?.[0];
 const normalStyle=normal?{font:(attr(font,'ascii')||attr(font,'hAnsi')||'').slice(0,100),sizeHalfPoints:twips(size,'val'),line:twips(spacing,'line'),lineRule:attr(spacing,'lineRule')||'',firstLine:twips(indent,'firstLine')}:null;
 const fileHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
 return {text,fileHash,linkAudit:{printedCount:printed.length,activeCount:printed.filter(u=>active.has(u)).length,missing:printed.filter(u=>!active.has(u))},declaredLayout:{sections,sectionLimitReached:[...xml.matchAll(/<w:sectPr\b/g)].length>32,normalStyle}};
}
