// ROUTE-02-C, BENCH-01: учебный стенд проверки комплекта.
// Стенд прогоняет учебные комплекты с заранее заложенными дефектами через тот же
// способ проверки, что и кабинет, и считает, сколько дефектов найдено.
// К заявкам, студентам и кабинету стенд не подключён: комплекты лежат в репозитории.
import {kitPlan,verifyKitReviewOutput,KIT_REVIEW_SYSTEM,KIT_REVIEW_SYSTEM_V1} from './kit-analysis.mjs';
import {reserveMicrousd} from './deepseek-cost.mjs';
import {sameSecret} from './secret-equal.mjs';
import {checklistInventoryPart,verifyInventory,checklistVerifyPart,verifyChecks,checklistGaps,CHECKLIST_INVENTORY_SYSTEM,CHECKLIST_VERIFY_SYSTEM} from './kit-checklist.mjs';

export const BENCH_KIT_ID=/^[A-Z][0-9]{1,2}$/;
export const BENCH_COMMIT=/^[0-9a-f]{40}$/;
const PART='word/document.xml',READER='bench-kit-1';
const text=s=>typeof s==='string'&&s.trim().length>0&&s.length<=6000;

// Комплект стенда: файлы с абзацами и таблицами; ожидаемые дефекты модели не передаются.
export function validateBenchKit(kit,id){
 if(!kit||typeof kit!=='object'||kit.id!==id||!BENCH_KIT_ID.test(kit.id))throw Error('BENCH_KIT_INVALID');
 if(!Array.isArray(kit.files)||!kit.files.length||kit.files.length>8)throw Error('BENCH_KIT_INVALID');
 for(const f of kit.files){
  if(!f||typeof f.name!=='string'||!/^[^/\\]{1,120}\.docx$/.test(f.name)||!Array.isArray(f.items)||!f.items.length||f.items.length>200)throw Error('BENCH_KIT_INVALID');
  for(const i of f.items){
   if(typeof i==='string'){if(!text(i))throw Error('BENCH_KIT_INVALID');continue;}
   if(!i||!Array.isArray(i.table)||!i.table.length||i.table.length>60||i.table.some(r=>!Array.isArray(r)||!r.length||r.length>12||r.some(c=>typeof c!=='string'||c.length>2000)))throw Error('BENCH_KIT_INVALID');
  }
 }
 if(typeof kit.deadline!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(kit.deadline))throw Error('BENCH_KIT_INVALID');
 if(kit.notes!=null&&!text(kit.notes))throw Error('BENCH_KIT_INVALID');
 if(!Array.isArray(kit.expected)||kit.expected.length>5||kit.expected.some(d=>!d||!/^[a-z_]{1,40}$/.test(d.key)||!Array.isArray(d.keywords)||!d.keywords.length||d.keywords.some(k=>typeof k!=='string'||!k.trim())))throw Error('BENCH_KIT_INVALID');
 return kit;
}

// Приводит комплект к виду прочитанных файлов: те же блоки, что выдаёт чтение DOCX.
export function benchSnapshot(kit){
 const files=kit.files.map((f,n)=>{
  const blocks=[];let paragraph=0,table=0;
  for(const i of f.items){
   if(typeof i==='string'){blocks.push({kind:'paragraph',text:i,source:{part:PART,paragraph:++paragraph}});continue;}
   table++;
   i.table.forEach((row,r)=>row.forEach((cell,c)=>blocks.push({kind:'table_cell',text:cell,source:{part:PART,table,row:r+1,column:c+1}})));
  }
  const id='00000000-0000-4000-8000-'+String(n+1).padStart(12,'0');
  return {id,file_name:f.name,file_hash:'0'.repeat(63)+String(n+1),state:'saved',read_status:'ready',read_version:READER,
   read_result:{schema:1,readerVersion:READER,status:'ready',blocks,warnings:[]}};
 });
 return {requestId:'bench-'+kit.id,deadline:kit.deadline,notes:kit.notes||'',files,studentAnswers:[],reviewInstructions:[]};
}

// Способы проверки, которые умеет прогонять стенд. Новый способ добавляется сюда
// и сравнивается с прежним на тех же комплектах.
// Каждый способ получает функцию ask(system, part, step): она резервирует сумму стенда,
// обращается к модели и возвращает текст ответа. Способ сам проверяет ответы и
// возвращает итоговые вопросы. Несколько обращений — несколько отдельных резервов.
export const BENCH_METHODS={
 'whole-kit-2':async(snapshot,ask)=>{const review=kitPlan(snapshot)[1];return verifyKitReviewOutput(await ask(KIT_REVIEW_SYSTEM,review,''),review).gaps;},
 // KIT-05: прежняя инструкция на том же запросе — для сравнения с действующей.
 'baseline-1':async(snapshot,ask)=>{const review=kitPlan(snapshot)[1];const part={...review,max_cost_microusd:reserveMicrousd(KIT_REVIEW_SYSTEM_V1,review.prompt,review.max_output_tokens)};return verifyKitReviewOutput(await ask(KIT_REVIEW_SYSTEM_V1,part,''),review).gaps;},
 // KIT-05: пошаговая проверка — перечень нужного и параметров, затем сверка каждого пункта.
 'checklist-3':async(snapshot,ask)=>{
  const inv=checklistInventoryPart(snapshot);
  const inventory=verifyInventory(await ask(CHECKLIST_INVENTORY_SYSTEM,inv,'s1'),inv);
  const check=checklistVerifyPart(inv,inventory);
  const absent=check?verifyChecks(await ask(CHECKLIST_VERIFY_SYSTEM,check,'s2'),check):[];
  return checklistGaps(inv.blocks,inventory,absent);
 },
};

