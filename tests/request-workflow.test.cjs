const test=require('node:test');
const assert=require('node:assert/strict');
const workflow=require('../request-workflow.js');

test('request workflow has one ordered stage and action',()=>{
 const cases=[
  [{},['intake','Проверить комплект']],
  [{hasPassport:true,passportUnresolved:true,passportBlocker:'Не указано: объём'},['passport','Уточнить требования']],
  [{hasPassport:true},['passport','Утвердить паспорт']],
  [{hasPassport:true,passportApproved:true},['preparation','Выбрать способ подготовки']],
  [{hasPassport:true,passportApproved:true,hasServerJob:true},['preparation','Продолжить подготовку']],
  [{hasPassport:true,passportApproved:true,hasServerJob:true,hasDocument:true},['quality','Проверить готовность документа']],
  [{hasPassport:true,passportApproved:true,hasDocument:true,automaticReviewCurrent:true},['delivery','Провести итоговую проверку']],
  [{delivered:true},['delivered','']],
  [{cancelled:true},['cancelled','']]
 ];
 for(const [facts,expected] of cases){const result=workflow.derive(facts);assert.equal(result.key,expected[0]);assert.equal(result.label,expected[1]);assert.equal(result.steps.length,5);}
});

test('a saved job does not hide quality review when document text exists',()=>{
 const result=workflow.derive({hasPassport:true,passportApproved:true,hasServerJob:true,hasDocument:true});
 assert.equal(result.key,'quality');
 assert.equal(result.action,'doc-open');
});

test('external Word requires review and never bypasses passport or cancellation',()=>{
 const facts={hasExternalWord:true,hasPassport:true,passportApproved:true};
 assert.equal(workflow.derive(facts).action,'review-word');
 assert.equal(workflow.derive({...facts,passportUnresolved:true}).action,'passport-edit');
 assert.equal(workflow.derive({...facts,cancelled:true}).key,'cancelled');
 assert.equal(workflow.derive({...facts,delivered:true}).key,'delivered');
});
