/* Questions and immutable answers stay separate from the original submission. */
(function(root){
 'use strict';
 var requiredIds=['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER'];
 function unresolved(items){return (items||[]).filter(function(q){return (q.required!==false||requiredIds.indexOf(q.id)>=0)&&(!q.verified||!String(q.source||'').trim()||!String(q.text||'').trim()||/не указано|требуется уточнить|порог не задан|ожидается ответ/i.test(q.text));});}
 // UX-02a: вместо внутреннего кода пункта — понятное название вопроса.
 var FIELD_TOPIC={t:'Тема работы',k:'Вид работы',d:'Предмет',structure:'Структура работы',length:'Объём работы',formatting:'Оформление',data:'Исходные данные',u:'Учебное заведение',dl:'Срок сдачи',n:'Данные студента'};
 function topic(id,labels){
  id=String(id||'');
  if(labels&&labels[id])return labels[id];
  if(/^FIELD_GAP_conflict/i.test(id))return 'Документы расходятся';
  if(/^FIELD_GAP_missing/i.test(id))return 'Не хватает данных';
  if(/^FIELD_/.test(id))return FIELD_TOPIC[id.slice(6)]||'Уточнение по документам';
  if(/^REQ_/.test(id))return 'Условие из документов';
  return 'Уточнение по работе';
 }
 function when(value){var d=new Date(value);return isNaN(d)?'':d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})+' в '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});}
 async function fileBody(file){
  // R3-A: к ответу можно приложить и фото; крупное фото уменьшается автоматически.
  var f=await root.StudFilePrep.prepare(file),type=f.type,bytes=new Uint8Array(f.bytes);
  var hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(function(x){return x.toString(16).padStart(2,'0');}).join('');
  var binary='',chunk=32768;for(var i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));
  return {fileName:f.name,contentType:type,sizeBytes:f.size,fileHash:hash,base64:btoa(binary)};
 }
 async function show(o){
  var api=o.api,esc=o.esc,student=!o.executor,title=student?'Вопросы исполнителя':'Уточнения по работе';
  var wrap=o.openModal('<button type="button" class="close" data-x="1">✕</button><h3>'+title+'</h3><p role="status">Загрузка…</p>');
  var pane=wrap.querySelector('.sheet-in'),titleId=wrap.getAttribute('aria-labelledby');
  var identity=root.Oblako&&root.Oblako.identity?root.Oblako.identity():null;
  function same(){return identity===null||identity===root.Oblako.identity();}
  function changed(){pane.innerHTML='<button type="button" class="close" data-x="1" aria-label="Закрыть">✕</button><p>Аккаунт изменился. Откройте вопросы заново.</p>';wrap.removeAttribute('aria-labelledby');wrap.setAttribute('aria-label',title);}
  var questionId=crypto.randomUUID(),busy=false,drafts={},files={};
  function keepDrafts(){wrap.querySelectorAll('[data-answer]').forEach(function(t){drafts[t.getAttribute('data-answer')]=t.value;});}
  function fileChips(id){return (files[id]||[]).map(function(n){return '<span class="chip" data-attached>📎 '+esc(n)+'</span>';}).join(' ');}
  function studentView(rows){
   var open=rows.filter(function(q){return !q.answer;}),done=rows.filter(function(q){return q.answer;});
   var head='<h3>'+title+'</h3><p class="hint">'+(o.requestNumber?'Заявка № '+esc(o.requestNumber)+' · ':'')+(open.length?'ответьте своими словами и отправьте одним разом':'все ответы отправлены')+'</p>';
   var openHtml=open.map(function(q,i){var id=esc(q.id);
    return '<section data-question="'+id+'" style="border-top:1px solid #DCE6EE;padding:16px 0">'+
     '<div class="lab">Вопрос '+(i+1)+' из '+open.length+'</div><p style="margin:4px 0"><b>'+esc(topic(q.item_id,o.labels))+'</b></p>'+
     '<p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 10px">'+esc(q.question)+'</p>'+
     '<div class="fld"><label><span style="display:block;margin-bottom:6px">Ваш ответ</span><textarea data-answer="'+id+'" maxlength="3500" placeholder="Если точного ответа нет, напишите, что знаете">'+esc(drafts[q.id]||'')+'</textarea></label></div>'+
     '<div><label class="mini" style="cursor:pointer">Приложить файл<input type="file" hidden data-answer-file="'+id+'" accept="'+root.StudFilePrep.ACCEPT+'"></label> <span data-attached-list="'+id+'">'+fileChips(q.id)+'</span></div>'+
    '</section>';}).join('');
   var doneHtml=done.length?'<details style="margin-top:8px"'+(open.length?'':' open')+'><summary>Отправленные ответы ('+done.length+')</summary>'+done.map(function(q){
    return '<section style="border-top:1px solid #DCE6EE;padding:12px 0"><p style="margin:0"><b>'+esc(topic(q.item_id,o.labels))+'</b></p><p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0" class="hint">'+esc(q.question)+'</p><p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0"><b>Ваш ответ:</b> '+esc(q.answer)+'</p><small class="hint">Отправлен '+esc(when(q.answered_at))+'</small></section>';
   }).join('')+'</details>':'';
   var foot=open.length?'<div style="border-top:1px solid #DCE6EE;padding-top:14px;margin-top:6px"><p class="hint" style="margin:0 0 10px">Ответы уйдут вместе. После отправки изменить их нельзя. Файлы, которые вы приложили, сразу добавляются в материалы заявки.</p><button type="button" class="btn" data-answers-send disabled>Отправить ответы</button></div>':(rows.length?'':'<p>Вопросов пока нет.</p>');
   return head+openHtml+foot+doneHtml+'<p role="status" data-question-status></p>';
  }
  function executorView(rows){
   return '<h3>'+title+'</h3><p class="hint">Вопросы и ответы сохраняются в этой заявке.</p>'+rows.map(function(q){
    return '<section style="border-top:1px solid #cbd9e5;padding:14px 0"><b>'+esc(topic(q.item_id,o.labels))+'</b><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(q.question)+'</p>'+(q.answer?'<p style="white-space:pre-wrap;overflow-wrap:anywhere"><b>Ответ студента:</b> '+esc(q.answer)+'</p><small class="hint">Ответ получен '+esc(when(q.answered_at))+'</small>':'<p class="hint">Ожидается ответ студента</p>')+'</section>';
   }).join('')+(rows.length?'':'<p>Вопросов пока нет.</p>')+'<details><summary>Задать вопрос студенту</summary><div class="fld"><label>Пункт требований<select data-question-item>'+(o.items||[]).map(function(q){return '<option value="'+esc(q.id)+'">'+esc(topic(q.id,o.labels))+'</option>';}).join('')+'</select></label></div><div class="fld"><label>Что нужно уточнить<textarea data-question-text maxlength="2000"></textarea></label></div><button type="button" class="btn" data-question-send>Сохранить вопрос в кабинете студента</button></details><p role="status" data-question-status></p>';
  }
  function sendState(){var b=wrap.querySelector('[data-answers-send]');if(!b)return;var any=Array.from(wrap.querySelectorAll('[data-answer]')).some(function(t){return t.value.trim()||(files[t.getAttribute('data-answer')]||[]).length;});b.disabled=busy||!any;}
  async function draw(){
   var result=await api({action:'clarification-list',id:o.requestId});
   if(!wrap.isConnected)return;if(!same()){changed();return;}
   var rows=result.questions||[];
   pane.innerHTML='<button type="button" class="close" data-x="1" aria-label="Закрыть">✕</button>'+(student?studentView(rows):executorView(rows));
   pane.querySelector('h3').id=titleId;pane.querySelector('[data-x]').focus();sendState();
   if(rows.length)try{await api({action:'clarification-read',id:o.requestId});if(o.onRead)o.onRead();}catch(e){/* Keep the unread indicator until the receipt is stored. */}
  }
  function status(text){var s=wrap.querySelector('[data-question-status]')||wrap.querySelector('[role=status]');if(s)s.textContent=text;}
  wrap.addEventListener('input',function(e){if(e.target.closest('[data-answer]'))sendState();});
  wrap.addEventListener('change',async function(e){
   var input=e.target.closest('[data-answer-file]');if(!input||!input.files||!input.files[0])return;
   if(busy){input.value='';return;}if(!same()){changed();return;}
   var id=input.getAttribute('data-answer-file'),file=input.files[0];busy=true;sendState();
   try{
    status('Добавляем файл «'+file.name+'» в материалы заявки…');
    var body=await fileBody(file);body.action='registered-add';body.id=o.requestId;
    var reply=await api(body);if(!same()){changed();return;}
    files[id]=(files[id]||[]).concat(file.name);
    var list=wrap.querySelector('[data-attached-list="'+id+'"]');if(list)list.innerHTML=fileChips(id);
    status(reply&&reply.duplicate?'Файл «'+file.name+'» уже был в материалах заявки.':'Файл «'+file.name+'» добавлен в материалы заявки. Программа заново прочитает и изучит комплект.');
   }catch(err){status(err.message||'Не удалось добавить файл. Попробуйте ещё раз.');}
   finally{busy=false;input.value='';sendState();}
  });
  wrap.addEventListener('click',async function(event){
   var ask=event.target.closest('[data-question-send]'),send=event.target.closest('[data-answers-send]');
   if(!ask&&!send)return;if(busy)return;if(!same()){changed();return;}
   var button=ask||send,sent=0;busy=true;button.disabled=true;
   try{
    if(ask){
     var data={id:o.requestId,action:'clarification-ask',questionId:questionId,itemId:wrap.querySelector('[data-question-item]').value,question:wrap.querySelector('[data-question-text]').value.trim()};
     if(!data.question)return;
     await api(data);if(!same()){changed();return;}questionId=crypto.randomUUID();
    }else{
     keepDrafts();
     var items=Array.from(wrap.querySelectorAll('[data-answer]')).map(function(t){var id=t.getAttribute('data-answer'),text=t.value.trim(),att=files[id]||[];
      var answer=text;if(att.length)answer=(text?text+'\n':'')+'Приложен файл: '+att.join(', ');if(answer.length>4000)answer=answer.slice(0,3999)+'…';
      return {id:id,answer:answer,source:att.length?'Ответ студента в кабинете; файл добавлен в материалы заявки':''};}).filter(function(x){return x.answer;});
     for(var i=0;i<items.length;i++){
      status('Отправляем ответы: '+(i+1)+' из '+items.length+'…');
      await api({id:o.requestId,action:'clarification-answer',questionId:items[i].id,answer:items[i].answer,source:items[i].source});
      if(!same()){changed();return;}delete drafts[items[i].id];delete files[items[i].id];sent++;
     }
    }
    await draw();
    if(send)status('Ответы отправлены. Исполнитель получит их и продолжит работу.');
    if(o.onChange)await o.onChange();
   }catch(e){if(!same()){changed();return;}var msg=e.message||'Не удалось подтвердить отправку. Повторите — уже отправленные ответы не задвоятся.';
    // Исполнитель не теряет набранный вопрос; у студента окно показывает уже отправленные ответы.
    if(send){try{await draw();}catch(x){}if(sent&&o.onChange)try{await o.onChange();}catch(x){}}
    status(msg);}
   finally{busy=false;var b=wrap.querySelector('[data-answers-send]');if(b)sendState();if(ask)ask.disabled=false;}
  });
  try{await draw();}catch(e){status(e.message||'Не удалось загрузить вопросы');}
 }
 root.StudClarifications={show:show,unresolved:unresolved,requiredIds:requiredIds,topic:topic};
 if(typeof module!=='undefined')module.exports=root.StudClarifications;
})(typeof window==='undefined'?globalThis:window);
