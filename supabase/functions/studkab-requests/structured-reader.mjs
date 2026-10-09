import {inflateRawSync} from 'node:zlib';
import {readOfficeMath} from './office-math.mjs';
export const READER_VERSION='intake-reader-2';
const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document',XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_TEXT=500000,MAX_BLOCKS=20000,MAX_JSON=2000000;
class ReadError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ReadError(code);};
const children=n=>Array.from(n.childNodes||[]).filter(x=>x.nodeType===1);
const named=(n,name)=>children(n).filter(x=>x.localName===name);
const first=(n,name)=>named(n,name)[0];
const descendants=(n,name)=>Array.from(n.getElementsByTagNameNS('*',name));
const attr=(n,name)=>{if(!n)return '';for(const a of Array.from(n.attributes||[]))if(a.localName===name)return a.value;return '';};
function textRuns(n){let text='';function walk(x){if(x.nodeType!==1)return;if(x.localName==='t'||x.localName==='delText')text+=x.textContent;else if(x.localName==='tab')text+='\t';else if(['br','cr'].includes(x.localName))text+='\n';else for(const c of children(x))walk(c);}walk(n);return text;}
// ZIP directory is validated before bounded inflate; no filesystem writes or external fetching.
function archive(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=o=>v.getUint16(o,true),u32=o=>v.getUint32(o,true);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
 if(end<0)fail('damaged_archive');
 const count=u16(end+10),offset=u32(end+16),length=u32(end+12);
 if(u16(end+4)||u16(end+6)||u16(end+8)!==count||count>1000||offset+length!==end)fail('unsupported_archive');
 let p=offset,total=0;const entries=new Map(),decoder=new TextDecoder('utf-8',{fatal:true});
 for(let i=0;i<count;i++){
  if(p+46>end||u32(p)!==0x02014b50)fail('damaged_archive');
  const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),packed=u32(p+20),size=u32(p+24),n=u16(p+28),extra=u16(p+30),comment=u16(p+32),local=u32(p+42);
  if(p+46+n+extra+comment>end||flags&1||![0,8].includes(method)||size>8388608||(total+=size)>33554432)fail('archive_limit');
  let name;try{name=decoder.decode(bytes.slice(p+46,p+46+n));}catch{fail('damaged_archive');}
  if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||entries.has(name)||u16(p+34))fail('damaged_archive');
  if(local+30>offset||u32(local)!==0x04034b50||u16(local+8)!==method||u16(local+6)!==flags)fail('damaged_archive');
  const start=local+30+u16(local+26)+u16(local+28);
  if(start+packed>offset||decoder.decode(bytes.slice(local+30,local+30+u16(local+26)))!==name)fail('damaged_archive');
  entries.set(name,{start,packed,size,method,crc});p+=46+n+extra+comment;
 }
 if(p!==end)fail('damaged_archive');
 const crc32=data=>{let c=-1;for(const b of data){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^-1)>>>0;};
 return {names:[...entries.keys()],get(name){const e=entries.get(name);if(!e)return null;let data;
  try{const input=bytes.slice(e.start,e.start+e.packed);data=e.method===0?input:new Uint8Array(inflateRawSync(input,{maxOutputLength:Math.max(1,e.size)}));}catch{fail('damaged_archive');}
  if(data.length!==e.size||crc32(data)!==e.crc)fail('damaged_archive');return data;
 }};
}
function xml(bytes,DOMParser){
 if(!bytes)fail('missing_document_part');let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('invalid_xml');}
 if(/<!DOCTYPE|<!ENTITY/i.test(value))fail('unsafe_xml');
 if((value.match(/</g)||[]).length>200000)fail('xml_limit');
 let errors=false,document;try{document=new DOMParser({onError:()=>{errors=true;}}).parseFromString(value,'application/xml');}catch{fail('invalid_xml');}
 if(errors||!document?.documentElement)fail('invalid_xml');let nodes=0;
 function check(n,depth){if(++nodes>100000||depth>64)fail('xml_limit');for(const c of children(n))check(c,depth+1);}check(document.documentElement,0);return document.documentElement;
}
function word(zip,DOMParser,out,add,warning){
 const part='word/document.xml',root=xml(zip.get(part),DOMParser),body=first(root,'body');if(!body)fail('invalid_docx');
 const parts=[{part,node:body},...zip.names.filter(n=>/^word\/(header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(n)).map(part=>({part,node:xml(zip.get(part),DOMParser)}))];
 function wordText(n,source){
  let text='',equations=[];
  function visit(c){
   if(c.nodeType!==1)return;
   if(c.namespaceURI==='http://schemas.openxmlformats.org/officeDocument/2006/math'&&c.localName==='oMath'){
    const equation=readOfficeMath(c),origin={...source,equation:equations.length+1};equations.push({...equation,source:origin});
    if(equation.complete)text+='\\('+equation.text+'\\)';else{warning('equation_layout',origin);text+='[Непрочитанная формула '+origin.equation+']';}return;
   }
   if(c.localName==='t'||c.localName==='delText')text+=c.textContent;
   else if(c.localName==='tab')text+='\t';else if(['br','cr'].includes(c.localName))text+='\n';
   else for(const nested of children(c))visit(nested);
  }
  visit(n);return {text,...(equations.length?{equations}:{})};
 }
 let tables=0;
 for(const {part,node} of parts){let paragraph=0;function walk(n,source={part}){
  for(const c of children(n)){
   if(c.localName==='p'||c.localName==='oMathPara'){const origin={...source,paragraph:++paragraph};add({kind:'paragraph',...wordText(c,origin),source:origin});}
   else if(c.localName==='tbl'){
    const table=++tables;let row=0;
    for(const tr of named(c,'tr')){row++;let column=1+Number(attr(first(first(tr,'trPr')||{},'gridBefore'),'val')||0);if(!Number.isInteger(column)||column<1||column>1001)fail('invalid_docx');for(const tc of named(tr,'tc')){
     const pr=first(tc,'tcPr'),span=Number(attr(first(pr||{},'gridSpan'),'val')||1);
     if(!Number.isInteger(span)||span<1||span>1000)fail('invalid_docx');
     const merge=first(pr||{},'vMerge'),origin={part,table,row,column},paragraphs=named(tc,'p').map((p,index)=>wordText(p,{...origin,paragraph:index+1})),equations=paragraphs.flatMap(p=>p.equations||[]);add({kind:'table_cell',text:paragraphs.map(p=>p.text).join('\n'),...(equations.length?{equations}:{}),source:origin,columnSpan:span,verticalMerge:merge?(attr(merge,'val')||'continue'):null});
     for(const nested of named(tc,'tbl'))walk({childNodes:[nested]},{part,parentTable:table,parentRow:row,parentColumn:column});column+=span;
    }}
   }else if(['sdt','sdtContent','ins','customXml','footnote','endnote','comment'].includes(c.localName))walk(c,source);
   else if(c.localName==='altChunk')warning('unsupported_embedded_content',{part});
   else if(descendants(c,'p').length||descendants(c,'tbl').length)warning('unsupported_embedded_content',{part});
  }
 }
 walk(node);
 if(descendants(node,'fldChar').length||descendants(node,'fldSimple').length)warning('word_field_cache',{part});
 if(part==='word/comments.xml')warning('document_comments',{part});
 if(descendants(node,'drawing').length||descendants(node,'pict').length)warning('non_text_content',{part});
 if(descendants(node,'del').length||descendants(node,'ins').length)warning('tracked_changes',{part});
 if(descendants(node,'txbxContent').length)warning('text_box_layout',{part});
 }
 if(zip.names.some(n=>/word\/(embeddings|vbaProject)/.test(n)))warning('unsupported_embedded_content',{part:'word/document.xml'});
 out.summary={tables};
}
function resolvePart(base,target){
 if(!target||target.includes('\\')||/^[a-z]+:/i.test(target))fail('invalid_relationship');
 const path=target.startsWith('/')?target.slice(1):base.slice(0,base.lastIndexOf('/')+1)+target,parts=[];
 for(const item of path.split('/')){if(item==='..'){if(!parts.length)fail('invalid_relationship');parts.pop();}else if(item&&item!=='.')parts.push(item);}return parts.join('/');
}
function excel(zip,DOMParser,out,add,warning){
 const workbook=xml(zip.get('xl/workbook.xml'),DOMParser),rels=xml(zip.get('xl/_rels/workbook.xml.rels'),DOMParser),links=new Map();
 for(const r of named(rels,'Relationship')){links.set(attr(r,'Id'),r);if(attr(r,'TargetMode')==='External')warning('external_link',{part:'xl/_rels/workbook.xml.rels'});}
 const stringsPart=zip.get('xl/sharedStrings.xml'),strings=stringsPart?named(xml(stringsPart,DOMParser),'si').map(textRuns):[];
 const stylePart=zip.get('xl/styles.xml'),styles=stylePart?xml(stylePart,DOMParser):null;
 const formats=new Map(styles?descendants(styles,'numFmt').map(n=>[attr(n,'numFmtId'),attr(n,'formatCode')]):[]);
 const cellStyles=styles?named(first(styles,'cellXfs')||{},'xf'):[];
 const date1904=attr(first(workbook,'workbookPr'),'date1904')==='1';let sheets=[];
 for(const sheet of named(first(workbook,'sheets')||{},'sheet')){
  const rel=links.get(attr(sheet,'id'));if(!rel||attr(rel,'TargetMode')==='External')fail('invalid_relationship');
  const part=resolvePart('xl/workbook.xml',attr(rel,'Target')),root=xml(zip.get(part),DOMParser),name=attr(sheet,'name'),hidden=attr(sheet,'state')||'visible';
  if(root.localName!=='worksheet')fail('unsupported_sheet');
  const merges=descendants(root,'mergeCell').map(n=>attr(n,'ref')),columns=descendants(root,'col').filter(n=>attr(n,'hidden')==='1').map(n=>({min:attr(n,'min'),max:attr(n,'max')}));
  sheets.push({name,part,state:hidden,mergedRanges:merges,hiddenColumns:columns,date1904});
  const seen=new Set();
  for(const row of named(first(root,'sheetData')||{},'row'))for(const c of named(row,'c')){
   const cell=attr(c,'r');if(!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(cell)||seen.has(cell))fail('invalid_cell');seen.add(cell);
   const type=attr(c,'t')||'n',v=first(c,'v'),f=first(c,'f'),raw=v?v.textContent:null;
   let value=raw;
   if(type==='s'){if(raw===null||!/^\d+$/.test(raw)||Number(raw)>=strings.length)fail('invalid_shared_string');value=strings[Number(raw)];}
   if(type==='inlineStr')value=textRuns(first(c,'is')||{});
   const style=attr(c,'s')||'0',numFmtId=attr(cellStyles[Number(style)],'numFmtId')||'0';
   const source={part,sheet:name,cell};
   const formula=f?{text:f.textContent,type:attr(f,'t')||'normal',sharedIndex:attr(f,'si')||null,range:attr(f,'ref')||null}:null;
   if(formula){warning('formula_cache_unverified',source);if(raw===null)warning('formula_result_missing',source);if(formula.type==='shared'&&!formula.text)warning('shared_formula_reference',source);if(/\[[^\]]+\]|WEBSERVICE\s*\(|HYPERLINK\s*\(|DDE\s*\(/i.test(formula.text))warning('external_formula',source);}
   if(type==='e')warning('cell_error',source);
   add({kind:'spreadsheet_cell',text:value??'',source,cellType:type,rawValue:raw,value,formula,cachedValue:formula?raw:null,numberFormat:{id:numFmtId,code:formats.get(numFmtId)||null},hiddenSheet:hidden!=='visible',hiddenRow:attr(row,'hidden')==='1',hiddenColumn:columns.some(col=>{let idx=0;for(const ch of cell.match(/^[A-Z]+/)[0])idx=idx*26+ch.charCodeAt(0)-64;return idx>=Number(col.min)&&idx<=Number(col.max);})});
  }
  if(descendants(root,'drawing').length||descendants(root,'legacyDrawing').length)warning('non_cell_content',{part,sheet:name});
 }
 if(!sheets.length)fail('invalid_xlsx');
 if(zip.names.some(n=>/xl\/comments/.test(n)))warning('non_cell_content',{part:'xl/workbook.xml'});
 if(zip.names.some(n=>/externalLinks|vbaProject|embeddings/.test(n)))warning('external_or_embedded_parts',{part:'xl/workbook.xml'});
 out.sheets=sheets;out.summary={sheets:sheets.length,cells:out.blocks.length};
}
async function pdf(bytes,loadPDF,out,add,warning,checkTime){
 const {document,OPS}=await loadPDF(bytes);try{
  if(!Number.isInteger(document.numPages)||document.numPages>100)fail('page_limit');out.pages=[];
  const imageOps=new Set(['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintImageMaskXObjectGroup','paintInlineImageXObjectGroup'].map(k=>OPS[k]).filter(Number.isInteger));
  for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
   checkTime();const page=await document.getPage(pageNumber),content=await page.getTextContent(),operators=await page.getOperatorList();
   const textItems=content.items.filter(i=>typeof i.str==='string'),hasText=textItems.some(i=>i.str.trim()),hasImage=operators.fnArray.some(i=>imageOps.has(i));
   const drawingOps=new Set(['stroke','closeStroke','fill','eoFill','fillStroke','eoFillStroke','closeFillStroke','closeEOFillStroke','shadingFill','constructPath'].map(k=>OPS[k]).filter(Number.isInteger));
   const hasDrawing=operators.fnArray.some(i=>drawingOps.has(i));
   const state=hasImage?'needs_text_version':hasDrawing?'unverified_nontext':hasText?'text':'blank';
   out.pages.push({page:pageNumber,state});
   if(hasImage)warning('pdf_image_page',{page:pageNumber});else if(hasDrawing)warning('pdf_nontext_page',{page:pageNumber});
   const annotations=await page.getAnnotations();for(const annotation of annotations){const value=annotation.contentsObj?.str||annotation.contents||annotation.fieldValue;if(typeof value==='string'&&value)add({kind:'pdf_annotation',text:value,source:{page:pageNumber,annotation:annotation.id}});if(annotation.subtype==='Widget'||annotation.hasAppearance)warning('pdf_annotations',{page:pageNumber});}
   let block=0;for(const item of textItems)add({kind:'pdf_text',text:item.str,source:{page:pageNumber,block:++block},transform:Array.from(item.transform||[]),width:item.width,height:item.height,hasEOL:!!item.hasEOL});
   page.cleanup();
  }
  out.summary={pages:document.numPages};
 }finally{await document.loadingTask.destroy();}
}
/** @param {Uint8Array} bytes @param {string} type @param {{DOMParser?: any, loadPDF?: any, clock?: ()=>number}} options */
export async function readDocument(bytes,type,{DOMParser,loadPDF,clock=()=>Date.now()}={}){
 const started=clock(),checkTime=()=>{if(clock()-started>15000)fail('time_limit');};
 const out={schema:1,readerVersion:READER_VERSION,status:'ready',blocks:[],warnings:[],extracted_text:''};let chars=0;
 const warning=(code,source)=>{if(out.warnings.length>=2000)fail('result_limit');out.warnings.push({code,source});};
 const add=block=>{checkTime();if(block.text.includes('\ufffd'))warning('undecodable_text',block.source);chars+=block.text.length+1;if(chars>MAX_TEXT||out.blocks.length>=MAX_BLOCKS)fail('result_limit');out.blocks.push(block);};
 try{
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>5242880)fail('file_limit');
  if(type===DOCX||type===XLSX){const zip=archive(bytes);if(type===DOCX)word(zip,DOMParser,out,add,warning);else excel(zip,DOMParser,out,add,warning);}
  else if(type==='application/pdf')await pdf(bytes,loadPDF,out,add,warning,checkTime);else fail('unsupported_format');
  out.extracted_text=out.blocks.map(b=>b.text).join('\n');
  if(!out.extracted_text.trim())warning('no_readable_text',{});
  if(out.warnings.some(w=>['pdf_image_page','pdf_nontext_page','non_text_content','unsupported_embedded_content','text_box_layout','non_cell_content','external_or_embedded_parts','no_readable_text','tracked_changes','equation_layout','pdf_annotations','undecodable_text'].includes(w.code)))out.status='blocked';
  if(JSON.stringify(out).length>MAX_JSON)fail('result_limit');checkTime();return out;
 }catch(e){if(!e?.code){if(['InvalidPDFException','FormatError','PasswordException'].includes(e?.name))e={code:e.name==='PasswordException'?'encrypted_pdf':'damaged_pdf'};else throw e;}return {schema:1,readerVersion:READER_VERSION,status:'blocked',blocks:[],warnings:[{code:e.code,source:{}}],extracted_text:''};}
}
