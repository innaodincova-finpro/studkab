const providers=['claude','chatgpt','deepseek'];
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const amount=v=>typeof v==='string'&&/^-?\d{1,12}(?:\.\d{1,12})?$/.test(v);
const missing=()=>({status:'unknown'});
function observation(value,balance=false){
 if(!['verified','stale'].includes(value?.status)||!date(value.observedAt)||!date(value.checkedAt))return missing();
 if(balance){
  if(!Array.isArray(value.balances)||!value.balances.length||value.balances.length>2||!value.balances.every(b=>['USD','CNY'].includes(b.currency)&&amount(b.total))||new Set(value.balances.map(b=>b.currency)).size!==value.balances.length)return missing();
  return {status:value.status,observedAt:value.observedAt,checkedAt:value.checkedAt,balances:value.balances.map(b=>({currency:b.currency,total:b.total}))};
 }
 if(value.currency!=='USD'||!amount(value.amount)||!date(value.periodStart)||!date(value.periodEnd))return missing();
 return {status:value.status,observedAt:value.observedAt,checkedAt:value.checkedAt,amount:value.amount,currency:'USD',periodStart:value.periodStart,periodEnd:value.periodEnd,coverage:value.coverage==='excludes_priority_tier'?'excludes_priority_tier':'reported_costs'};
}
export function financeObservation(value){
 if(value?.schema!==1||!date(value.checkedAt)||!Array.isArray(value.providers))throw Error('INVALID_FINANCES');
 const a=value.application,application=['available','blocked'].includes(a?.status)&&Number.isSafeInteger(a.availableMicrousd)&&a.availableMicrousd>=0&&a.currency==='USD'&&date(a.checkedAt)?{status:a.status,availableMicrousd:a.availableMicrousd,checkedAt:a.checkedAt}:missing();
 return {checkedAt:value.checkedAt,application,providers:providers.map(provider=>{const rows=value.providers.filter(p=>p.provider===provider),p=rows.length===1?rows[0]:null;return {provider,balance:provider==='deepseek'?observation(p?.balance,true):missing(),costs:provider==='deepseek'?missing():observation(p?.costs),reportReason:['not_configured','scope_not_configured','access_denied'].includes(p?.costs?.reason)?p.costs.reason:null};})};
}
export function createFinanceSession({api,active,onChange,now=()=>Date.now()}){
 const state={busy:false,value:null,message:''};let succeededAt=0;
 const publish=()=>{if(active())onChange(state);};
 const retained=v=>date(v?.observedAt)&&now()-Date.parse(v.observedAt)>=0&&now()-Date.parse(v.observedAt)<600000?{...v,status:'stale'}:missing();
 return {state,async refresh(){
  if(state.busy||!active())return;
  state.busy=true;state.message='Обновляем данные…';publish();
  try{const value=financeObservation(await api({action:'assistant-finances'}));if(!active())return;state.value=value;succeededAt=now();state.message='Проверка завершена.';}
  catch{if(!active())return;if(state.value&&now()-succeededAt<600000){state.value={...state.value,application:{status:'unknown'},providers:state.value.providers.map(p=>({...p,balance:retained(p.balance),costs:retained(p.costs)}))};}else state.value=null;state.message='Не удалось обновить. Повторите проверку.';}
  finally{if(active()){state.busy=false;publish();}}
 }};
}
