// Read-only supplier finance. Never calls inference, uploads, top-ups or limits.
const PROXY='https://calm-bird-dae8.bf6mhynzgm.workers.dev';
const PROVIDERS=['deepseek','claude','chatgpt'];
const secret=v=>typeof v==='string'&&v.length>0&&v.length<=4096&&!/[\r\n]/.test(v);
const amount=v=>typeof v==='string'&&/^-?\d{1,12}(?:\.\d{1,12})?$/.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const unknown=(reason,checkedAt,source)=>({status:'unknown',reason,checkedAt,source});
async function json(response){
 if(!response.ok){await response.body?.cancel();throw Error(response.status===401||response.status===403?'access_denied':response.status===429?'rate_limited':'supplier_unavailable');}
 if(!response.body)throw Error('invalid_response');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>1000000)throw Error('invalid_response');chunks.push(x.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('invalid_response');}
}
function safeReason(e){return ['access_denied','rate_limited','supplier_unavailable','invalid_response','incomplete_report'].includes(e?.message)?e.message:'supplier_unavailable';}
function units(v){
 if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>1000000000)throw Error('invalid_response');v=v.toFixed(12);}
 if(!amount(v))throw Error('invalid_response');
 const negative=v.startsWith('-');if(negative)v=v.slice(1);
 const [whole,fraction='']=v.split('.');
 return (BigInt(whole)*1000000000000n+BigInt(fraction.padEnd(12,'0')))*(negative?-1n:1n);
}
function decimal(n){
 const sign=n<0n?'-':'';if(n<0n)n=-n;
 const fraction=(n%1000000000000n).toString().padStart(12,'0').replace(/0+$/,'');
 return sign+(n/1000000000000n).toString()+(fraction?'.'+fraction:'');
}
export function financeBalance(value,checkedAt){
 if(value?.schema!==1||value.provider!=='deepseek')throw Error('invalid_response');
 const b=value.balance;
 if(b?.status==='unknown'&&['not_configured','access_denied','rate_limited','supplier_unavailable','invalid_response'].includes(b.reason))return unknown(b.reason,checkedAt,'deepseek_balance');
 if(b?.status!=='verified'||typeof b.isAvailable!=='boolean'||!iso(b.observedAt)||!Array.isArray(b.balances)||!b.balances.length||b.balances.length>2)throw Error('invalid_response');
 const seen=new Set();
 const balances=b.balances.map(row=>{
  if(!['CNY','USD'].includes(row?.currency)||seen.has(row.currency)||!['total','granted','toppedUp'].every(k=>amount(row[k])))throw Error('invalid_response');
  seen.add(row.currency);return {currency:row.currency,total:row.total,granted:row.granted,toppedUp:row.toppedUp};
 });
 return {status:'verified',isAvailable:b.isAvailable,balances,observedAt:b.observedAt,checkedAt,source:'deepseek_balance'};
}
async function report(provider,key,scope,fetchProvider,now){
 const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
 const end=now.toISOString();
 const url=new URL(provider==='chatgpt'?'https://api.openai.com/v1/organization/costs':'https://api.anthropic.com/v1/organizations/cost_report');
 if(provider==='chatgpt'){url.searchParams.set('start_time',String(Date.parse(start)/1000));url.searchParams.set('end_time',String(Math.floor(now.getTime()/1000)));url.searchParams.append('project_ids',scope);url.searchParams.append('group_by','project_id');}
 else{url.searchParams.set('starting_at',start);url.searchParams.set('ending_at',end);url.searchParams.append('group_by[]','workspace_id');}
 url.searchParams.set('bucket_width','1d');url.searchParams.set('limit','31');
 const headers=provider==='chatgpt'?{Authorization:'Bearer '+key}:{'x-api-key':key,'anthropic-version':'2023-06-01'};
 let total=0n;const seenPages=new Set(),seenBuckets=new Set();
 for(let page=0;page<4;page++){
  const data=await json(await fetchProvider(url.href,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000)}));
  if(!Array.isArray(data.data)||data.data.length>31||typeof data.has_more!=='boolean')throw Error('invalid_response');
  for(const bucket of data.data){
   const a=provider==='chatgpt'?bucket.start_time:Date.parse(bucket.starting_at)/1000;
   const b=provider==='chatgpt'?bucket.end_time:Date.parse(bucket.ending_at)/1000;
   if(!Number.isFinite(a)||!Number.isFinite(b)||a<Date.parse(start)/1000||a>=now.getTime()/1000||b<=a||b>a+86400||seenBuckets.has(a)||!Array.isArray(bucket.results)||bucket.results.length>10000)throw Error('invalid_response');
   seenBuckets.add(a);
   for(const row of bucket.results){
    const matching=provider==='chatgpt'?row.project_id===scope:row.workspace_id===scope;
    if(!matching){if(provider==='chatgpt')throw Error('invalid_response');continue;}
    if(provider==='chatgpt'){if(row.amount?.currency!=='usd')throw Error('invalid_response');total+=units(row.amount.value);}
    else{if(row.currency!=='USD')throw Error('invalid_response');const cents=units(row.amount);if(cents%100n!==0n)throw Error('invalid_response');total+=cents/100n;}
   }
  }
  if(!data.has_more)return {status:'verified',source:provider+'_cost_report',currency:'USD',amount:decimal(total),scope:provider==='claude'?'configured_workspace':'configured_project',periodStart:start,periodEnd:end,observedAt:end,checkedAt:end,granularity:'day',settlement:'supplier_report',coverage:provider==='claude'?'excludes_priority_tier':'reported_costs'};
  if(typeof data.next_page!=='string'||!data.next_page.length||data.next_page.length>1000||seenPages.has(data.next_page))throw Error('incomplete_report');
  seenPages.add(data.next_page);url.searchParams.set('page',data.next_page);
 }
 throw Error('incomplete_report');
}
export function createAssistantFinances({get,rpc,fetchProvider=globalThis.fetch,now=()=>Date.now()}){
 const cached=new Map(),pending=new Map();
 async function supplier(provider){
  const stamp=new Date(now()).toISOString();
  const key=get(provider==='deepseek'?'STUDKAB_PROXY_TOKEN':provider==='chatgpt'?'OPENAI_ADMIN_API_KEY':'ANTHROPIC_ADMIN_API_KEY');
  const scope=provider==='deepseek'?'proxy':get(provider==='chatgpt'?'STUDKAB_ASSISTANT_OPENAI_PROJECT_ID':'STUDKAB_ASSISTANT_CLAUDE_WORKSPACE_ID');
  const source=provider==='deepseek'?'deepseek_balance':provider+'_cost_report';
  // Independent from paid generation enablement and price policy.
  if(!secret(key))return unknown('not_configured',stamp,source);
  if(provider!=='deepseek'&&(typeof scope!=='string'||!(/^[a-zA-Z0-9_-]{1,120}$/).test(scope)))return unknown('scope_not_configured',stamp,source);
  const binding=key+'\0'+scope;
  const saved=cached.get(provider);
  if(saved?.binding===binding&&now()-saved.at<60000)return saved.value;
  if(pending.get(provider)?.binding===binding)return pending.get(provider).promise;
  const promise=(async()=>{
   let value;
   try{
    value=provider==='deepseek'?financeBalance(await json(await fetchProvider(PROXY,{method:'POST',headers:{'Content-Type':'application/json','X-Proxy-Token':key},body:JSON.stringify({action:'finances'}),redirect:'error',signal:AbortSignal.timeout(10000)})),stamp):await report(provider,key,scope,fetchProvider,new Date(now()));
   }catch(e){value=unknown(safeReason(e),stamp,source);}
   if(value.status==='verified')cached.set(provider,{binding,at:now(),value});
   const lastSuccess=saved?.binding===binding?(saved.value.status==='verified'?saved:saved.lastSuccess):null;
   if(value.status!=='verified'&&lastSuccess&&now()-lastSuccess.at<600000)value={...lastSuccess.value,status:'stale',reason:value.reason,checkedAt:stamp};
   // Negative results are cached too; preserve original last-success time separately.
   if(value.status!=='verified')cached.set(provider,{binding,at:now(),value,lastSuccess});
   return value;
  })();
  pending.set(provider,{binding,promise});
  try{return await promise;}finally{if(pending.get(provider)?.promise===promise)pending.delete(provider);}
 }
 return async actor=>{
  let application;const stamp=new Date(now()).toISOString();
  try{const b=await rpc('studkab_assistant_budget',{p_actor:actor});
   if(!Number.isSafeInteger(b?.remainingMicrousd)||b.remainingMicrousd<0||typeof b.budgetAvailable!=='boolean'||b.budgetAvailable!==(b.remainingMicrousd>0))throw Error();
   application={status:b.budgetAvailable?'available':'blocked',availableMicrousd:b.remainingMicrousd,currency:'USD',source:'application_policy',checkedAt:stamp};
  }catch{application=unknown('budget_unavailable',stamp,'application_policy');}
  const providers=await Promise.all(PROVIDERS.map(async provider=>({provider,balance:provider==='deepseek'?await supplier(provider):unknown('no_verified_balance_api',stamp,null),costs:provider==='deepseek'?unknown('no_verified_cost_report_api',stamp,null):await supplier(provider)})));
  return {schema:1,application,providers,checkedAt:stamp};
 };
}
