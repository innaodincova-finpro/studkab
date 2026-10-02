import test from 'node:test';import assert from 'node:assert/strict';
import {analysisPlan,validAnalysisPart} from '../supabase/functions/_shared/intake-analysis.mjs';
import {registeredAnalysisPlan,verifyKitReview,validReviewPart,REVIEW_VERSION} from '../supabase/functions/_shared/registered-review.mjs';
const original='Для анализа необходимы ОДДС и показатели за 2022–2024 годы. Справочник вузов не нужен.';
function source(extra={}){return {studyProtocol:REVIEW_VERSION,files:[{id:'file-1',file_name:'Задание.docx',file_hash:'a'.repeat(64),read_status:'ready',read_version:'reader-1',read_result:{status:'ready',readerVersion:'reader-1',blocks:[{text:original,source:{paragraph:1}}]}}],...extra};}
function output(part){return {covered:part.blocks.map(b=>b.blockId),gaps:[],answerReviews:[]};}
const ref=(b,quote=b.text)=>({blockId:b.blockId,quote});
test('whole-kit prompt keeps all 256 blocks while source metadata remains in the saved plan',()=>{
 const s=source();s.files[0].id='11111111-1111-4111-8111-111111111111';
 s.files[0].read_result.blocks=Array.from({length:256},(_,i)=>({text:'Требование '+i+': сохранить число и условие применения.',source:{paragraph:i+1,table:2,row:i+1,column:1,originalLabel:'Подробное служебное описание источника '.repeat(3)}}));
 const plan=registeredAnalysisPlan(s),part=plan.at(-1),prompt=JSON.parse(part.prompt);
 const old=JSON.stringify({blocks:part.blocks.map(b=>({blockId:b.blockId,text:b.text,source:b.source,fileId:b.fileId}))});
 assert.ok(new TextEncoder().encode(old).length>40000);
 assert.ok(new TextEncoder().encode(part.prompt).length<=40000);
 assert.equal(prompt.blocks.length,256);assert.deepEqual(prompt.blocks.map(b=>b.text),s.files[0].read_result.blocks.map(b=>b.text));
 assert.equal(validReviewPart(part,plan.length-1,plan.length),true);
 const x=output(part);x.gaps=[{key:'source_check',question:'Уточните условие.',reason:'Нужно уточнение.',refs:[ref(part.blocks[255])]}];
 const r=verifyKitReview(JSON.stringify(x),part).gaps[0].refs[0];
 assert.equal(r.source.paragraph,256);assert.equal(r.fileId,s.files[0].id);assert.equal(r.fileHash,s.files[0].file_hash);
});
test('registered adequacy is a separate budgeted final part; legacy plans do not change',()=>{
 const s=source(),plan=registeredAnalysisPlan(s),last=plan.at(-1);
 assert.equal(plan.length,2);assert.equal(validAnalysisPart(plan[0],0,plan[0].extraction_parts),true);assert.equal(validReviewPart(last,1,2),true);assert.equal(validReviewPart(last,0,2),false);
 assert.ok(last.max_cost_microusd>0);assert.deepEqual(registeredAnalysisPlan({...s,studyProtocol:undefined}),analysisPlan({...s,studyProtocol:undefined}));
 // PostgreSQL JSONB key ordering cannot invalidate a paid preparation.
 const reordered=JSON.parse(JSON.stringify(last));reordered.blocks[0].source=Object.fromEntries(Object.entries(reordered.blocks[0].source).reverse());
 assert.equal(validReviewPart(reordered,1,2),true);
});
test('whole-kit assessment validates complete and missing-data results with exact original grounds',()=>{
 const part=registeredAnalysisPlan(source()).at(-1),x=output(part);
 assert.equal(verifyKitReview(JSON.stringify(x),part).gaps.length,0);
 x.gaps=[{key:'cash_flow',question:'Предоставьте ОДДС за требуемые годы или поясните, где он находится.',reason:'Задание требует ОДДС; без него нельзя выполнить денежный анализ.',refs:[ref(part.blocks[0],'Для анализа необходимы ОДДС и показатели за 2022–2024 годы.')],answerId:null}];
 const verified=verifyKitReview(JSON.stringify(x),part);assert.equal(verified.gaps[0].refs[0].fileHash,'a'.repeat(64));assert.equal(verified.gaps.length,1);
 x.gaps[0].refs[0].quote='Обязательны ФИО и вуз';assert.throws(()=>verifyKitReview(JSON.stringify(x),part),/INVALID_REVIEW_SOURCE/);
});
test('every student answer gets a grounded adequacy judgment; insufficient or unknown requires a new private question',()=>{
 const s=source({studentAnswers:[{id:'answer-1',question:'Где ОДДС?',itemId:'FIELD_GAP_cash_flow',answer:'Не знаю',source:'Уточню у преподавателя',author:'student-1'}]}),part=registeredAnalysisPlan(s).at(-1),x=output(part);
 assert.throws(()=>verifyKitReview(JSON.stringify(x),part),/INCOMPLETE_KIT_REVIEW/);
 const answer=part.blocks.find(b=>b.source?.questionId==='answer-1');
 x.answerReviews=[{questionId:'answer-1',status:'insufficient',reason:'Ответ не предоставляет требуемый ОДДС.',refs:[ref(answer)]}];
 assert.throws(()=>verifyKitReview(JSON.stringify(x),part),/UNRESOLVED_STUDENT_ANSWER/);
 x.gaps=[{key:'cash_flow_followup',question:'Уточните у преподавателя, как получить ОДДС.',reason:'Требуемый документ пока не предоставлен.',refs:[ref(part.blocks[0]),ref(answer)],answerId:'answer-1'}];
 assert.equal(verifyKitReview(JSON.stringify(x),part).answerReviews[0].status,'insufficient');
 x.answerReviews[0].status='unknown';assert.equal(verifyKitReview(JSON.stringify(x),part).gaps.length,1);
 x.answerReviews[0].status='sufficient';assert.throws(()=>verifyKitReview(JSON.stringify(x),part),/UNRESOLVED_STUDENT_ANSWER/);
 x.gaps=[];assert.throws(()=>verifyKitReview(JSON.stringify(x),part),/UNRESOLVED_STUDENT_ANSWER/);
 x.answerReviews[0].refs.push(ref(part.blocks[0]));assert.equal(verifyKitReview(JSON.stringify(x),part).answerReviews[0].status,'sufficient');
});
test('whole-kit review rejects omissions, duplicate gap keys, invented sources and guidance used as facts',()=>{
 const part=registeredAnalysisPlan(source({reviewInstructions:[{comment:'Вымышленный ОДДС'}]})).at(-1),base=output(part);
 for(const mutate of [x=>x.covered=[],x=>x.covered.push(x.covered[0]),x=>x.gaps=[{key:'bad',question:'Что?',reason:'Почему?',refs:[{blockId:'guidance',quote:'Вымышленный ОДДС'}]}]]){const x=structuredClone(base);mutate(x);assert.throws(()=>verifyKitReview(JSON.stringify(x),part));}
 const gap={key:'same',question:'Где данные?',reason:'Нет нужных данных.',refs:[ref(part.blocks[0])]};assert.throws(()=>verifyKitReview(JSON.stringify({...base,gaps:[gap,gap]}),part),/INVALID_KIT_REVIEW/);
});
test('oversized or unread kits are processing blockers; the final review never truncates originals',()=>{
 const s=source();s.files[0].read_result.blocks=[{text:original.repeat(1200),source:{paragraph:1}}];
 assert.throws(()=>registeredAnalysisPlan(s),/ANALYSIS_LIMIT|KIT_REVIEW_LIMIT/);
 const unread=source();unread.files[0].read_status='failed';assert.throws(()=>registeredAnalysisPlan(unread),/READING_INCOMPLETE/);
});
test('every returned proposal needs a concrete reason and original evidence; unresolved return needs a new question',()=>{
 const part=registeredAnalysisPlan(source({reviewInstructions:[{proposalId:'proposal-1',itemId:'FIELD_GAP_cash_flow',comment:'Проверьте ОДДС во всём комплекте.'}]})).at(-1),x=output(part);
 assert.throws(()=>verifyKitReview(JSON.stringify(x),part),/INCOMPLETE_RETURNED_REVIEW/);
 x.returnedReviews=[{proposalId:'proposal-1',status:'resolved',reason:'ОДДС найден в другом документе комплекта.',refs:[ref(part.blocks[0])]}];
 assert.equal(verifyKitReview(JSON.stringify(x),part).returnedReviews[0].status,'resolved');
 x.returnedReviews[0].status='unresolved';assert.throws(()=>verifyKitReview(JSON.stringify(x),part),/UNRESOLVED_RETURNED_REVIEW/);
 x.gaps=[{key:'cash_flow',question:'Где необходимый ОДДС?',reason:'Требуемый документ не найден.',refs:[ref(part.blocks[0])],returnedProposalIds:['proposal-1']}];
 assert.equal(verifyKitReview(JSON.stringify(x),part).gaps.length,1);
 x.returnedReviews[0].status='resolved';assert.throws(()=>verifyKitReview(JSON.stringify(x),part),/UNRESOLVED_RETURNED_REVIEW/);
 x.returnedReviews[0].refs=[{blockId:'guidance',quote:'Проверьте ОДДС во всём комплекте.'}];assert.throws(()=>verifyKitReview(JSON.stringify(x),part),/INVALID_REVIEW_SOURCE/);
});
