// ROUTE-02-C, KIT-06: пошаговая проверка комплекта (checklist-3) в разборе настоящих заявок.
// План из трёх частей одного способа: сведения о работе (как прежде), перечень нужного
// (шаг 1) и заключение (шаг 2). Запрос шага 2 строится во время выполнения из сохранённого
// результата шага 1, поэтому в плане он отмечен deferred, а резерв задан верхней границей
// размера. Заключение сохраняет прежний вид kitReview: вопросы, оценка каждого ответа
// студента и каждого возвращённого исполнителем вопроса. Цитаты берёт сервер по номерам.
import {ANALYSIS_VERSION,distribute} from './intake-analysis.mjs';
import {REVIEW_VERSION} from './registered-review.mjs';
import {kitBlocks,kitPrompt,canon,canonBlocks,KIT_EXTRACTION_SYSTEM,KIT_OUTPUT_TOKENS,KIT_PROMPT_BYTES,KIT_BLOCK_LIMIT,KIT_BLOCK_BYTES} from './kit-analysis.mjs';
import {CHECKLIST_METHOD,CHECKLIST_VERIFY_BYTES,CHECKLIST_INVENTORY_SYSTEM,CHECKLIST_VERIFY_SYSTEM,verifyInventory,verifyChecks,checklistGaps} from './kit-checklist.mjs';
import {reserveMicrousd} from './deepseek-cost.mjs';

const bytes=s=>new TextEncoder().encode(s).byteLength;
const bounded=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;

// Дополнение к инструкции шага 2, только когда есть ответы студента, возвраты или указания.
// Без них используется ровно та инструкция, что прошла проверку на учебном стенде.
export const CHECKLIST_DIALOG_SYSTEM=CHECKLIST_VERIFY_SYSTEM.replace(/ Верни только JSON без пояснений: .*$/,'')
+' Кроме перечня в запросе могут быть: answers — вопросы, уже заданные студенту (id, question); его ответы стоят во фрагментах «Ответы студента» с answerId; returned — вопросы, которые исполнитель вернул с комментарием (proposalId, question, comment); guidance — указания исполнителя. Комментарии и указания — направление проверки, а не факт: проверяй их по документам. Ответ студента не заменяет документ преподавателя. Пункт перечня, закрытый ответом студента, — found с ids фрагментов ответа. Если вопрос был о выборе между значениями, которые расходятся в документах, и студент прямо выбрал одно из этих значений или назвал документ, по которому работать, — это sufficient: студент передаёт решение преподавателя, объяснять причину выбора он не обязан; противоречие по этому пункту закрыто. Если студент пишет, что приложил файл или данные, а среди фрагментов их нет, — insufficient с вопросом приложить файл. Если пункт перечня по смыслу совпадает с возвращённым вопросом, укажи в нём returnedProposalId. '
+'Каждый ответ студента оцени в answerReviews: questionId — id вопроса; status — sufficient (ответ закрывает вопрос), insufficient (не закрывает) или unknown (нельзя определить); reason — почему; ids — фрагменты ответа и документов; для insufficient и unknown — question: новый конкретный вопрос студенту. '
+'Каждый возвращённый вопрос оцени в returnedReviews: proposalId; status — resolved (документы подтверждают, что вопрос не нужен), unresolved (вопрос остаётся) или unknown; reason — почему, со ссылкой на документы; ids — фрагменты документов. '
+'Верни только JSON без пояснений: {"checks":[{"n":0,"status":"absent","ids":[],"returnedProposalId":null}],"answerReviews":[{"questionId":"id","status":"sufficient","reason":"почему","ids":["b9"],"question":""}],"returnedReviews":[{"proposalId":"id","status":"resolved","reason":"почему","ids":["b4"]}]}';

