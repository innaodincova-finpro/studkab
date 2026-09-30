import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const window={};
runInNewContext(readFileSync(new URL('../quality-evidence-ui.js',import.meta.url),'utf8'),{window});
const codes=[...Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')),'S01','S02','S03'];
const hash='a'.repeat(64);

test('AI assistance transfers only unresolved evidence for exact Word, never a positive mark',()=>{
 const report={wordHash:hash,findings:[{code:'C05',location:'Глава 2',requirement:'Задача',observation:'Нет расчёта',status:'fail'}],
  coverage:{checked:codes.filter(c=>!['C11','C12','S02'].includes(c)),notChecked:['C11','C12','S02']}};
 const suggestions=window.QualityEvidence.reviewSuggestions(report,hash);
 assert.equal(suggestions.C05.status,'fail');
 assert.match(suggestions.C05.evidence,/ИИ-помощник/);
 assert.equal(suggestions.C12.status,'manual');
 assert.equal(suggestions.C01,undefined);
 assert.ok(Object.values(suggestions).every(v=>v.status!=='pass'));
 assert.equal(window.QualityEvidence.reviewSuggestions(report,'b'.repeat(64)),null);
 assert.equal(window.QualityEvidence.reviewSuggestions({...report,coverage:{checked:codes,notChecked:['C12']}},hash),null);
 assert.equal(window.QualityEvidence.reviewSuggestions({...report,coverage:{checked:codes.filter(c=>c!=='C12'),notChecked:['C12']}},hash),null);
 assert.equal(window.QualityEvidence.reviewSuggestions({...report,findings:[{...report.findings[0],code:'X01'}]},hash),null);
});

test('combined findings retain both passes without opening a positive mark',()=>{
 const findings=Array.from({length:40},(_,i)=>({code:'C05',status:'fail',location:'Раздел '+i,requirement:'Условие '+i,observation:'Открытое замечание '+i}));
 const report={wordHash:hash,findings,reviewPasses:2,coverage:{checked:[],notChecked:codes}};
 assert.equal(window.QualityEvidence.reviewSuggestions(report,hash).C05.status,'fail');
 assert.equal(window.QualityEvidence.reviewSuggestions({...report,reviewPasses:1},hash),null);
 assert.equal(window.QualityEvidence.reviewSuggestions({...report,findings:[...findings,...findings]},hash),null);
});
