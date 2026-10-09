import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceAssistantPlan} from '../supabase/functions/studkab-requests/assistant-source-plan.mjs';
const bundle={fingerprint:'a'.repeat(64),files:[]};
const source=text=>({request:{payload:{rq:text}}});
test('server freezes explicit assignment outputs without legacy passport or invented chapter',async()=>{
 const p=await sourceAssistantPlan({source:source('Вопросы для ответа:\n1. Объясните правило\n2. Решите задачу'),bundle},{readFile:async()=>{throw Error('No files')}});
 assert.deepEqual(p.sections,['section_1','section_2']);assert.deepEqual(p.evidence.sourceRefs,['request.rq']);assert.equal(p.evidence.sourceFingerprint,bundle.fingerprint);
});
test('unstructured, ambiguous and unreadable sources do not become fake whole_document scope',async()=>{
 assert.equal(await sourceAssistantPlan({source:source('Практическая работа по праву'),bundle},{readFile:async()=>{}}),null);
 assert.equal(await sourceAssistantPlan({source:source('Задания:\n1. A\n\nВопросы:\n1. B'),bundle},{readFile:async()=>{}}),null);
 const b={...bundle,files:[{id:'file',bytes:new Uint8Array([1]),type:'text/plain'}]};
 assert.equal(await sourceAssistantPlan({source:source(''),bundle:b},{readFile:async()=>({status:'ready',extracted_text:'Задания:\n1. A',warnings:[{}]})}),null);
});
