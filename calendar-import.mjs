// CAL-IMPORT-01. Pure local parsing/preview; no network, storage or account writes.
export const MAX_CALENDAR_FILE=5*1024*1024;
const MAX_RECORDS=5000,MAX_TEXT=2*1024*1024;
const fail=message=>{throw new Error(message);};
const clean=value=>String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const lower=value=>clean(value).toLocaleLowerCase('ru');
const aliases={'русский язык':'Русский язык и культура речи','бжд':'Безопасность жизнедеятельности','история':'История России','государственность':'Основы российской государственности','физкультура':'Физическая культура и спорт','английский':'Иностранный язык (английский)','иностранный язык':'Иностранный язык (английский)'};
export const discipline=value=>aliases[lower(value)]||clean(value);
export function calendarDate(value,date1904=false){
 if(typeof value==='number'){
  if(!Number.isFinite(value)||value<0||value>80000)return '';
  if(!date1904&&value<61)return '';
  const ms=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30)+Math.floor(value)*86400000;
  value=new Date(ms).toISOString().slice(0,10);
 }
 const s=clean(value);let match=/^(\d{4})-(\d{2})-(\d{2})(?: 00:00:00)?$/.exec(s);
 if(!match){const ru=/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);if(!ru)return '';match=[ru[0],ru[3],ru[2].padStart(2,'0'),ru[1].padStart(2,'0')];}
 const date=match[1]+'-'+match[2]+'-'+match[3],ms=Date.parse(date+'T12:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===date?date:'';
}
export function calendarTime(value){
 if(typeof value==='number'){
  if(!Number.isFinite(value)||value<0||value>=1)return '';
  const min=Math.round(value*1440);if(min>=1440)return '';
  return String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');
 }
 const m=/^(\d{1,2}):(\d{2})(?::00)?$/.exec(clean(value));
 return m&&+m[1]<24&&+m[2]<60?m[1].padStart(2,'0')+':'+m[2]:'';
}
export function timeRange(value){const parts=clean(value).split(/\s*[–—−-]\s*/);return {start:calendarTime(parts[0]),end:parts.length===2?calendarTime(parts[1]):''};}
function rowBlank(row){return !row.some(x=>clean(x));}
function signature(e){return [e.kind,e.date,e.time,lower(e.title)].join('|');}
function exactSignature(e){const w=e.workMetadata;return [signature(e),e.endTime||'',clean(e.note),JSON.stringify(w?{code:w.code,title:w.title,prepared:w.prepared,submission:w.submission,plannedDate:w.plannedDate,actualDate:w.actualDate}:null)].join('|');}
function classEvent(subject,type,date,start,end,teacher='',group=''){
 const full=discipline(subject),classType=clean(type);
 return {kind:'cls',title:full+' — '+classType.toLocaleLowerCase('ru'),date,time:start,endTime:end,
 note:['до '+end,clean(teacher),group?'группа '+clean(group):''].filter(Boolean).join(' · '),discipline:full,recordType:classType,planOnly:false};
}
function actionEvent(subject,action,title,date,start,end,code=''){
 const full=discipline(subject),label=clean(title),act=clean(action);
 return {kind:'other',title:(act==='Тест'?full+' — '+label:act+': '+full+(label?' — '+label:'')),date,time:start,endTime:end,
 note:[end?'до '+end:'','Плановая дата, официальный срок не указан',code&&code!=='—'?'код работы '+code:''].filter(Boolean).join(' · '),discipline:full,recordType:act,workCode:code==='—'?'':clean(code),planOnly:true};
}
function headerOf(sheet){
 for(let i=0;i<Math.min(sheet.rows.length,40);i++){
  const row=sheet.rows[i],values=row.map(lower),map={};values.forEach((v,j)=>{if(v)map[v]=j;});
  const subject=map['дисциплина']??map['предмет'];
  if(subject===undefined)continue;
  const field=(...keys)=>keys.map(k=>map[k]).find(v=>v!==undefined);
  const date=field('дата','дата в плане','план сдачи');
  const type=field('вид занятия','действие','название','комплект / задание');
  if(date===undefined||type===undefined)continue;
  return {at:i,subject,date,type,start:field('начало'),end:field('конец'),range:field('время','резерв времени'),teacher:field('преподаватель'),code:field('код работы','код'),title:field('что сделать','название','комплект / задание'),prepared:field('подготовка'),submission:field('сдача'),actual:field('факт сдачи'),id:field('№'),class:map['вид занятия']!==undefined,action:map['действие']!==undefined,tests:map['резерв времени']!==undefined&&map['название']!==undefined,works:map['план сдачи']!==undefined&&map['комплект / задание']!==undefined};
 }
 return null;
}
function fingerprintDedupe(result){
 const seen=new Map();result.events=result.events.filter(e=>{
  const key=signature(e),old=seen.get(key);
  if(old){
   if(exactSignature(old)!==exactSignature(e))result.issues.push({message:'Одинаковая дата и название, но разные сведения',title:e.title,date:e.date});
   else result.duplicates++;
   return false;
  }seen.set(key,e);return true;
 });
 return result;
}
export function parseCalendarSheets(sheets){
 if(!Array.isArray(sheets)||!sheets.length||sheets.length>100)fail('В Excel нет доступных листов.');
 const out={events:[],issues:[],warnings:[],duplicates:0,coveredSheets:[],ignoredSheets:[],ignoredRows:[],session:null,workMetadata:[],summary:{classes:0,actions:0,tests:0}};
 const mapped=sheets.map(sheet=>({sheet,h:headerOf(sheet)}));
 const hasPlan=mapped.some(x=>x.h?.action);
 const testReferences=[],workReferences=[];
 for(const {sheet,h} of mapped){
  if(!h){
   // These sheets are views/notes in the verified workbook, not extra event sources.
   if(/^(начните здесь|проверка работ|январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)$/i.test(clean(sheet.name)))out.ignoredSheets.push(sheet.name);
   else if(sheet.rows.some(row=>!rowBlank(row)))out.issues.push({sheet:sheet.name,message:'Структура листа не распознана. Проверьте, нет ли на нём событий.'});
   const text=sheet.rows.map(row=>row.map(clean).join(' ')).join('\n');
   const session=/Сессия\s*:\s*(\d{2}\.\d{2}\.\d{4})\s*[–—-]\s*(\d{2}\.\d{2}\.\d{4})/i.exec(text);
   if(session){const from=calendarDate(session[1]),to=calendarDate(session[2]);if(from&&to&&from<=to)out.session={from,to};else out.issues.push({sheet:sheet.name,message:'Период сессии требует уточнения.'});}
   continue;
  }
  out.coveredSheets.push(sheet.name);
  const get=(row,key)=>h[key]===undefined?'':row[h[key]]??'';
  for(let i=h.at+1;i<sheet.rows.length;i++){
   const row=sheet.rows[i];if(rowBlank(row))continue;
   // Footer notes are retained in issues only when they contain a potential date/event.
   if(!clean(get(row,'subject'))&&!clean(get(row,'date'))){out.ignoredRows.push({sheet:sheet.name,row:i+1,text:row.map(clean).join(' · ').slice(0,500)});continue;}
   const source={sheet:sheet.name,row:i+1},date=calendarDate(get(row,'date'),sheet.date1904),subject=discipline(get(row,'subject'));
   const formulaRow=sheet.formulaRows?.includes(i+1);
   if(!date||!subject){out.issues.push({...source,message:'Не указана корректная дата или дисциплина.'});continue;}
   if(h.works){
    const code=clean(get(row,'code'));const meta={code,discipline:subject,title:clean(get(row,'title')),prepared:clean(get(row,'prepared')),submission:clean(get(row,'submission')),plannedDate:date,actualDate:clean(get(row,'actual')),formulaReference:!!formulaRow,source};
    out.workMetadata.push(meta);workReferences.push(meta);
    if(hasPlan)continue;
    out.issues.push({...source,message:'У срока работы нет времени. Укажите время перед добавлением.',title:meta.title,date});continue;
   }
   if(formulaRow){out.issues.push({...source,message:'Строка содержит формулу: значение не подтверждено.'});continue;}
   let range=h.class?{start:calendarTime(get(row,'start')),end:calendarTime(get(row,'end'))}:timeRange(get(row,'range'));
   if(!range.start||!range.end||range.end<=range.start){out.issues.push({...source,message:'Не указано корректное время начала и окончания.',date,title:subject});continue;}
   let event;
   if(h.class){
    const type=clean(get(row,'type'));if(!type){out.issues.push({...source,message:'Не указан вид занятия.'});continue;}
    event=classEvent(subject,type,date,range.start,range.end,get(row,'teacher'));
   }else if(h.action||h.tests){
    const action=h.tests?'Тест':clean(get(row,'type'));
    event=actionEvent(subject,action,get(row,'title'),date,range.start,range.end,clean(get(row,'code')));
    if(h.tests&&hasPlan){event.source=source;testReferences.push(event);continue;}
   }else{out.issues.push({...source,message:'Не определён вид календарной записи.'});continue;}
   // Identity is only a candidate for a visible update. It never authorizes overwriting.
   event.source=source;
   event.sourceKey=h.class?(clean(get(row,'id'))?'class:'+clean(get(row,'id')):''):
    (event.workCode?'work:'+event.workCode+':'+event.recordType:event.recordType==='Тест'?'test:'+lower(subject)+':'+lower(get(row,'title')):'');
   out.events.push(event);if(out.events.length>MAX_RECORDS)fail('В файле больше 5000 событий. Разделите расписание.');
  }
 }
 for(const test of testReferences)if(!out.events.some(e=>signature(e)===signature(test)&&e.endTime===test.endTime))out.issues.push({...test.source,message:'Тест из отдельного листа не совпадает с планом.',title:test.title,date:test.date});
 for(const meta of workReferences){const matches=out.events.filter(e=>e.workCode===meta.code&&e.recordType==='Сдача');if(hasPlan&&(matches.length!==1||matches[0].date!==meta.plannedDate))out.issues.push({...meta.source,message:'Срок работы не совпадает с действием сдачи в плане.',title:meta.title,date:meta.plannedDate});else if(hasPlan&&meta.formulaReference)out.warnings.push({...meta.source,message:'Срок на листе работ содержит формулу. Дата события взята из плана и совпадает с указанным сроком; формула не пересчитывалась.'});for(const event of out.events.filter(e=>e.workCode===meta.code))event.workMetadata=meta;}
 fingerprintDedupe(out);
 out.summary={classes:out.events.filter(e=>e.kind==='cls').length,actions:out.events.filter(e=>e.kind!=='cls').length,tests:out.events.filter(e=>e.recordType==='Тест').length};
 return out;
}
export function parseCalendarText(text){
 if(typeof text!=='string'||text.length>MAX_TEXT)fail('Текст слишком большой. Разделите расписание.');
 if(text.includes('\t'))return parseCalendarSheets([{name:'Вставленный текст',rows:text.replace(/\r/g,'').split('\n').map(line=>line.split('\t'))}]);
 const out={events:[],issues:[],duplicates:0,summary:{classes:0,actions:0,tests:0},session:null};let teacher='';
 const lines=text.replace(/\r/g,'').split('\n');
 for(let i=0;i<lines.length;i++){
  const line=clean(lines[i]);if(!line||/^Расписание\s*:?$/i.test(line))continue;
  const session=/^Период сессии\s*:\s*(\d{2}\.\d{2}\.\d{4})\s*[–—-]\s*(\d{2}\.\d{2}\.\d{4})/i.exec(line);
  if(session){const from=calendarDate(session[1]),to=calendarDate(session[2]);if(from&&to&&from<=to)out.session={from,to};else out.issues.push({row:i+1,message:'Период сессии требует уточнения.'});continue;}
  const heading=/\(часть\s+\d+\/\d+\)\s*(.*)$/.exec(line);if(heading&&!/\d{2}\.\d{2}\.\d{4}/.test(line)){teacher=clean(heading[1]);continue;}
  if(/^Английский язык$/i.test(line))continue;
  const m=/^(Лекция|Практическое занятие|Лабораторная работа)\s+по дисциплине\s+(.+?)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})$/.exec(line);
  if(m){const date=calendarDate(m[3]),start=calendarTime(m[4]),end=calendarTime(m[5]);if(!date||!start||!end||end<=start){out.issues.push({row:i+1,message:'Проверьте дату и время занятия.',text:line});continue;}const e=classEvent(m[2],m[1],date,start,end,teacher);e.source={row:i+1};e.sourceKey='';out.events.push(e);}
  else out.issues.push({row:i+1,message:'Строка не распознана.',text:line});
  if(out.events.length>MAX_RECORDS)fail('В тексте больше 5000 событий. Разделите расписание.');
 }
 fingerprintDedupe(out);out.summary.classes=out.events.length;return out;
}
export function previewCalendarImport(existing,parsed,sourceName=''){
 if(!Array.isArray(existing)||!Array.isArray(parsed?.events))fail('Некорректные данные календаря.');
 const result={add:[],skip:[],changes:[],issues:[...(parsed.issues||[])],session:parsed.session||null,sourceName:clean(sourceName),baseFingerprint:JSON.stringify(existing)};
 for(const event of parsed.events){
  const matching=existing.filter(e=>signature(e)===signature(event));
  if(matching.length){
   const old=matching.find(e=>e.src==='calendar-import')||matching[0];
   if(old.src==='calendar-import'&&exactSignature(old)!==exactSignature(event))result.changes.push({oldId:old.id,old,event,reason:'Сведения записи изменились.'});
   else result.skip.push({event,existingId:old.id,reason:'Такая запись уже есть.'});
   continue;
  }
  const origins=event.sourceKey&&existing.filter(e=>e.src==='calendar-import'&&e.importSource===result.sourceName&&e.importKey===event.sourceKey);
  if(origins?.length){
   if(origins.length===1)result.changes.push({oldId:origins[0].id,old:origins[0],event,reason:'Возможный перенос или изменение. Проверьте запись.'});
   else result.issues.push({message:'Несколько записей с одним источником: требуется уточнение.',title:event.title});
  }else{
   const otherSources=event.sourceKey?existing.filter(e=>e.src==='calendar-import'&&e.importKey===event.sourceKey&&e.kind===event.kind&&lower(e.title)===lower(event.title)):[];
   if(otherSources.length)result.issues.push({message:'Похожая запись найдена в другом источнике. Уточните перенос, чтобы не создать дубль.',title:event.title,date:event.date});
   else result.add.push(event);
  }
 }
 return result;
}
export function applyCalendarImport(existing,preview,makeId,{acceptChanges=[]}={}){
 if(!Array.isArray(existing)||typeof makeId!=='function')fail('Некорректный календарь.');
 if(JSON.stringify(existing)!==preview.baseFingerprint)fail('Календарь изменился после проверки. Проверьте загрузку заново.');
 const next=existing.map(e=>({...e}));let added=0,updated=0,skipped=0;const accepted=new Set(acceptChanges);
 const fields=e=>({...e,src:'calendar-import',importSource:preview.sourceName,importKey:e.sourceKey||'',wid:''});
 for(const event of preview.add){if(next.some(e=>signature(e)===signature(event))){skipped++;continue;}next.push({...fields(event),id:makeId()});added++;}
 for(const change of preview.changes){
  if(!accepted.has(change.oldId))continue;
  const at=next.findIndex(e=>e.id===change.oldId);
  if(at<0||JSON.stringify(next[at])!==JSON.stringify(change.old))fail('Календарь изменился после проверки. Проверьте загрузку заново.');
  if(next.some(e=>e.id!==change.oldId&&signature(e)===signature(change.event)))fail('После проверки появилась такая же запись. Проверьте загрузку заново.');
  next[at]={...next[at],...fields(change.event),id:change.oldId,wid:next[at].wid||''};updated++;
 }
 return {events:next,added,updated,skipped:skipped+preview.skip.length};
}
// ZIP limits and CRC are checked before XML is interpreted. No macros or external resources.
export async function readCalendarXlsx(bytes,{DOMParser=globalThis.DOMParser,inflate}={}){
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX_CALENDAR_FILE)fail('Выберите Excel .xlsx размером до 5 МБ.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true);let tail=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){tail=i;break;}
 const bad=()=>fail('Excel повреждён, защищён паролем или имеет неподдерживаемый формат.');
 if(tail<0)bad();const count=u16(tail+10),dir=u32(tail+16),dirSize=u32(tail+12);
 if(u16(tail+4)||u16(tail+6)||u16(tail+8)!==count||!count||count>1000||dir+dirSize!==tail)bad();
 const decoder=new TextDecoder('utf-8',{fatal:true}),entries=new Map();let at=dir,total=0;
 for(let i=0;i<count;i++){
  if(at+46>tail||u32(at)!==0x02014b50)bad();
  const flags=u16(at+8),method=u16(at+10),crc=u32(at+16),packed=u32(at+20),size=u32(at+24),length=u16(at+28),extra=u16(at+30),comment=u16(at+32),offset=u32(at+42);
  if(at+46+length+extra+comment>tail||flags&1||![0,8].includes(method)||size>8*1024*1024||(total+=size)>32*1024*1024||offset+30>dir||u16(at+34))bad();
  const name=decoder.decode(bytes.subarray(at+46,at+46+length));
  if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||entries.has(name)||/vbaProject|externalLinks|embeddings\//i.test(name))bad();
  if(u32(offset)!==0x04034b50||u16(offset+8)!==method||u16(offset+6)!==flags)bad();
  const start=offset+30+u16(offset+26)+u16(offset+28);
  if(start+packed>dir||decoder.decode(bytes.subarray(offset+30,offset+30+u16(offset+26)))!==name)bad();
  entries.set(name,{start,packed,size,method,crc});at+=46+length+extra+comment;
 }
 if(at!==tail||!entries.has('[Content_Types].xml'))bad();
 const crc32=data=>{let c=-1;for(const b of data){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^-1)>>>0;};
 async function unpack(input,limit){
  if(inflate)return new Uint8Array(await inflate(input,limit));
  let stream;try{stream=new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{fail('Этот браузер не умеет читать сжатый Excel. Обновите браузер или вставьте расписание текстом.');}
  const reader=stream.getReader(),parts=[];let length=0;
  try{for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>limit)bad();parts.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
  const out=new Uint8Array(length);let pos=0;for(const part of parts){out.set(part,pos);pos+=part.length;}return out;
 }
 const cache=new Map();
 async function xml(name,optional=false){
  if(cache.has(name))return cache.get(name);
  const e=entries.get(name);if(!e){if(optional)return null;bad();}
  const input=bytes.subarray(e.start,e.start+e.packed),data=e.method===0?input:await unpack(input,e.size);
  if(data.length!==e.size||crc32(data)!==e.crc)bad();
  const text=decoder.decode(data);if(/<!DOCTYPE|<!ENTITY/i.test(text)||(text.match(/</g)||[]).length>200000)bad();
  if(!DOMParser)fail('В браузере недоступен разбор Excel.');
  let invalid=false;const doc=new DOMParser({onError:()=>{invalid=true;}}).parseFromString(text,'application/xml');
  if(invalid||!doc?.documentElement)bad();
  const pending=[[doc.documentElement,0]];let nodes=0;
  while(pending.length){const [node,depth]=pending.pop();if(++nodes>100000||depth>64||node.localName==='parsererror')bad();for(const child of Array.from(node.childNodes||[]))if(child.nodeType===1)pending.push([child,depth+1]);}
  cache.set(name,doc.documentElement);return doc.documentElement;
 }
 const named=(node,name)=>Array.from(node?.childNodes||[]).filter(n=>n.nodeType===1&&n.localName===name);
 const descendants=(node,name)=>Array.from(node?.getElementsByTagNameNS('*',name)||[]);
 const attr=(node,name)=>{for(const a of Array.from(node?.attributes||[]))if(a.localName===name)return a.value;return '';};
 const types=await xml('[Content_Types].xml');
 const workbookType=descendants(types,'Override').find(n=>attr(n,'PartName')==='/xl/workbook.xml')||descendants(types,'Default').find(n=>attr(n,'Extension')==='xml');
 if(attr(workbookType,'ContentType')!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'||descendants(types,'Override').some(n=>/macroEnabled/i.test(attr(n,'ContentType'))))bad();
 const wb=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');const links=new Map(named(rels,'Relationship').map(n=>[attr(n,'Id'),n]));
 const date1904=['1','true'].includes(attr(named(wb,'workbookPr')[0],'date1904'));
 const stringsXml=await xml('xl/sharedStrings.xml',true),strings=named(stringsXml,'si').map(n=>descendants(n,'t').map(t=>t.textContent).join(''));
 const sheets=[];let cells=0;
 for(const s of named(named(wb,'sheets')[0],'sheet')){
  const rel=links.get(attr(s,'id'));if(!rel||attr(rel,'TargetMode')==='External')bad();
  const target=attr(rel,'Target');if(!target||target.includes('\\')||/^[a-z]+:/i.test(target))bad();
  const path=target.startsWith('/')?target.slice(1):'xl/'+target,parts=[];
  for(const item of path.split('/')){if(item==='..'){if(!parts.length)bad();parts.pop();}else if(item&&item!=='.')parts.push(item);}
  const root=await xml(parts.join('/'));if(root.localName!=='worksheet')bad();
  const rows=[],formulaRows=[],seen=new Set();let chars=0;
  for(const row of named(named(root,'sheetData')[0],'row')){
   const rn=Number(attr(row,'r'));if(!Number.isInteger(rn)||rn<1||rn>20000)bad();
   const values=[];
   for(const c of named(row,'c')){
    if(++cells>100000)bad();const ref=attr(c,'r'),m=/^([A-Z]{1,3})([1-9]\d{0,4})$/.exec(ref);
    if(!m||Number(m[2])!==rn||seen.has(ref))bad();seen.add(ref);let column=0;for(const ch of m[1])column=column*26+ch.charCodeAt(0)-64;if(column>1000)bad();
    const type=attr(c,'t'),raw=named(c,'v')[0]?.textContent??'';let value=raw;
    if(type==='s'){if(!/^\d+$/.test(raw)||Number(raw)>=strings.length)bad();value=strings[Number(raw)];}
    else if(type==='inlineStr')value=descendants(c,'t').map(t=>t.textContent).join('');
    else if(!type||type==='n'){if(raw){value=Number(raw);if(!Number.isFinite(value))bad();}}
    else if(type==='e')formulaRows.push(rn);
    if(named(c,'f').length)formulaRows.push(rn);
    chars+=String(value).length;if(chars>MAX_TEXT)bad();values[column-1]=value;
   }rows[rn-1]=values;
  }
  for(let i=0;i<rows.length;i++)if(!rows[i])rows[i]=[];
  sheets.push({name:attr(s,'name'),rows,date1904,formulaRows:[...new Set(formulaRows)]});
 }
 return sheets;
}
