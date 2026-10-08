import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAssistantState as project, adaptGenerationState} from '../assistant-state.mjs';
const t = n => `2026-10-08T${String(n).padStart(2,'0')}:00:00Z`;
const hash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
const base = {role:'executor', work:null, observation:{connected:true,lastConfirmedAt:t(15)}};
const prepared = {takenAt:t(10),result:{name:'Работа.docx',size:2100,at:t(13),hash},delivered:null};
const generation = (status='running') => ({job:{id:'job-one',status,created_at:t(11)},parts:[{state:'claimed',text:null}],diagnostics:[]});
const review = {state:'reviewed',receipt:{fileHash:hash,versionId:'version-one'},review:{versionId:'version-one',reviewId:'review-one',reviewedAt:t(14)}};

test('provider preference never invents acceptance or execution; taking preserves the manual route',()=>{
 for(const selectedProvider of ['claude','chatgpt','deepseek']){
  assert.equal(project({...base,selectedProvider}).state,'received');
  const state=project({...base,selectedProvider,work:{takenAt:t(10)}});
  assert.equal(state.state,'manual_work');assert.equal(state.provider,null);assert.equal(state.nextAction,'prepare_work');
 }
});
test('missing observations fail closed instead of pretending that a request is new',()=>{
 assert.equal(project({role:'executor',selectedProvider:'claude'}).state,'unknown');
 assert.equal(project({...base,work:{takenAt:'bad timestamp'}}).state,'unknown');
});
test('the checked unavailable connection is separate from a saved preference',()=>{
 const state=project({...base,connection:{provider:'chatgpt',available:false},selectedProvider:'claude'});
 assert.equal(state.state,'unavailable');assert.equal(state.provider,'chatgpt');
 assert.equal(project({...base,connection:{provider:'invented',available:false}}).state,'received');
});
test('legacy Claude queue acceptance and timestamp-confirmed dispatch are distinct',()=>{
 const input={...base,work:{takenAt:t(10)},claude:{queuedAt:t(11),files:8}};
 assert.equal(project(input).state,'queued');
 assert.equal(project({...input,claude:{...input.claude,startedAt:t(12)}}).state,'dispatched');
 assert.equal(project({...input,claude:{startedAt:t(12)}}).state,'unknown');
});
test('Claude result stored in its bridge is not yet a working file; missing attached file fails closed',()=>{
 const claude={queuedAt:t(10),startedAt:t(11),readyAt:t(12)};
 assert.equal(project({...base,claude}).state,'return_pending');
 assert.equal(project({...base,claude:{...claude,attachedAt:t(13)}}).state,'unknown');
 assert.equal(project({...base,claude:{...claude,attachedAt:t(13)},work:prepared}).state,'file_prepared');
});
test('generation running with a claimed part does not prove inference has started',()=>{
 const g=generation();
 assert.equal(project({...base,generation:g}).state,'queued');
 g.diagnostics=[{state:'sent',startedAt:t(12),reason:null}];
 assert.equal(project({...base,generation:g}).state,'dispatched');
 // Failed preparation timestamps and a claimed part are not dispatch evidence.
 g.diagnostics=[{state:'claimed',startedAt:t(12)}];
 assert.equal(adaptGenerationState(g).startedAt,null);
});
test('completed generated sections are not a returned Word document',()=>{
 const g=generation('complete');g.parts=[{state:'done',text:'Полный текст раздела'}];
 const state=project({...base,generation:g});
 assert.equal(state.state,'sections_ready');assert.equal(state.file,null);assert.notEqual(state.nextAction,'deliver_result');
 g.parts=[{state:'queued',text:null}];
 assert.equal(project({...base,generation:g}).state,'unknown');
});
test('an unknown dispatch cannot be advertised as execution or retried by the projection',()=>{
 const g=generation();g.diagnostics=[{state:'unknown',startedAt:t(12),detail:'SECRET'}];
 const state=project({...base,generation:g});
 assert.equal(state.state,'unknown');assert.equal(state.nextAction,'check_status');
 assert.equal(JSON.stringify(state).includes('SECRET'),false);
});
test('a saved working file requires review; a matching server review permits only the next action',()=>{
 assert.equal(project({...base,work:prepared}).state,'file_prepared');
 assert.equal(project({...base,work:prepared,reviewState:review}).state,'reviewed');
 assert.equal(project({...base,work:prepared,reviewState:review}).nextAction,'deliver_result');
 for(const invalid of [{...review,receipt:{...review.receipt,fileHash:otherHash}}, {...review,review:{...review.review,versionId:'other-version'}}, {state:'reviewed'}, {...review,review:{...review.review,reviewedAt:t(12)}}, {...review,state:'stale'}]){
  assert.equal(project({...base,work:prepared,reviewState:invalid}).state,'file_prepared');
 }
});
test('delivery, download and student-reported hand-in do not collapse into generation completion',()=>{
 const delivered={...prepared,delivered:{name:'Переданная.docx',size:2100,at:t(14),hash}};
 assert.equal(project({...base,work:delivered}).state,'delivered');
 assert.equal(project({...base,work:{...delivered,downloadedAt:t(15)}}).state,'downloaded');
 assert.equal(project({...base,work:{...delivered,downloadedAt:t(15),handedAt:t(16)}}).state,'handed');
 assert.equal(project({...base,work:{handedAt:t(16)}}).state,'unknown');
 assert.equal(project({...base,work:{...delivered,handedAt:t(13)}}).state,'unknown');
});
test('returned old file/old hand-in and old jobs cannot masquerade as the current rework result',()=>{
 const old={...prepared,delivered:{name:'Прежняя.docx',size:2100,at:t(14)},downloadedAt:t(15),handedAt:t(16),returnedAt:t(17)};
 const state=project({...base,work:old,claude:{queuedAt:t(11),startedAt:t(12)}});
 assert.equal(state.state,'rework');assert.equal(state.file,null);
 const newFile={...old,result:{...prepared.result,at:t(18),hash:otherHash}};
 assert.equal(project({...base,work:newFile,reviewState:review}).state,'file_prepared');
 assert.equal(project({...base,work:old,claude:{queuedAt:t(18)}}).state,'queued');
});
test('student sees no working file, internal hash, selected worker or diagnostic failure',()=>{
 const state=project({...base,role:'student',work:prepared,reviewState:review});
 assert.equal(state.file,null);assert.equal(state.provider,null);assert.equal(state.nextAction,null);assert.equal(state.reason,null);
 const delivered=project({...base,role:'student',work:{...prepared,delivered:{name:'Работа.docx',size:2100,at:t(14),hash}}});
 assert.deepEqual(delivered.file,{name:'Работа.docx',size:2100,at:t(14)});
 assert.equal(delivered.nextAction,'open_result');
 const failed=project({...base,role:'student',claude:{queuedAt:t(10),error:'private storage path'}});
 assert.equal(JSON.stringify(failed).includes('private'),false);
});
test('offline keeps only explicitly stale last-known facts and blocks action based on stale review',()=>{
 const state=project({...base,work:prepared,reviewState:review,observation:{connected:false,lastConfirmedAt:t(14)}});
 assert.equal(state.state,'reviewed');assert.equal(state.stale,true);assert.equal(state.lastConfirmedAt,t(14));assert.equal(state.nextAction,'check_status');
 assert.equal(project({...base,observation:{connected:false}}).lastConfirmedAt,null);
});
test('conflicting accepted jobs and impossible chronology fail closed; inputs remain immutable',()=>{
 const input={...base,claude:{queuedAt:t(11)},generation:generation('queued')};
 const original=JSON.stringify(input);
 assert.equal(project(input).state,'unknown');assert.equal(JSON.stringify(input),original);
 assert.equal(project({...base,claude:{queuedAt:t(12),startedAt:t(11)}}).state,'unknown');
 assert.equal(project({...base,work:{...prepared,takenAt:t(14)}}).state,'unknown');
});