function dialog(source,returnedQuestions){
 const instructions=source.reviewInstructions||[];
 if(!Array.isArray(instructions)||instructions.length>20||instructions.some(x=>typeof x.comment!=='string'||x.comment.length>1000))throw Error('ANALYSIS_LIMIT');
 const asked=new Map((Array.isArray(returnedQuestions)?returnedQuestions:[]).filter(q=>q&&typeof q.question==='string').map(q=>[q.proposalId,q.question.slice(0,2000)]));
 return {instructions,
  answers:(source.studentAnswers||[]).map(a=>({id:a.id,question:a.question,itemId:a.itemId})),
  returned:instructions.filter(i=>i.proposalId).map(i=>({proposalId:i.proposalId,itemId:i.itemId,comment:i.comment,question:asked.get(i.proposalId)||''})),
  guidance:instructions.filter(i=>!i.proposalId).map(i=>({comment:i.comment}))};
}
const hasDialog=p=>p.answers.length>0||p.returned.length>0||p.guidance.length>0;
export const reviewSystem=p=>hasDialog(p)?CHECKLIST_DIALOG_SYSTEM:CHECKLIST_VERIFY_SYSTEM;

export function checklistPlan(source,returnedQuestions){
 const d=dialog(source,returnedQuestions);
 const blocks=kitBlocks(source);
 const base={analysis_version:ANALYSIS_VERSION,method:CHECKLIST_METHOD,blocks,max_output_tokens:KIT_OUTPUT_TOKENS,temperature:0};
 const extraction={...base,kind:'kit_extraction',prompt:kitPrompt('extraction',blocks)};
 const inventory={...base,kind:'checklist_inventory',prompt:kitPrompt('inventory',blocks)};
 for(const p of [extraction,inventory])if(bytes(p.prompt)>KIT_PROMPT_BYTES)throw Error('KIT_REVIEW_LIMIT');
 extraction.max_cost_microusd=reserveMicrousd(KIT_EXTRACTION_SYSTEM,extraction.prompt,KIT_OUTPUT_TOKENS);
 inventory.max_cost_microusd=reserveMicrousd(CHECKLIST_INVENTORY_SYSTEM,inventory.prompt,KIT_OUTPUT_TOKENS);
 const review={...base,kind:'kit_review',review_version:REVIEW_VERSION,deferred:true,answers:d.answers,returned:d.returned,guidance:d.guidance,reviewInstructions:d.instructions};
 // Верхняя граница: запрос шага 2 не длиннее CHECKLIST_VERIFY_BYTES; иначе он не отправляется.
 review.max_cost_microusd=reserveMicrousd(reviewSystem(review),'',KIT_OUTPUT_TOKENS,CHECKLIST_VERIFY_BYTES);
 return [extraction,inventory,review];
}
export const isChecklistPart=part=>part?.method===CHECKLIST_METHOD;

// Проверка части перед платной отправкой: запрос и резерв пересчитываются из сохранённых данных.
export function validChecklistPart(part,ordinal,total){
 if(!isChecklistPart(part)||part.analysis_version!==ANALYSIS_VERSION||total!==3||part.max_output_tokens!==KIT_OUTPUT_TOKENS||part.temperature!==0)return false;
 if(!Array.isArray(part.blocks)||!part.blocks.length||part.blocks.length>KIT_BLOCK_LIMIT)return false;
 if(part.blocks.some((b,i)=>b.blockId!=='b'+i||typeof b.text!=='string'||!b.text.trim()||bytes(b.text)>KIT_BLOCK_BYTES+200))return false;
 const same=(kind,system)=>bytes(part.prompt||'')<=KIT_PROMPT_BYTES&&JSON.stringify(canon(JSON.parse(part.prompt)))===JSON.stringify(canon(JSON.parse(kitPrompt(kind,canonBlocks(part.blocks)))))&&part.max_cost_microusd===reserveMicrousd(system,part.prompt,KIT_OUTPUT_TOKENS);
 if(part.kind==='kit_extraction')return ordinal===0&&same('extraction',KIT_EXTRACTION_SYSTEM);
 if(part.kind==='checklist_inventory')return ordinal===1&&same('inventory',CHECKLIST_INVENTORY_SYSTEM);
 if(part.kind==='kit_review')return ordinal===2&&part.deferred===true&&part.prompt===undefined&&part.review_version===REVIEW_VERSION&&Array.isArray(part.answers)&&part.answers.length<=100&&Array.isArray(part.returned)&&part.returned.length<=20&&Array.isArray(part.guidance)&&part.max_cost_microusd===reserveMicrousd(reviewSystem(part),'',KIT_OUTPUT_TOKENS,CHECKLIST_VERIFY_BYTES);
 return false;
}

