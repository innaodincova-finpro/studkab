(function(global){
 'use strict';
 function cache(method,value){return new Promise(function(resolve,reject){
  var request=indexedDB.open('studkab-intake-answers',1);
  request.onupgradeneeded=function(){request.result.createObjectStore('answers',{keyPath:'key'});};
  request.onerror=function(){reject(Error('Ответы не сохранены на устройстве'));};
  request.onsuccess=function(){var db=request.result,tx=db.transaction('answers',method==='get'?'readonly':'readwrite'),r=tx.objectStore('answers')[method](value),result;
   r.onsuccess=function(){result=r.result;};tx.oncomplete=function(){db.close();resolve(result);};tx.onerror=tx.onabort=function(){db.close();reject(Error('Ответы не сохранены на устройстве'));};
  };
 });}
 var core=['t','k','u','n','d','dl','org'];
 function equal(a,b){return JSON.stringify(Object.keys(a).sort().map(function(k){return [k,a[k]];}))===JSON.stringify(Object.keys(b).sort().map(function(k){return [k,b[k]];}));}
 async function render(o){
  var active=true,timer=null,localChain=Promise.resolve(),saving=false,dirty=false,edit=0,c=null,answers={},conflict=null;
  var section=document.createElement('section');section.setAttribute('data-intake-confirmation','');section.style.overflowWrap='anywhere';o.box.appendChild(section);
  function valid(){return active&&o.same()&&section.isConnected;}
  function cleanup(){active=false;clearTimeout(timer);}
  function message(text){if(valid())section.querySelector('[data-answer-status]').textContent=text;}
  function label(r){var s=r.source||{};return (r.fileName||'Примечание студента')+(s.page?' — страница '+s.page:s.cell?' — '+s.sheet+'!'+s.cell:s.paragraph?' — абзац '+s.paragraph:s.table?' — таблица '+s.table+', строка '+s.row+', ячейка '+s.column:'');}
  function evidence(v){return '<p class="small">'+o.esc(v.value)+(v.condition?'<br>Условие: '+o.esc(v.condition):'')+'</p><details><summary>Источники</summary>'+(v.refs||[]).map(function(r){return '<p class="small"><b>'+o.esc(label(r))+'</b><br>'+o.esc(r.quote)+'</p>';}).join('')+'</details>';}
  function controls(key,rule){var a=answers[key]||{},field=o.result.fields[rule.field],values=field?field.values:[],choices=rule.kind==='condition'?[['applies','Применяется'],['not_applies','Не применяется'],['unknown','Не знаю — уточнить у исполнителя']]:values.map(function(v,i){return ['candidate:'+i,v.value+(v.condition?' (условие: '+v.condition+')':'')];}).concat([['custom','Указать своё значение'],['unknown','Не знаю — уточнить у исполнителя']]);
   var selected=a.type==='candidate'?'candidate:'+a.index:a.type||'',id='answer-'+key.replace(/:/g,'-');
   return '<label for="'+id+'">'+(rule.kind==='condition'?'Применимость требования':'Уточнение')+'</label><select id="'+id+'" data-answer="'+key+'" style="max-width:100%;width:100%"><option value="">Выберите ответ</option>'+choices.map(function(x){return '<option value="'+x[0]+'"'+(selected===x[0]?' selected':'')+'>'+o.esc(x[1])+'</option>';}).join('')+'</select>'+(rule.kind==='field'?'<input aria-label="Своё значение: '+o.esc(field.label)+'" data-custom="'+key+'" maxlength="2000" value="'+o.esc(a.value||'')+'"'+(a.type==='custom'?'':' hidden style="display:none"')+'>':'');
  }
  function field(key){var f=o.result.fields[key];if(!f)return '';var rule=c.rules['f:'+key],a=answers['f:'+key],text=a?a.type==='custom'?a.value:a.type==='unknown'?'Не знаю — уточнить у исполнителя':f.values[a.index].value:f.values.length===1?f.values[0].value:f.values.length?'Разные значения — требуется уточнение':'В документах не найдено';
   var details='<details><summary>Источники и исправление</summary>'+f.values.map(evidence).join('')+(rule&&!rule.required?controls('f:'+key,rule):'')+'</details>';
   return '<div class="field"><b>'+o.esc(f.label)+'</b><p class="small" data-effective="f:'+key+'">'+o.esc(text)+'</p>'+(rule&&rule.required?'<p class="hint">Требуется уточнение'+(f.status==='needs_review'?': есть условие применимости':'')+'</p>'+controls('f:'+key,rule):'')+details+'</div>';
  }
  function draw(){
   var remaining=Object.keys(o.result.fields).filter(function(k){return !core.includes(k)&&o.result.fields[k].values.length||!core.includes(k)&&c.rules['f:'+k]&&c.rules['f:'+k].required;});
   var conditions=Object.keys(c.rules).filter(function(k){return c.rules[k].kind==='condition';});
   section.innerHTML='<h3>Найдено в документах</h3><p class="hint">Проверьте основные сведения. Переписывать документы не нужно. Ответьте только на важные вопросы.</p>'+core.map(field).join('')+(remaining.length?'<details><summary>Другие сведения и требования</summary>'+remaining.map(function(k){var f=o.result.fields[k];return c.rules['f:'+k]?field(k):'<div class="field"><b>'+o.esc(f.label)+'</b>'+f.values.map(evidence).join('')+'</div>';}).join('')+'</details>':'')+(o.result.requirements.length?'<details><summary>Другие требования: '+o.result.requirements.length+'</summary>'+o.result.requirements.map(evidence).join('')+'</details>':'')+(conditions.length?'<details open><summary>Условия, которые нужно уточнить: '+conditions.length+'</summary>'+conditions.map(function(k){var rule=c.rules[k],v=rule.field==='requirement'?o.result.requirements[rule.index]:o.result.fields[rule.field].values[rule.index];return '<div class="field">'+evidence(v)+controls(k,rule)+'</div>';}).join('')+'</details>':'')+'<p class="hint" data-answer-status role="status" aria-live="polite"></p><div data-answer-conflict></div><div class="rowbtns"><button type="button" class="b b-main" data-confirm-card>Подтвердить сведения</button><button type="button" class="b b-quiet" data-save-answers>Сохранить ответы</button></div><p class="hint">Подтверждение сохраняет вашу карточку. Заявка ещё не отправлена. Требования и расчёты проверит исполнитель.</p>';
   section.querySelector('[data-save-answers]').onclick=function(){save(false);};section.querySelector('[data-confirm-card]').onclick=function(){save(true);};
   section.addEventListener('change',changed,{once:false});section.addEventListener('input',inputChanged,{once:false});
   message(c.state==='confirmed'&&!dirty?'Сведения подтверждены и сохранены в кабинете. Заявка ещё не отправлена.':dirty?'Восстановлены ответы с устройства. Сохраняем в кабинет…':c.savedAt?'Ответы сохранены в кабинете':'Ответы сохраняются автоматически после ввода');
  }
  function key(){return o.owner+':'+o.draftId+':'+c.analysisId;}
  function remember(){var record={key:key(),owner:o.owner,analysisId:c.analysisId,revision:c.revision,answers:JSON.parse(JSON.stringify(answers))};localChain=localChain.catch(function(){}).then(function(){return cache('put',record);});return localChain;}
  function edited(){Object.keys(answers).forEach(function(k){var p=section.querySelector('[data-effective="'+k+'"]'),a=answers[k],f=o.result.fields[k.slice(2)];if(p&&f)p.textContent=a.type==='custom'?a.value:a.type==='unknown'?'Не знаю — уточнить у исполнителя':f.values[a.index].value;});dirty=true;edit++;clearTimeout(timer);message('Сохраняем ответы…');remember().then(function(){if(valid())message('Ответы сохранены на устройстве; передаём в кабинет…');}).catch(function(e){message(e.message+'. Оставьте окно открытым и повторите сохранение.');});timer=setTimeout(function(){save(false);},600);}
  function changed(e){var el=e.target;if(!el.matches('[data-answer]'))return;var k=el.getAttribute('data-answer'),v=el.value;
   if(v.startsWith('candidate:'))answers[k]={type:'candidate',index:Number(v.split(':')[1])};else if(v==='custom')answers[k]={type:'custom',value:section.querySelector('[data-custom="'+k+'"]').value};else if(v)answers[k]={type:v};else delete answers[k];
   var custom=section.querySelector('[data-custom="'+k+'"]');if(custom){custom.hidden=v!=='custom';custom.style.display=custom.hidden?'none':'';}edited();
  }
  function inputChanged(e){if(!e.target.matches('[data-custom]'))return;answers[e.target.getAttribute('data-custom')]={type:'custom',value:e.target.value};edited();}
  async function save(confirm){
   clearTimeout(timer);if(!valid()||saving||conflict)return;
   if(confirm&&Object.keys(c.rules).some(function(k){return c.rules[k].required&&!answers[k];})){message('Ответьте на важные вопросы или выберите «Не знаю».');return;}
   if(Object.values(answers).some(function(a){return a.type==='custom'&&!a.value.trim();})){message('Введите своё значение или выберите «Не знаю». Уже введённые ответы сохранены на устройстве.');return;}
   saving=true;var localSaved=false;var sent=JSON.parse(JSON.stringify(answers)),version=edit;
   section.querySelector('[data-confirm-card]').disabled=true;
   try{
    try{await remember();localSaved=true;}catch(_){}if(!valid())return;
    var response=await o.api({action:'intake-confirmation-save',id:o.draftId,analysisId:c.analysisId,revision:c.revision,answers:sent,confirm:confirm});if(!valid())return;
    c=response.confirmation;
    if(version===edit){dirty=false;await cache('delete',key());if(version!==edit){dirty=true;await remember();}message(dirty?'Новые ответы сохраняются…':confirm?'Сведения подтверждены и сохранены в кабинете. Заявка ещё не отправлена.':'Ответы сохранены в кабинете'+(c.savedAt?' — '+new Date(c.savedAt).toLocaleString('ru-RU'):''));}
    else{await remember();timer=setTimeout(function(){save(false);},0);}
   }catch(e){if(!valid())return;message('Сохранение в кабинете не подтверждено: '+e.message+(localSaved?'. Ввод сохранён на устройстве.':'. Сохранение на устройстве тоже не подтверждено. Не закрывайте окно.'));
    try{var state=(await o.api({action:'intake-confirmation-state',id:o.draftId})).confirmation;if(!valid())return;
     if(state.analysisId!==c.analysisId){section.querySelector('[data-confirm-card]').disabled=true;conflict=state;message('Документы изменились. Откройте материалы заново. Ответы прежней карточки сохранены на устройстве.');}
     else if(state.revision!==c.revision){if(equal(state.answers,sent)){c=state;if(version===edit){dirty=false;await cache('delete',key());message(state.state==='confirmed'?'Подтверждение сохранено в кабинете':'Ответы сохранены в кабинете');}}else{conflict=state;showConflict();}}
    }catch(_){}
   }finally{saving=false;if(valid()&&!conflict){section.querySelector('[data-confirm-card]').disabled=false;if(dirty&&version!==edit)timer=setTimeout(function(){save(false);},600);}}
  }
  function showConflict(){message('Карточка изменена в другой вкладке. Ваш ввод сохранён на устройстве. Сверьте ответы перед продолжением.');var box=section.querySelector('[data-answer-conflict]');box.innerHTML='<details open><summary>Ответы из другой вкладки</summary>'+Object.keys(conflict.answers).map(function(k){var a=conflict.answers[k],rule=c.rules[k],f=rule&&o.result.fields[rule.field],value=a.type==='custom'?a.value:a.type==='candidate'&&f?f.values[a.index].value:a.type==='unknown'?'Не знаю':a.type==='applies'?'Применяется':'Не применяется';return '<p class="small">'+o.esc(f?f.label:k)+': '+o.esc(value)+'</p>';}).join('')+'</details><button type="button" class="b b-quiet" data-use-local>Сохранить мои ответы вместо этих</button>';
   box.querySelector('[data-use-local]').onclick=function(){c=conflict;conflict=null;box.innerHTML='';dirty=true;save(false);};
  }
  try{
   c=(await o.api({action:'intake-confirmation-state',id:o.draftId})).confirmation;if(!valid())return cleanup;
   if(!c.analysisId||c.analysisId!==o.analysisId){section.textContent='Карточка ещё недоступна или документы изменились. Откройте материалы заново.';return cleanup;}
   answers=c.answers||{};var local=await cache('get',key());if(!valid())return cleanup;
   if(local&&local.owner===o.owner&&local.analysisId===c.analysisId&&!equal(local.answers,answers)){answers=local.answers;dirty=true;if(local.revision!==c.revision)conflict=c;}
   draw();if(conflict)showConflict();else if(dirty)save(false);
  }catch(e){if(valid())section.textContent='Карточка не загружена: '+e.message+'. Документы сохранены; откройте материалы заново.';}
  return cleanup;
 }
 global.StudIntakeConfirmation={render:render};
})(window);
