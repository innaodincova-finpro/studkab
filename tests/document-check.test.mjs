import test from 'node:test';
import assert from 'node:assert/strict';
import {result,runAutomaticChecks} from '../supabase/functions/studkab-workflow/document-check.mjs';

const student='11111111-1111-4111-8111-111111111111';
const documentId='22222222-2222-4222-8222-222222222222';
const requirementId='33333333-3333-4333-8333-333333333333';
const requestId='44444444-4444-4444-8444-444444444444';
const base={document:{content:{structure:{intro:{text:'Содержательный раздел без технических пометок.'}}},docx_sha256:'a'.repeat(64)},file:{state:'accepted',detected_mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sha256:'a'.repeat(64),student_id:student},request:{student_id:student}};

test('deterministic checks detect unfinished text, duplicates and file substitution',()=>{
 assert.equal(result('TXT-04',base),true);
 assert.equal(result('TXT-04',{...base,document:{...base.document,content:{structure:{intro:{text:'[ДАННЫЕ СТУДЕНТА: период]'}}}}}),false);
 const repeated='Очень длинный абзац '.repeat(10);
 assert.equal(result('TXT-05',{...base,document:{...base.document,content:{structure:{a:{text:repeated},b:{text:repeated}}}}}),false);
 assert.equal(result('DOC-06',base),true);assert.equal(result('DOC-07',base),true);assert.equal(result('DOC-08',base),true);
 assert.equal(result('DOC-07',{...base,file:{...base.file,sha256:'b'.repeat(64)}}),false);
 assert.equal(result('DOC-08',{...base,file:{...base.file,student_id:'other'}}),false);
 assert.equal(result('UNKNOWN',base),null);
});

test('automatic checker records server-derived results only',async()=>{
 let recorded;
 const db=async(path,method,body)=>{
  if(path.startsWith('studkab_document_versions?'))return {id:documentId,passport_id:'passport',content:base.document.content,docx_file_id:'file',docx_sha256:'a'.repeat(64)};
  if(path.startsWith('studkab_requirement_items?'))return [{id:requirementId,code:'DOC-07'}];
  if(path.startsWith('studkab_request_files?'))return {id:'file',...base.file};
  if(path.startsWith('studkab_requests?'))return {id:requestId,...base.request};
  if(path==='rpc/studkab_record_checks'){recorded=body;return {recorded:1};}
  throw Error('unexpected '+path);
 };
 const input={requestId,commandId:'55555555-5555-4555-8555-555555555555',payload:{documentId}};
 assert.deepEqual(await runAutomaticChecks({input,user:{id:'executor'},db}),{recorded:1});
 assert.equal(recorded.actor,'executor');assert.equal(recorded.payload.checks[0].status,'pass');assert.equal(recorded.payload.checks[0].evaluatorType,'automatic');
});