// Результат шага 1 в общем журнале частей: поля candidates/roles обязательны для сервера.
export function checklistInventoryResult(text,part){
 const r=verifyInventory(text,part);
 return {candidates:[],roles:[],covered:part.blocks.map(b=>b.blockId),method:CHECKLIST_METHOD,...r};
}

// Запрос шага 2 собирается из сохранённого результата шага 1 — одинаково при каждом пересчёте.
export function checklistReviewRequest(part,inventory){
 if(!inventory||!Array.isArray(inventory.needs)||!Array.isArray(inventory.params))throw Error('INVENTORY_MISSING');
 const checks=inventory.needs;
 const extra={checks:checks.map((n,i)=>({n:i,need:n.need,required_ids:n.required,...(n.found.length?{claimed_ids:n.found}:{})}))};
 if(hasDialog(part))Object.assign(extra,{answers:part.answers,returned:part.returned,guidance:part.guidance});
 const request={...part,prompt:kitPrompt('verify',part.blocks,extra),checks};
 delete request.deferred;
 if(bytes(request.prompt)>CHECKLIST_VERIFY_BYTES)throw Error('KIT_REVIEW_LIMIT');
 return request;
}

function parse(text){
 if(typeof text!=='string'||bytes(text)>100000)throw Error('INVALID_KIT_REVIEW');
 const fence=text.match(/^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/);
 try{return JSON.parse(fence?fence[1]:text);}catch{throw Error('INVALID_KIT_REVIEW');}
}
function refsOf(ids,known){
 return (Array.isArray(ids)?[...new Set(ids.filter(id=>typeof id==='string'&&known.has(id)))].slice(0,12):[]).map(id=>{const b=known.get(id);
  return {blockId:b.blockId,fileId:b.fileId||null,fileHash:b.fileHash||null,fileName:b.fileName||null,readerVersion:b.readerVersion??null,source:b.source,quote:b.text,kind:b.kind,formula:null,cachedValue:null};});
}

