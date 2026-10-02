(function(root){
 'use strict';
 var states={preparation_blocked:'Комплект превышает границы автоматического анализа или содержит несогласованную версию чтения — требуется проверка исполнителя',reading_blocked:'Чтение комплекта ещё не завершено',stale:'Комплект изменился — прежний анализ недействителен',disabled:'Анализ ожидает разрешённого бюджета и включения',awaiting_analysis:'Комплект ожидает анализа',queued:'Анализ поставлен в очередь',claimed:'Подготовка части анализа',sent:'Изучается часть комплекта',budget:'Анализ остановлен лимитом бюджета',unknown:'Ответ поставщика не подтверждён — автоматического повтора нет',invalid:'Результат не прошёл проверку источников',output_limited:'Ответ поставщика обрезан — результат не принят',done:'Комплект изучен; выводы требуют проверки исполнителя'};
 function location(source){
  var p=source||{};
  return p.kind==='student_deadline'?'Срок, указанный студентом при регистрации':p.kind==='student_answer'?'Ответ студента':p.page?'страница '+p.page:p.paragraph?'абзац '+p.paragraph:p.sheet?'лист '+p.sheet+(p.cell?', ячейка '+p.cell:''):'фрагмент документа';
 }
 function evidence(values,esc){return (values||[]).map(function(v){return '<p>'+esc(v.value)+(v.refs||[]).map(function(r){return '<br><small>'+esc(r.fileName||'Пояснение студента')+' · '+esc(location(r.source))+'</small><br>«'+esc(r.quote)+'»';}).join('')+'</p>';}).join('');}
 function dialog(s,esc){return '<h4>Внутренняя переписка с помощником</h4><p>Сообщения приватны. Студент увидит только отдельно утверждённый вопрос.</p>'+(s.dialog||[]).map(function(m){return '<section style="overflow-wrap:anywhere"><b>'+esc(m.kind==='assistant'?'Помощник':'Вы')+'</b><p style="white-space:pre-wrap">'+esc(m.body)+'</p></section>';}).join('')+'<label>Комментарий помощнику<textarea data-private-text maxlength="1000"></textarea></label><button type="button" class="btn" data-private-send'+(s.manifest?'':' disabled')+'>Отправить помощнику</button><p>Голосовая переписка ожидает настройки распознавания и хранения записи.</p><button type="button" class="btn" data-study-refresh>Обновить изучение</button>';}
 function proposals(s,esc){
  return '<h4>Предложения вопросов</h4><p>Студент увидит вопрос после вашего подтверждения текста.</p>'+(s.proposals||[]).map(function(q){
   var current=s.state==='done'&&q.analysis_id===s.analysisId&&q.state==='pending';
   return '<section style="border-top:1px solid #cbd9e5;padding:12px 0;overflow-wrap:anywhere"><p><b>'+esc(q.reason)+'</b></p>'+evidence(q.evidence,esc)+(current?'<div class="fld"><label>Текст вопроса<textarea data-proposal-text="'+esc(q.id)+'" maxlength="2000">'+esc(q.question)+'</textarea></label></div><button type="button" class="btn" data-proposal-publish="'+esc(q.id)+'">Утвердить и отправить студенту</button><div class="fld"><label>Комментарий для повторного изучения<textarea data-proposal-comment="'+esc(q.id)+'" minlength="10" maxlength="1000"></textarea></label></div><button type="button" class="btn" data-proposal-return="'+esc(q.id)+'">Вернуть на изучение</button>':q.state==='published'?'<p><b>Отправлено студенту:</b> '+esc(q.published_text)+'</p><p>'+esc(q.restudy_reason||'')+'</p>':q.state==='returned'?'<p><b>Возвращено:</b> '+esc(q.return_comment)+'</p><p>'+esc(q.restudy_reason||'Ожидает повторного изучения комплекта')+'</p>':'<p>Комплект изменился. Это предложение ожидает повторного изучения.</p>')+'</section>';
  }).join('')+((s.proposals||[]).length?'':'<p>Предложений вопросов пока нет.</p>');
 }
 function content(s,esc){
  var result=s.result,html='<p role="status">'+esc(states[s.state]||'Неизвестное состояние')+'</p>';
  if(s.parts)html+='<p>Сохранено частей: '+Number(s.completed||0)+' из '+Number(s.parts)+'</p>';
  html+=(s.files||[]).map(function(f){
   var labels={assignment:'Задание',methodology:'Методичка и требования',data:'Исходные данные',sources:'Источники'},reading={idle:'ожидает чтения',reading:'читается',ready:'прочитан',blocked:'чтение заблокировано',failed:'ошибка чтения'};
   var roles=[];(result&&result.roles||[]).forEach(function(role){var category=role.role==='requirements'?'methodology':role.role;if(labels[category]&&(role.refs||[]).some(function(r){return r.fileId===f.id;})&&roles.indexOf(category)<0)roles.push(category);});
   return '<section style="padding:8px 0;overflow-wrap:anywhere"><p>'+esc(f.name)+': '+esc(reading[f.status]||f.status)+'</p>'+(f.category&&f.category!=='unclassified'?'<p>Назначение подтверждено: '+esc(labels[f.category]||f.category)+'</p>':s.state==='done'&&roles.length?'<label>Назначение файла<select data-file-role="'+esc(f.id)+'">'+roles.map(function(role){return '<option value="'+esc(role)+'">'+esc(labels[role])+'</option>';}).join('')+'</select></label><button type="button" class="btn" data-file-classify="'+esc(f.id)+'" data-analysis="'+esc(s.analysisId)+'">Подтвердить назначение файла</button>':'<p>Назначение файла ещё не подтверждено.</p>')+'</section>';
  }).join('');
  if(!result)return html+proposals(s,esc)+dialog(s,esc);
  if(result.kitReview){
   var review=result.kitReview,labels={sufficient:'Ответ достаточен по заключению',insufficient:'Ответ недостаточен',unknown:'Достаточность ответа не установлена'};
   html+='<h4>Достаточность комплекта</h4>'+(review.gaps&&review.gaps.length?'<p>Есть существенные нерешённые вопросы: '+Number(review.gaps.length)+'. Подготовка ожидает их разрешения.</p>':'<p>Проверка комплекта не выявила существенных пробелов. Это проект заключения; требования утверждаются отдельно.</p>');
   html+=(review.answerReviews||[]).map(function(a){return '<section style="overflow-wrap:anywhere"><b>'+esc(labels[a.status]||'Ответ требует проверки')+'</b><p>'+esc(a.reason)+'</p>'+evidence([{value:'Основания заключения',refs:a.refs}],esc)+'</section>';}).join('');
   html+=(review.returnedReviews||[]).map(function(r){var status=r.status==='resolved'?'Вопрос снят по заключению':r.status==='unresolved'?'Вопрос сохраняется':'Снятие вопроса не подтверждено';return '<section style="overflow-wrap:anywhere"><b>'+esc(status)+'</b><p>'+esc(r.reason)+'</p>'+evidence([{value:'Основания повторного изучения',refs:r.refs}],esc)+'</section>';}).join('');
  }else html+='<p>Проверка достаточности всего комплекта ещё не подтверждена.</p>';
  var values=[];Object.keys(result.fields||{}).forEach(function(k){var field=result.fields[k];(field.values||[]).forEach(function(v){values.push({label:field.label||k,value:v.value,refs:v.refs});});});
  (result.requirements||[]).forEach(function(v){values.push({label:'Требование',value:v.value,refs:v.refs});});
  return html+'<p>Это проект выводов. Отсутствующие сведения и противоречия проверяются по документам до утверждения требований.</p>'+values.map(function(v){return '<section style="border-top:1px solid #cbd9e5;padding:12px 0;overflow-wrap:anywhere"><b>'+esc(v.label)+'</b><p style="white-space:pre-wrap">'+esc(v.value)+'</p>'+(v.refs||[]).map(function(r){return '<p><small>'+esc(r.fileName||'Пояснение студента')+' · '+esc(location(r.source))+'</small><br>«'+esc(r.quote)+'»</p>';}).join('')+'</section>';}).join('')+proposals(s,esc)+dialog(s,esc);
 }
 async function show(o){
  var wrap=o.openModal('<button type="button" class="close" data-x="1">✕</button><h3>Изучение документов</h3><p role="status">Загрузка…</p>'),identity=root.Oblako.identity();
  var busy=false,studyManifest=null,pendingComment=null;
  function same(){return identity===root.Oblako.identity();}
  async function draw(){
   var response=await o.api({action:'registered-study-state',id:o.requestId});
   if(!wrap.isConnected)return;
   if(!same())throw Error('Аккаунт изменился. Откройте изучение заново.');
   studyManifest=response.study.manifest;
   var pane=wrap.querySelector('.sheet-in');
   pane.innerHTML='<button type="button" class="close" data-x="1" aria-label="Закрыть">✕</button><h3 id="'+o.esc(wrap.getAttribute('aria-labelledby'))+'">Изучение документов</h3>'+content(response.study,o.esc)+'<p role="status" data-study-status></p>';
   pane.querySelector('[data-x]').focus();
  }
  wrap.addEventListener('click',async function(event){
   var publish=event.target.closest('[data-proposal-publish]'),back=event.target.closest('[data-proposal-return]'),classify=event.target.closest('[data-file-classify]');
   var privateSend=event.target.closest('[data-private-send]'),refresh=event.target.closest('[data-study-refresh]');
   if((!publish&&!back&&!classify&&!privateSend&&!refresh)||busy)return;
   var status=wrap.querySelector('[data-study-status]');
   try{
    if(!same())throw Error('Аккаунт изменился. Откройте изучение заново.');
    if(refresh){busy=true;await draw();return;}
    if(privateSend){
     var body=wrap.querySelector('[data-private-text]').value.trim();
     if(!body||body.length>1000)throw Error('Введите комментарий до 1000 знаков');
     if(!pendingComment||pendingComment.text!==body)pendingComment={id:crypto.randomUUID(),text:body};
     busy=true;privateSend.disabled=true;
     await o.api({action:'registered-private-message',id:o.requestId,messageId:pendingComment.id,text:body,manifest:studyManifest});
     if(!same())throw Error('Аккаунт изменился. Откройте изучение заново.');
     pendingComment=null;await draw();return;
    }
    if(classify){
     busy=true;classify.disabled=true;
     var fileId=classify.dataset.fileClassify;
     await o.api({action:'registered-material-classify',id:o.requestId,analysisId:classify.dataset.analysis,fileId:fileId,category:wrap.querySelector('[data-file-role="'+fileId+'"]').value});
     await draw();return;
    }
    var id=publish?publish.dataset.proposalPublish:back.dataset.proposalReturn;
    var text=wrap.querySelector(publish?'[data-proposal-text="'+id+'"]':'[data-proposal-comment="'+id+'"]').value.trim();
    if(!text||(!publish&&text.length<10))throw Error('Заполните текст вопроса или комментарий от 10 знаков');
    busy=true;wrap.querySelectorAll('[data-proposal-publish],[data-proposal-return],[data-file-classify],[data-private-send],[data-study-refresh]').forEach(function(b){b.disabled=true;});
    await o.api({action:'registered-question-decide',id:o.requestId,proposalId:id,decision:publish?'publish':'return',text:text});
    if(!same())throw Error('Аккаунт изменился. Откройте изучение заново.');
    await draw();
   }catch(e){if(status&&status.isConnected)status.textContent=e.message||'Сохранение не подтверждено. Повторите тот же текст.';}
   finally{busy=false;if(same())wrap.querySelectorAll('[data-proposal-publish],[data-proposal-return],[data-file-classify],[data-private-send],[data-study-refresh]').forEach(function(b){b.disabled=b.hasAttribute('data-private-send')&&!studyManifest;});}
  });
  try{await draw();}catch(e){if(wrap.isConnected)wrap.querySelector('[role=status]').textContent=e.message||'Не удалось загрузить изучение';}
 }
 root.StudRegisteredStudy={show:show,content:content};
 if(typeof module!=='undefined')module.exports=root.StudRegisteredStudy;
})(typeof window==='undefined'?globalThis:window);
