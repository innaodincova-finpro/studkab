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
const pid='77777777-7777-4777-8777-777777777777',rid='11111111-1111-4111-8111-111111111111';
test('C083 inspects real DOCX and preserves exact bytes/hash',async()=>{
 const bytes=await fixture(),before=Buffer.from(bytes),r=await inspectWord(bytes);
 assert.match(r.text,/Текст учебного документа & данные/);assert.match(r.fileHash,/^[a-f0-9]{64}$/);assert.deepEqual(Buffer.from(bytes),before);
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