// Заключение шага 2: вопросы по перечню и параметрам, затем оценки ответов и возвратов.
// Возврат, признанный обоснованным (resolved), снимает связанный с ним вопрос перечня.
// Недостаточный или неясный ответ и неснятый возврат всегда дают вопрос — паспорт не утверждается.
export function checklistReviewOutput(text,request,inventory){
 const x=parse(text);
 if(!x||!Array.isArray(x.checks))throw Error('INVALID_KIT_REVIEW');
 const known=new Map(request.blocks.map(b=>[b.blockId,b])),rejected=[];
 const returnedIds=new Set(request.returned.map(r=>r.proposalId)),answerIds=new Set(request.answers.map(a=>a.id));
 const absent=verifyChecks(JSON.stringify({checks:x.checks}),request);
 const link=new Map();
 for(const c of x.checks)if(c&&Number.isInteger(c.n)&&returnedIds.has(c.returnedProposalId))link.set(c.n,c.returnedProposalId);
 const returnedReviews=request.returned.map(r=>{
  const m=(Array.isArray(x.returnedReviews)?x.returnedReviews:[]).find(v=>v&&v.proposalId===r.proposalId);
  const ok=m&&['resolved','unresolved','unknown'].includes(m.status)&&bounded(m.reason,2000);
  if(m&&!ok)rejected.push({item:JSON.stringify(m).slice(0,500),reason:'INVALID_RETURNED_REVIEW'});
  return ok?{proposalId:r.proposalId,status:m.status,reason:m.reason.trim(),refs:refsOf(m.ids,known)}
   :{proposalId:r.proposalId,status:'unknown',reason:'Заключение по возвращённому вопросу не получено.',refs:[]};
 });
 const resolved=new Set(returnedReviews.filter(r=>r.status==='resolved').map(r=>r.proposalId));
 const kept=absent.filter(n=>{const i=request.checks.indexOf(n);return !resolved.has(link.get(i));});
 const gaps=checklistGaps(request.blocks,inventory,kept).map(g=>({...g,answerId:null,returnedProposalIds:[]}));
 // Вопрос перечня, связанный с неснятым возвратом, несёт номер этого возврата.
 kept.forEach((n,k)=>{const p=link.get(request.checks.indexOf(n));if(p)gaps[k].returnedProposalIds=[p];});
 let r=0;
 for(const v of returnedReviews)if(v.status!=='resolved'&&!gaps.some(g=>g.returnedProposalIds.includes(v.proposalId))){
  const q=request.returned.find(t=>t.proposalId===v.proposalId);
  gaps.push({key:'returned_'+(++r),type:'missing',question:q.question||('Вопрос остаётся открытым: '+v.reason),reason:v.reason,refs:v.refs,answerId:null,returnedProposalIds:[v.proposalId]});
 }
 let a=0;
 const answerReviews=request.answers.map(q=>{
  const m=(Array.isArray(x.answerReviews)?x.answerReviews:[]).find(v=>v&&v.questionId===q.id);
  const ok=m&&['sufficient','insufficient','unknown'].includes(m.status)&&bounded(m.reason,2000);
  if(m&&!ok)rejected.push({item:JSON.stringify(m).slice(0,500),reason:'INVALID_ANSWER_REVIEW'});
  const review=ok?{questionId:q.id,status:m.status,reason:m.reason.trim(),refs:refsOf(m.ids,known)}
   :{questionId:q.id,status:'unknown',reason:'Оценка ответа не получена.',refs:[]};
  if(review.status!=='sufficient'){
   const own=request.blocks.filter(b=>b.source?.questionId===q.id).map(b=>b.blockId);
   gaps.push({key:'answer_'+(++a),type:'missing',question:ok&&bounded(m.question,2000)?m.question.trim():'Ответ на вопрос «'+String(q.question||'').slice(0,300)+'» не закрывает его. Уточните, пожалуйста.',reason:review.reason,refs:refsOf([...own,...review.refs.map(x=>x.blockId)],known),answerId:q.id,returnedProposalIds:[]});
  }
  return review;
 });
 if(answerReviews.some(v=>!answerIds.has(v.questionId)))throw Error('INVALID_KIT_REVIEW');
 // KIT-07b: расхождение параметра находит программа по числам в документах, поэтому оно
 // повторялось бы и после ответа студента. Достаточный ответ студента на вопрос об этом же
 // параметре («…параметра «объём основной части»…») закрывает расхождение.
 const settled=request.answers.filter(q=>answerReviews.some(v=>v.questionId===q.id&&v.status==='sufficient')).map(q=>String(q.question||''));
 const param=g=>(/параметра «([^»]+)»/.exec(g.question)||[])[1];
 const open=gaps.filter(g=>!(g.type==='conflict'&&param(g)&&settled.some(t=>t.includes('параметра «'+param(g)+'»'))));
 return {candidates:[],roles:[],covered:request.blocks.map(b=>b.blockId),reviewVersion:REVIEW_VERSION,method:CHECKLIST_METHOD,gaps:open,answerReviews,returnedReviews,rejected};
}

export function finishChecklistReview(previous,review){
 const result=distribute(previous);
 const rejected=previous.flatMap(p=>p.rejected||[]);
 return {...result,method:CHECKLIST_METHOD,rejected,kitReview:{version:REVIEW_VERSION,method:CHECKLIST_METHOD,gaps:review.gaps,answerReviews:review.answerReviews,returnedReviews:review.returnedReviews,rejected:review.rejected||[]},
  limitations:[...result.limitations,'Заключение о достаточности комплекта требует предметной приёмки; положительный паспорт отдельно не утверждается.']};
}
