import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCalculationEvidence} from '../supabase/functions/studkab-generation-api/calculation-evidence.mjs';

const hash='a'.repeat(64),fingerprint='b'.repeat(64);
const source='Выручка 2024, млн руб.: 120,00. Затраты 2024, млн руб.: 35,00.';
const word='В 2024 году, млн руб., прибыль составляет 85,00 (выручка минус затраты).';
const packet={word:{fileHash:hash,text:word,textCoverage:{unreadParts:[]}},
 passport:{sourceFingerprint:fingerprint,items:[{id:'PROFIT',text:'Рассчитать прибыль за 2024 год',source_attachment_id:'data-1'}]},
 materials:[{id:'data-1',text:source},{id:'data-2',text:source}]};
const claim={wordHash:hash,passportFingerprint:fingerprint,requirementId:'PROFIT',operation:'subtract',
 period:'2024',unit:'млн руб.',decimals:2,
 operands:[{sourceId:'data-1',sourceQuote:'Выручка 2024, млн руб.: 120,00',value:'120,00'},
  {sourceId:'data-1',sourceQuote:'Затраты 2024, млн руб.: 35,00',value:'35,00'}],
 result:'85,00',wordQuote:word};
const check=(c=claim,p=packet)=>verifyCalculationEvidence(p,c);

test('exact decimal arithmetic checks two evidenced operands without granting passport pass',()=>{
 assert.deepEqual(check(),{status:'verified_arithmetic',reason:'single_operation_only',wordHash:hash,requirementId:'PROFIT'});
 assert.equal(check({...claim,result:'86,00',wordQuote:word.replace('85,00','86,00')},
  {...packet,word:{...packet.word,text:word.replace('85,00','86,00')}}).reason,'arithmetic_mismatch');
 const roundedWord='Прибыль в 2024 году, млн руб.: 0,67.';
 assert.equal(check({...claim,operation:'divide',operands:[
  {...claim.operands[0],value:'2',sourceQuote:'Делимое 2024, млн руб.: 2'},
  {...claim.operands[1],value:'3',sourceQuote:'Делитель 2024, млн руб.: 3'}],result:'0,67',wordQuote:roundedWord},
  {...packet,materials:[{id:'data-1',text:'Делимое 2024, млн руб.: 2. Делитель 2024, млн руб.: 3'}],
   word:{...packet.word,text:roundedWord}}).status,'verified_arithmetic');
});

test('missing input, changed version, wrong source or period cannot verify arithmetic',()=>{
 assert.equal(check({...claim,operands:[claim.operands[0]]}).status,'not_checked');
 assert.equal(check({...claim,operands:[null,claim.operands[1]]}).status,'not_checked');
 assert.equal(check({...claim,wordHash:'c'.repeat(64)}).reason,'version_mismatch');
 assert.equal(check({...claim,passportFingerprint:'c'.repeat(64)}).reason,'version_mismatch');
 assert.equal(check({...claim,operands:[{...claim.operands[0],sourceId:'data-2'},claim.operands[1]]}).reason,'source_mismatch');
 assert.equal(check({...claim,period:'2023'}).status,'not_checked');
 assert.equal(check({...claim,operands:[{...claim.operands[0],sourceQuote:'Выручка 2023 и 2024, млн руб.: 120,00'},claim.operands[1]]},
  {...packet,materials:[{id:'data-1',text:source+' Выручка 2023 и 2024, млн руб.: 120,00'}]}).status,'not_checked');
 assert.equal(check({...claim,wordQuote:word.replace('2024','2023 и 2024')},
  {...packet,word:{...packet.word,text:word.replace('2024','2023 и 2024')}}).status,'not_checked');
 assert.equal(check({...claim,unit:'тыс. руб.'}).status,'not_checked');
 assert.equal(check({...claim,operation:'irr'}).reason,'method_unsupported');
 assert.equal(check({...claim,operation:'divide',operands:[claim.operands[0],
  {...claim.operands[1],value:'0',sourceQuote:'Затраты 2024, млн руб.: 0'}]},
  {...packet,materials:[{id:'data-1',text:source+' Затраты 2024, млн руб.: 0'}]}).status,'not_checked');
 assert.equal(check({...claim,wordQuote:'85,00'}).reason,'word_evidence_missing');
 assert.equal(check(claim,{...packet,word:{...packet.word,textCoverage:{unreadParts:['word/footnotes.xml']}}}).reason,'word_incomplete');
});

test('a wrong formula, wrong rounding, unsupported number and duplicate evidence remain nonpositive',()=>{
 assert.equal(check({...claim,operation:'add'}).reason,'arithmetic_mismatch');
 assert.equal(check({...claim,decimals:1}).reason,'rounding_unsupported');
 assert.equal(check({...claim,operands:[{...claim.operands[0],value:'1200000000000'},claim.operands[1]]}).status,'not_checked');
 assert.equal(check(claim,{...packet,materials:[{id:'data-1',text:source+source}]}).reason,'source_evidence_missing');
 assert.equal(check(claim,{...packet,word:{...packet.word,text:word+'\n'+word}}).reason,'word_evidence_missing');
});