// Дефект считается найденным, если вопрос или пояснение содержит одно из его ключевых слов.
// Вопросы, не относящиеся ни к одному заложенному дефекту, считаются лишними.
export function scoreBench(kit,gaps){
 const found=new Set();let extra=0;
 for(const g of gaps){
  const t=(g.question+' '+g.reason).toLowerCase();
  const d=kit.expected.find(d=>d.keywords.some(k=>t.includes(k.toLowerCase())));
  if(d)found.add(d.key);else extra++;
 }
 return {expected:kit.expected.length,found:[...found],missed:kit.expected.map(d=>d.key).filter(k=>!found.has(k)),extra,questions:gaps.length};
}

const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
// Порядок: машинная авторизация, служебный ключ, проверка входа, резерв бюджета стенда,
// и только затем платное обращение к модели. Повторов нет: каждый прогон — одна попытка.
export function benchHandler({authorize,config,rpc,fetchKit,provider}){
 return async req=>{
  if(req.method!=='POST')return reply({error:'METHOD'},405);
  try{if(!await authorize(req))return reply({error:'UNAUTHORIZED'},401);}catch{return reply({error:'AUTH_UNAVAILABLE'},503);}
  let cfg;try{cfg=await config();}catch{return reply({error:'CONFIG_UNAVAILABLE'},503);}
  if(!sameSecret(req.headers.get('X-Studkab-Runner'),cfg?.cron_token))return reply({error:'UNAUTHORIZED'},401);
  let input;try{const raw=await req.text();if(raw.length>2000)throw 0;input=JSON.parse(raw);}catch{return reply({error:'BAD_REQUEST'},400);}
  if(!input||!BENCH_KIT_ID.test(input.kit)||!BENCH_COMMIT.test(input.commit)||!Object.hasOwn(BENCH_METHODS,input.method))return reply({error:'BAD_REQUEST'},400);
  let kit,snapshot;
  try{kit=validateBenchKit(await fetchKit(input.commit,input.kit),input.kit);snapshot=benchSnapshot(kit);}
  catch{return reply({error:'KIT_UNAVAILABLE'},422);}
  const calls=[];
  class Stop extends Error{}
  const ask=async(system,part,step)=>{
   if(!Number.isSafeInteger(part.max_cost_microusd)||part.max_cost_microusd<=0)throw new Stop('invalid:COST');
   let run;
   try{run=await rpc('studkab_kit_bench_reserve',{p_kit:kit.id,p_method:input.method+(step?'-'+step:''),p_commit:input.commit,p_cost:part.max_cost_microusd});}
   catch{throw new Stop('reserve_unconfirmed');}
   if(!run)throw new Stop('budget_or_disabled');
   let output=null;try{output=await provider({input:{system},spec:part},run);}catch{}
   const ok=output?.complete===true&&typeof output.text==='string'&&new TextEncoder().encode(output.text).byteLength<=100000;
   const usage=output?.detail&&typeof output.detail==='object'?{prompt:output.detail.prompt_tokens??null,completion:output.detail.completion_tokens??null}:null;
   calls.push({run,raw:ok?output.text:null,usage,step});
   if(!ok)throw new Stop(output?.detail?.reason==='length'?'length':'provider');
   return output.text;
  };
  let gaps=null,error=null;
  try{gaps=await BENCH_METHODS[input.method](snapshot,ask);}
  catch(e){error=e instanceof Stop?e.message:'invalid:'+String(e?.message||'').replace(/[^A-Z_]/g,'').slice(0,60);}
  if(!calls.length)return reply({status:error||'no_call'},error==='reserve_unconfirmed'?503:200);
  const score=gaps?scoreBench(kit,gaps):null;
  // Итог и подсчёт сохраняются в последнем обращении; у каждого — свой фактический расход.
  for(const [i,c] of calls.entries()){
   const last=i===calls.length-1;
   const result={step:c.step||null,usage:c.usage,...(last?{score,gaps:gaps?gaps.map(g=>({type:g.type||null,question:g.question,reason:g.reason,quotes:g.refs.map(r=>r.quote.slice(0,300))})):null}:{})};
   try{await rpc('studkab_kit_bench_finish',{p_run:c.run,p_raw:c.raw,p_result:result,p_error:last?error:null});}
   catch{return reply({status:'save_unconfirmed',run:c.run},503);}
  }
  const run=calls.at(-1).run;
  return reply({status:error?'failed':'done',run,kit:kit.id,method:input.method,score,error});
 };
}
