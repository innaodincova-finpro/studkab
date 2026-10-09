import {projectAssistantState} from './assistant-state.mjs';
import {createFinanceSession} from './assistant-finance-ui.mjs';

const providers=['claude','chatgpt','deepseek'];
export function createAssistantSession({api,active,onChange,newOperation}) {
 const state={busy:false,message:'',unknown:false,capabilities:null,checkedAt:null,job:null,receipt:null,operation:null,provider:null,stale:false,quote:null};
 const publish=()=>{if(active())onChange(state);};
 function absorb(result){
  if(Object.hasOwn(result||{},'job'))state.job=result.job;
  if(result?.receipt)state.receipt=result.receipt;
  if(result?.state==='prepared'){
   state.job={id:result.jobId,provider:state.provider,state:'prepared',acceptedAt:result.acceptedAt||result.receipt.acceptedAt,operationId:result.receipt.operationId,planReady:result.planReady,revision:result.receipt.revision,fingerprint:result.receipt.fingerprint};
   state.message='Комплект принят системой. Начало подготовки не подтверждено.';
  }
 }
 function receiptValid(result,requireFiles=true){
  const receipt=result?.receipt,at=result?.acceptedAt||receipt?.acceptedAt;
  return typeof result?.jobId==='string'&&!!result.jobId&&typeof at==='string'&&Number.isFinite(Date.parse(at))&&receipt?.operationId===state.operation&&receipt.provider===state.provider&&receipt.acceptedAt===at&&Number.isSafeInteger(receipt.revision)&&receipt.revision>=0&&/^[a-f0-9]{64}$/.test(receipt.fingerprint||'')&&(!requireFiles||(Array.isArray(receipt.files)&&receipt.files.every(f=>typeof f.id==='string'&&typeof f.name==='string'&&Number.isSafeInteger(f.size)&&f.size>0&&/^[a-f0-9]{64}$/.test(f.hash||''))));
 }
 function accepted(result){return receiptValid(result)&&(result.state==='prepared'||(result.duplicate===true&&['queued','claimed','dispatched','completed','returning','returned','unknown','cancelled'].includes(result.state)));}
 function failure(error,launch){
  // A complete HTTP rejection is a known refusal; transport/server uncertainty
  // must be reconciled before any repeated mutation.
  const rejected=Number.isInteger(error?.status)&&error.status>=400&&error.status<500;
  state.unknown=!rejected;
  const code=String(error?.code||error?.message||'');
  const reasons={ORIGINAL_FORMAT_UNSUPPORTED:'Этот API не принимает один из исходных форматов. Передайте весь комплект через чат: документы не пропущены, платного запуска нет.',INPUT_COST_UNCONFIRMED:'Не удалось подтвердить стоимость обработки оригиналов. Платного запуска нет. Можно передать комплект через чат.',CONTEXT_TOO_BIG:'Весь комплект превышает лимит API. Файлы не обрезаны. Передайте оригиналы через чат.',RESERVE_LIMIT:'Стоимость всего комплекта превышает разрешённый лимит. Платного запуска нет. Можно использовать чат.'};
  state.message=rejected?(reasons[code]||'Действие не выполнено. Проверьте состояние заявки.'):launch?'Не удалось подтвердить запуск. Проверьте состояние.':'Не удалось подтвердить получение комплекта. Проверьте состояние.';
 }
 async function refresh(){
  if(state.busy||!active())return;
  state.busy=true;state.message='Проверяем состояние…';publish();
  const results=await Promise.allSettled([api({action:'assistant-capabilities'}),api({action:'assistant-state',operation:state.operation})]);
  if(!active())return;
  const caps=results[0],observed=results[1];
  const validCaps=caps.status==='fulfilled'&&Array.isArray(caps.value?.providers);
  if(!validCaps)state.capabilities=null;
  if(validCaps){
   state.checkedAt=typeof caps.value.checkedAt==='string'&&Number.isFinite(Date.parse(caps.value.checkedAt))?caps.value.checkedAt:new Date().toISOString();
   state.capabilities=caps.value.providers.filter(p=>providers.includes(p.provider)).map(p=>({provider:p.provider,available:p.available===true,reason:typeof p.reason==='string'?p.reason:'not_connected',
    ...(['ready','not_connected','worker_disabled','worker_unverified'].includes(p.connection)?{connection:p.connection}:{}),
    ...(['available','blocked','unavailable'].includes(p.budget?.status)?{budget:{status:p.budget.status,...(Number.isSafeInteger(p.budget.remainingMicrousd)&&p.budget.remainingMicrousd>=0?{remainingMicrousd:p.budget.remainingMicrousd}:{})}}:{}),
    ...(Number.isSafeInteger(p.priceMicrousd)&&p.priceMicrousd>=0&&typeof p.quoteId==='string'&&p.quoteId?{priceMicrousd:p.priceMicrousd,quoteId:p.quoteId}:{})}));
  }
  state.stale=observed.status!=='fulfilled'||!Object.hasOwn(observed.value||{},'job');
  if(observed.status==='fulfilled'&&Object.hasOwn(observed.value||{},'job')){
   absorb(observed.value);
   if(!state.operation||observed.value?.accepted===true||observed.value?.job?.operationId===state.operation||observed.value?.receipt?.operationId===state.operation)state.unknown=false;
  }
  state.busy=false;
  state.message=state.unknown?'Получение комплекта пока не подтверждено. Проверьте состояние.':state.stale?'Не удалось проверить автоматическую подготовку.':state.job?.state==='prepared'?'Комплект принят системой. Начало подготовки не подтверждено.':!validCaps?'Не удалось проверить подключения.':'';
  publish();
 }
 async function prepare(provider){
  if(state.busy||state.unknown||!providers.includes(provider)||!active())return;
  state.busy=true;state.quote=null;state.operation=newOperation();state.provider=provider;state.message='Проверяем комплект…';publish();
  try{const result=await api({action:'assistant-prepare',provider,operation:state.operation});if(!active())return;if(!accepted(result))throw Error('INVALID_RECEIPT');absorb(result);if(result.state!=='prepared'){const observed=await api({action:'assistant-state',operation:state.operation});if(!active())return;if(observed?.accepted!==true)throw Error('ACCEPTANCE_NOT_CONFIRMED');absorb(observed);}state.unknown=false;state.stale=false;}
  catch(error){if(!active())return;failure(error,false);}
  finally{if(active()){state.busy=false;publish();}}
 }
 async function preflight(provider){
  if(state.busy||state.unknown||!active())return;
  if(state.stale){state.message='Сначала проверьте состояние заявки.';publish();return;}
  const capability=state.capabilities?.find(p=>p.provider===provider);
  if(!capability?.available){state.message='Автоматическая подготовка этим помощником недоступна.';publish();return;}
  state.busy=true;state.quote=null;state.operation=newOperation();state.provider=provider;state.message='Проверяем комплект и стоимость…';publish();
  try{const result=await api({action:'assistant-preflight',provider,operation:state.operation});if(!active())return;
   if(!accepted(result))throw Error('INVALID_RECEIPT');absorb(result);
   if(result.requiresConfirmation!==true||typeof result.quoteId!=='string'||!result.quoteId||!Number.isSafeInteger(result.priceMicrousd)||result.priceMicrousd<0)throw Error('INVALID_QUOTE');
   state.quote={quoteId:result.quoteId,priceMicrousd:result.priceMicrousd,jobId:result.jobId,operation:state.operation,fingerprint:result.receipt.fingerprint,revision:result.receipt.revision};state.unknown=false;state.stale=false;state.message='Стоимость подготовки проверена. Подтвердите запуск.';return state.quote;
  }catch(error){if(!active())return;failure(error,false);}
  finally{if(active()){state.busy=false;publish();}}
 }
 async function start(provider,confirmedQuote){
  if(state.busy||state.unknown||!active())return;
  if(state.stale){state.message='Сначала проверьте состояние заявки.';publish();return;}
  const capability=state.capabilities?.find(p=>p.provider===provider),quote=state.quote;
  if(!capability?.available){state.message='Автоматическая подготовка этим помощником недоступна.';publish();return;}
  if(!quote?.quoteId||quote.quoteId!==confirmedQuote||state.provider!==provider||!state.operation||quote.operation!==state.operation||state.job?.id!==quote.jobId||state.job?.fingerprint!==quote.fingerprint||state.job?.revision!==quote.revision||state.job?.bindingCurrent===false||!Number.isSafeInteger(quote.priceMicrousd)){state.message='Стоимость запуска не подтверждена.';publish();return;}
  state.busy=true;state.message='Отправляем…';publish();
  try{const result=await api({action:'assistant-start',provider,operation:state.operation,quoteId:confirmedQuote,confirmedMicrousd:quote.priceMicrousd,confirmed:true});if(!active())return;
   if(!receiptValid(result,false)||result.receipt.fingerprint!==quote.fingerprint||result.receipt.revision!==quote.revision||result.state!=='queued'||result.queued!==true)throw Error('INVALID_RECEIPT');
   const observed=await api({action:'assistant-state',operation:state.operation});if(!active())return;if(observed?.accepted!==true||!observed.job)throw Error('ACCEPTANCE_NOT_CONFIRMED');absorb(observed);state.unknown=false;state.stale=false;state.quote=null;
  }catch(error){if(!active())return;failure(error,true);}
  finally{if(active()){state.busy=false;publish();}}
 }
 return {state,refresh,prepare,preflight,start};
}

export function executorProjection(request,observation={}){
 const result=projectAssistantState({role:'executor',...(request.r3Loaded?{work:request.r3||{}}:{}),claude:request.claude||null,...(observation.job?{durable:{job:observation.job}}:{}),observation:{connected:!request.r3LoadError&&!observation.stale,lastConfirmedAt:request.r3ConfirmedAt||null}});
 // Legacy Claude queuedAt confirms a saved copy, not dispatch. Keep its queue
 // intact; allow manual export only, never infer permission for another API job.
 if(result.state==='queued'&&result.provider==='claude'&&!result.stale&&!observation.unknown&&!observation.job&&!request.claude?.startedAt&&!request.claude?.readyAt&&!request.claude?.attachedAt&&!request.claude?.error)
  return {...result,label:'Материалы получены',provider:null,legacyChatAvailable:true};
 if(result.state==='kit_prepared')return {...result,label:'Комплект принят системой'};
 return result;
}

if(typeof window==='object'){
 window.StudAssistantExecutor={createAssistantSession,executorProjection,createFinanceSession};
 if(typeof window.render==='function'&&window.D)window.render();
}
