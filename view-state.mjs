// UI-04: transient DOM state only. Callers restore exclusively for the same
// account and view; nothing is written to storage or sent to a server.
const controls='input,textarea,select,button,a';
function keys(elements){
 const counts=new Map();
 return elements.map(el=>{
  const base=el.id?'id:'+el.id:[el.tagName,...['name','data-act','data-id','data-method','data-r3-comment','href'].map(k=>el.getAttribute(k)||'')].join('|');
  const n=counts.get(base)||0;counts.set(base,n+1);return {el,key:base+'#'+n};
 });
}
function foldKey(el,i){return el.id||el.querySelector('summary')?.textContent.trim()||'fold:'+i;}
export function captureViewState(page){
 const focused=page.ownerDocument.activeElement;
 const keyed=keys(Array.from(page.querySelectorAll(controls)));
 const editable=keyed.filter(({el})=>['INPUT','TEXTAREA','SELECT'].includes(el.tagName)&&el.__userEdited&&el.type!=='file'&&el.type!=='password');
 const active=keyed.find(({el})=>el===focused);
 return {fields:editable.map(({el,key})=>({key,value:el.value,checked:el.checked})),
  folds:Array.from(page.querySelectorAll('details')).map((el,i)=>({key:foldKey(el,i),open:el.open})),
  focus:active?{key:active.key,start:focused.selectionStart,end:focused.selectionEnd}:null};
}
export function restoreViewState(page,snapshot){
 if(!snapshot)return;
 const keyed=keys(Array.from(page.querySelectorAll(controls)));
 for(const field of snapshot.fields){
  const el=keyed.find(x=>x.key===field.key)?.el;
  if(!el||el.type==='file'||el.type==='password')continue;
  el.value=field.value;if(el.type==='checkbox'||el.type==='radio')el.checked=field.checked;
  el.__userEdited=true;
 }
 Array.from(page.querySelectorAll('details')).forEach((el,i)=>{const saved=snapshot.folds.find(x=>x.key===foldKey(el,i));if(saved)el.open=saved.open;});
 const target=keyed.find(x=>x.key===snapshot.focus?.key)?.el;
 if(target&&!target.disabled){target.focus({preventScroll:true});
  if(typeof target.setSelectionRange==='function'&&Number.isInteger(snapshot.focus.start))try{target.setSelectionRange(snapshot.focus.start,snapshot.focus.end);}catch{}
 }
}
if(typeof window!=='undefined'){
 window.StudViewState={captureViewState,restoreViewState};
 document.addEventListener('input',markEdited);document.addEventListener('change',markEdited);
}
function markEdited(event){if(document.getElementById('page')?.contains(event.target))event.target.__userEdited=true;}
