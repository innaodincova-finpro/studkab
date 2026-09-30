import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {inspectWord,MAX_WORD_BYTES} from '../supabase/functions/_shared/external-word.mjs';
import {validateResult,resultAction} from '../supabase/functions/studkab-requests/results.mjs';
async function fixture(text='Текст учебного документа & данные'){
 const c={window:{},Blob,TextEncoder,Uint8Array,DataView};vm.runInNewContext(fs.readFileSync(new URL('../result-docx.js',import.meta.url),'utf8'),c);
 const d={topic:'Тест',student:'Тестовый студент',format:{},chapters:[{id:'intro',name:'Введение'}],structure:{intro:{text}}};
 return new Uint8Array(await c.window.ResultDocx(d,d.chapters).arrayBuffer());
}
function storedDocx(extra={},body='<w:p><w:r><w:t>Основной текст документа</w:t></w:r></w:p>'){
 const entries={
  '[Content_Types].xml':'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  'word/document.xml':'<w:document><w:body>'+body+'</w:body></w:document>',...extra
 };
 const parts=[],directory=[];let offset=0;
 for(const [path,xml] of Object.entries(entries)){
  const name=Buffer.from(path),data=Buffer.from(xml);let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30+name.length);local.writeUInt32LE(0x04034b50,0);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);
  local.writeUInt16LE(name.length,26);name.copy(local,30);
  const central=Buffer.alloc(46+name.length);central.writeUInt32LE(0x02014b50,0);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);
  central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);name.copy(central,46);
  parts.push(local,data);directory.push(central);offset+=local.length+data.length;
 }
 const dirSize=directory.reduce((sum,part)=>sum+part.length,0),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(directory.length,8);end.writeUInt16LE(directory.length,10);
 end.writeUInt32LE(dirSize,12);end.writeUInt32LE(offset,16);
 return new Uint8Array(Buffer.concat([...parts,...directory,end]));
}
const pid='77777777-7777-4777-8777-777777777777',rid='11111111-1111-4111-8111-111111111111';
test('a legacy request without student name cannot prepare, approve or deliver Word',async()=>{
 for(const version of [1,2]){
  let writes=0;
  const db=async path=>{
   if(path.startsWith('studkab_requests?'))return [{student_id:'student',payload:{n:''}}];
   if(path==='rpc/studkab_result_context_version')return version;
   writes++;throw Error('Unexpected database operation: '+path);
  };
  for(const action of ['prepare-result','review-result','deliver']){
   const answer=await resultAction({action,id:rid,versionId:pid},{email:'executor@example.test'},{db,config:async()=>({executor_email:'executor@example.test'})});
   assert.equal(answer.status,409,action+' v'+version);
   assert.match(answer.data.error,/ФИО студента/);
  }
  assert.equal(writes,0);
 }
});
test('C083 inspects real DOCX and preserves exact bytes/hash',async()=>{
 const bytes=await fixture(),before=Buffer.from(bytes),r=await inspectWord(bytes);
 assert.match(r.text,/Текст учебного документа & данные/);assert.match(r.fileHash,/^[a-f0-9]{64}$/);assert.deepEqual(Buffer.from(bytes),before);
});
test('plain source address in Word is reported as lacking an active hyperlink',async()=>{
 const r=await inspectWord(await fixture('Источник: https://example.org/article'));
 assert.deepEqual(r.linkAudit,{printedCount:1,activeCount:0,missing:['https://example.org/article']});
 assert.ok(Array.isArray(r.declaredLayout.sections));
});
test('unread Word text and tracked changes are identified without claiming full coverage',async()=>{
 const note='<w:p><w:r><w:t>Не выполнено обязательное условие</w:t></w:r></w:p>';
 const bytes=storedDocx({
  'word/header1.xml':'<w:hdr>'+note+'</w:hdr>',
  'word/footer1.xml':'<w:ftr><w:p><w:r><w:instrText> PAGE </w:instrText></w:r></w:p></w:ftr>',
  'word/footnotes.xml':'<w:footnotes><w:footnote>'+note+'</w:footnote></w:footnotes>',
  'word/endnotes.xml':'<w:endnotes><w:endnote>'+note+'</w:endnote></w:endnotes>',
  'word/comments.xml':'<w:comments><w:comment>'+note+'</w:comment></w:comments>'
 },'<w:p><w:ins><w:r><w:t>Основной текст документа</w:t></w:r></w:ins></w:p>');
 const result=await inspectWord(bytes);
 assert.equal(result.text,'Основной текст документа');
 assert.deepEqual(result.textCoverage.unreadParts,[
  'word/document.xml:tracked_changes','word/header1.xml','word/footnotes.xml',
  'word/endnotes.xml','word/comments.xml']);
 assert.deepEqual((await inspectWord(storedDocx())).textCoverage.unreadParts,[]);
 const textbox=await inspectWord(storedDocx({},'<w:p><w:txbxContent><w:p><w:r><w:t>Текст в рамке</w:t></w:r></w:p></w:txbxContent></w:p>'));
 assert.deepEqual(textbox.textCoverage.unreadParts,['word/document.xml:textbox']);
});
test('C083 rejects renamed non-Word, damaged ZIP and excessive size',async()=>{
 await assert.rejects(inspectWord(new Uint8Array(MAX_WORD_BYTES+1)),/3 МБ/);
 await assert.rejects(inspectWord(new TextEncoder().encode('Not a Word file but some ordinary plain text')));
 const b=await fixture();b[40]^=1;await assert.rejects(inspectWord(b));
});
test('C083 server binds uploaded text and hash to exact Word and requires passport',async()=>{
 const bytes=await fixture(),info=await inspectWord(bytes);
 const document={topic:'Тест',student:'Тестовый студент',chapters:[{id:'file_0',name:'Файл'}],structure:{file_0:{text:info.text}},uploadedWord:{name:'test.docx',fileHash:info.fileHash},reviewContext:{passportId:pid,sourceFingerprint:'c'.repeat(64),fingerprint:'d'.repeat(64)}};
 assert.equal(validateResult(document).uploadedWord.fileHash,info.fileHash);
 assert.throws(()=>validateResult({...document,reviewContext:undefined}),/паспорт/);
 const calls=[],db=async(path,method,args)=>{
  if(path==='rpc/studkab_material_manifest_check')return {valid:true};
  if(path.startsWith('studkab_requests?'))return[{student_id:'student',payload:{n:'Тестовый студент'}}];
  if(path==='rpc/studkab_result_context_version')return 2;
  if(path.startsWith('studkab_requirement_passports?'))return[{id:pid,status:'approved',source_fingerprint:'c'.repeat(64)}];
  if(path==='rpc/prepare_studkab_result'){calls.push(args);return{versionId:args.version};}
  throw Error(path);
 };
 const input={action:'prepare-result',id:rid,versionId:pid,document,docxBase64:Buffer.from(bytes).toString('base64')},deps={db,config:async()=>({executor_email:'executor@example.test'})};
 assert.equal((await resultAction(input,{email:'executor@example.test'},deps)).data.saved,true);
 assert.equal(calls[0].file_base64,input.docxBase64);
 assert.equal((await resultAction({...input,document:{...document,uploadedWord:{name:'test.docx',fileHash:'0'.repeat(64)}}},{email:'executor@example.test'},deps)).status,400);
 assert.equal((await resultAction({...input,document:{...document,structure:{file_0:{text:'Другой документ'}}}},{email:'executor@example.test'},deps)).status,400);
 assert.equal((await resultAction(input,{email:'student@example.test'},deps)).status,403);
 assert.equal(calls.length,1);
});

test('C083 frontend and Edge use identical DOCX inspection',()=>{
 assert.equal(fs.readFileSync(new URL('../external-word.mjs',import.meta.url),'utf8'),fs.readFileSync(new URL('../supabase/functions/_shared/external-word.mjs',import.meta.url),'utf8'));
});
