import test from 'node:test';
import assert from 'node:assert/strict';
import {studentPreparation,sameStudentObservation} from '../student-assistant-ui.mjs';

test('a legacy taken request does not claim actual execution',()=>{
 const value=studentPreparation({route:'r3',stage:'r3_in_work'},null,{connected:true});
 assert.equal(value.label,'Задание у исполнителя');
 assert.notEqual(value.state,'dispatched');
});
test('questions and received files keep their existing student actions',()=>{
 assert.equal(studentPreparation({route:'r3',stage:'needs_answer'},null),null);
 assert.equal(studentPreparation({route:'r3',result:{name:'work.docx'}},null),null);
 assert.equal(studentPreparation({stage:'requirements_review'},null),null);
});
test('working files never leak through a student projection',()=>{
 const at='2026-10-09T10:00:00Z';
 const value=studentPreparation({route:'r3',stage:'r3_in_work',work:{takenAt:'2026-10-08T10:00:00Z',result:{name:'private.docx',size:20,hash:'a'.repeat(64),at}}},null,{connected:true});
 assert.equal(value.file,null);assert.equal(value.label,'Работа у исполнителя');
});
test('offline observations are stale and an account switch invalidates replies',()=>{
 assert.equal(studentPreparation({route:'r3',stage:'r3_in_work'},null,{connected:false}).stale,true);
 const expected={owner:'a',requestId:'rq1'};
 assert.equal(sameStudentObservation(expected,{owner:'b',requestId:'rq1'}),false);
 assert.equal(sameStudentObservation(expected,{owner:'a',requestId:'rq2'}),false);
 assert.equal(sameStudentObservation(expected,{owner:'a',requestId:'rq1'}),true);
 assert.equal(sameStudentObservation({owner:'',requestId:'rq1'},{owner:'',requestId:'rq1'}),false);
});
