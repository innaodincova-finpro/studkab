/* Questions and immutable answers stay separate from the original submission. */
(function(root){
 'use strict';
 var requiredIds=['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER'];
 function unresolved(items){return (items||[]).filter(function(q){return (q.required!==false||requiredIds.indexOf(q.id)>=0)&&(!q.verified||!String(q.source||'').trim()||!String(q.text||'').trim()||/не указано|требуется уточнить|порог не задан|ожидается ответ/i.test(q.text));});}
 async function show(o){
  var api=o.api,esc=o.esc,wrap=o.openModal('<button type="button" class="close" data-x="1">✕</button><h3>Уточнения по работе</h3><p role="status">Загрузка…</p>');
  var pane=wrap.querySelector('.sheet-in'),titleId=wrap.getAttribute('aria-labelledby');
  var identity=root.Oblako&&root.Oblako.identity?root.Oblako.identity():null;
  function same(){return identity===null||identity===root.Oblako.identity();}
  function changed(){pane.innerHTML='<button type="button" class="close" data-x="1" aria-label="Закрыть">✕</button><p>Аккаунт изменился. Откройте уточнения заново.</p>';wrap.removeAttribute('aria-labelledby');wrap.setAttribute('aria-label','Уточнения');}
  var questionId=crypto.randomUUID(),busy=false;
  async function draw(){
   var result=await api({action:'clarification-list',id:o.requestId});
   if(!wrap.isConnected)return;if(!same()){changed();return;}
   var rows=result.questions||[];
   pane.innerHTML='<button type="button" class="close" data-x="1" aria-label="Закрыть">✕</button><h3>Уточнения по работе</h3><p class="hint">Вопросы и ответы сохраняются в этой заявке. После ответа исполнитель проверит требования.</p>'+rows.map(function(q){
    return '<section style="border-top:1px solid #cbd9e5;padding:14px 0"><b>'+esc((o.labels||{})[q.item_id]||q.item_id)+'</b><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(q.question)+'</p>'+(q.answer?'<p style="white-space:pre-wrap;overflow-wrap:anywhere"><b>Ответ студента:</b> '+esc(q.answer)+'</p><p style="overflow-wrap:anywhere"><b>Основание:</b> '+esc(q.answer_source)+'</p><small>Ответ сохранён. Проверка исполнителем — в требованиях.</small>':o.executor?'<p class="hint">Ожидается ответ студента</p>':'<div class="fld"><label>Ваш ответ<textarea data-answer="'+esc(q.id)+'" maxlength="4000"></textarea></label></div><div class="fld"><label>Основание ответа<textarea data-source="'+esc(q.id)+'" maxlength="1000" placeholder="Документ и страница или пояснение преподавателя"></textarea></label></div><button class="btn" type="button" data-answer-send="'+esc(q.id)+'">Сохранить ответ</button>')+'</section>';
   }).join('')+(rows.length?'':'<p>Вопросов пока нет.</p>')+(o.executor?'<details><summary>Задать вопрос студенту</summary><div class="fld"><label>Пункт требований<select data-question-item>'+o.items.map(function(q){return '<option value="'+esc(q.id)+'">'+esc((o.labels||{})[q.id]||q.id)+'</option>';}).join('')+'</select></label></div><div class="fld"><label>Что нужно уточнить<textarea data-question-text maxlength="2000"></textarea></label></div><button type="button" class="btn" data-question-send>Сохранить вопрос в кабинете студента</button></details>':'')+'<p role="status" data-question-status></p>';
   pane.querySelector('h3').id=titleId;pane.querySelector('[data-x]').focus();
  }
  wrap.addEventListener('click',async function(event){
   var ask=event.target.closest('[data-question-send]'),answer=event.target.closest('[data-answer-send]');
   if(!ask&&!answer)return;if(busy)return;if(!same()){changed();return;}
   var data={id:o.requestId};
   if(ask){data.action='clarification-ask';data.questionId=questionId;data.itemId=wrap.querySelector('[data-question-item]').value;data.question=wrap.querySelector('[data-question-text]').value.trim();if(!data.question)return;}
   else{data.action='clarification-answer';data.questionId=answer.dataset.answerSend;data.answer=wrap.querySelector('[data-answer="'+data.questionId+'"]').value.trim();data.source=wrap.querySelector('[data-source="'+data.questionId+'"]').value.trim();if(!data.answer||!data.source){wrap.querySelector('[data-question-status]').textContent='Заполните ответ и основание';return;}}
   busy=true;var button=ask||answer;button.disabled=true;
   try{await api(data);if(!same()){changed();return;}questionId=crypto.randomUUID();await draw();if(o.onChange)await o.onChange();}
   catch(e){if(!same()){changed();return;}var status=wrap.querySelector('[data-question-status]')||wrap.querySelector('[role=status]');if(status)status.textContent=e.message||'Не удалось подтвердить сохранение. Повторите отправку с тем же текстом.';}
   finally{busy=false;button.disabled=false;}
  });
  try{await draw();}catch(e){wrap.querySelector('[role=status]').textContent=e.message||'Не удалось загрузить уточнения';}
 }
 root.StudClarifications={show:show,unresolved:unresolved,requiredIds:requiredIds};
 if(typeof module!=='undefined')module.exports=root.StudClarifications;
})(typeof window==='undefined'?globalThis:window);
