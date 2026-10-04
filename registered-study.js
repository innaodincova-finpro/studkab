(function(root){
 'use strict';
 // ROUTE-02-C, UX-01: окно «Изучение документов» читается сверху вниз.
 // Сначала — что нужно от исполнителя (вопросы), затем справка: что система поняла о работе,
 // файлы, требования, переписка. Повторы текста убраны, второстепенное свёрнуто.
 var states={preparation_blocked:'Комплект не удалось подготовить к изучению автоматически. Нужна проверка исполнителя.',reading_blocked:'Файлы ещё читаются. Изучение начнётся после чтения.',stale:'Студент изменил материалы. Прежние выводы устарели, комплект будет изучен заново.',disabled:'Изучение не запущено: автоматический разбор сейчас выключен.',awaiting_analysis:'Комплект ожидает изучения.',queued:'Комплект изучается. Это займёт несколько минут.',claimed:'Комплект изучается. Это займёт несколько минут.',sent:'Комплект изучается. Это займёт несколько минут.',budget:'Изучение остановлено: исчерпан лимит расходов.',unknown:'Ответ помощника не получен. Повтор не выполняется автоматически, нужна проверка исполнителя.',invalid:'Ответ помощника не прошёл проверку. Нужна проверка исполнителя.',output_limited:'Ответ помощника обрезан и не принят. Нужна проверка исполнителя.',done:'Изучение завершено.'};
 var roleLabels={assignment:'Задание',methodology:'Методичка и требования',data:'Исходные данные',sources:'Источники'};
 var readingLabels={idle:'ожидает чтения',reading:'читается',ready:'прочитан',blocked:'чтение заблокировано',failed:'ошибка чтения'};
 var mainFields=['t','k','d','u','fc','kf','g','n','pr','org','ct','dl'];
 var requirementGroups=[['structure','Структура'],['length','Объём'],['formatting','Оформление'],['data','Исходные данные и расчёты'],['sources','Источники'],['requirement','Прочие требования']];
 var css='<style>.rs-status{background:#FFF4DC;border:1px solid #E8C77A;border-radius:10px;padding:12px 14px;margin:6px 0 4px;font-size:15px}.rs-status.rs-calm{background:#EEF4F9;border-color:#C9D9E8}.rs-h{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#4A6382;margin:22px 0 8px}.rs-card{border:1px solid #D5DEE8;border-radius:12px;padding:12px 14px;margin:0 0 12px;background:#fff;overflow-wrap:anywhere}.rs-why{color:#56677B;font-size:14px;margin:6px 0}.rs-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:10px}.rs-actions .btn{width:auto;margin-top:0}.rs-card details{margin-top:6px}.rs-card summary,.rs-more>summary{cursor:pointer;color:#2F5F93;font-size:14px}.rs-more{border:1px solid #D5DEE8;border-radius:12px;padding:10px 14px;margin:0 0 10px;background:#fff;overflow-wrap:anywhere}.rs-src{font-size:13px;color:#56677B;margin:6px 0}.rs-table{width:100%;border-collapse:collapse;font-size:14px}.rs-table td{padding:7px 8px;border-bottom:1px solid #E6ECF2;vertical-align:top}.rs-table td:first-child{color:#56677B;width:38%}.rs-ok{color:#2C7A4B;font-weight:bold}.rs-card textarea{width:100%;box-sizing:border-box}</style>';
 function location(source){
  var p=source||{};
  return p.kind==='student_deadline'?'срок из заявки':p.kind==='student_answer'?'ответ студента':p.kind==='student_note'?'заметка студента':p.page?'страница '+p.page:p.paragraph?'абзац '+p.paragraph:p.table?'таблица '+p.table+(p.row?', строка '+p.row:''):p.sheet?'лист '+p.sheet+(p.cell?', ячейка '+p.cell:''):'фрагмент документа';
 }
 function norm(v){return String(v||'').replace(/\s+/g,' ').trim();}
 function sources(refs,value,esc){
  return (refs||[]).map(function(r){var q=norm(r.quote);return '<p class="rs-src">'+esc(r.fileName||'Сведения студента')+' · '+esc(location(r.source))+(q&&q!==norm(value)?'<br>«'+esc(r.quote)+'»':'')+'</p>';}).join('');
 }
 function current(s,q){return s.state==='done'&&q.analysis_id===s.analysisId&&q.state==='pending';}
 function summary(s){
  var proposals=(s&&s.proposals)||[];
  return {state:s&&s.state||'',pending:proposals.filter(function(q){return current(s,q);}).length,published:proposals.filter(function(q){return q.state==='published';}).length,returned:proposals.filter(function(q){return q.state==='returned';}).length};
 }
 function statusLine(s){
  var n=summary(s).pending,review=s.result&&s.result.kitReview,gaps=review&&review.gaps?review.gaps.length:0;
  if(s.state!=='done')return '<p role="status" class="rs-status rs-calm">'+(states[s.state]||'Состояние изучения не определено.')+'</p>';
  if(n)return '<p role="status" class="rs-status">Изучение завершено. <b>Нужно ваше решение по '+n+' '+(n===1?'вопросу':'вопросам')+'.</b> Подготовка работы начнётся, когда вопросы будут решены.</p>';
  if(review&&!gaps)return '<p role="status" class="rs-status rs-calm">Изучение завершено. Вопросов к студенту нет.</p>';
  return '<p role="status" class="rs-status rs-calm">Изучение завершено. Решения по вопросам приняты.</p>';
 }
 function questionCard(s,q,esc){
  var evidence=(q.evidence||[]).map(function(e){return sources(e.refs,'',esc);}).join('');
  var grounds=evidence?'<details><summary>Показать основание из документов</summary>'+evidence+'</details>':'';
  if(current(s,q))return '<section class="rs-card"><div class="fld"><label>Вопрос студенту — текст можно поправить<textarea data-proposal-text="'+esc(q.id)+'" maxlength="2000" rows="3">'+esc(q.question)+'</textarea></label></div><p class="rs-why">Почему: <span>'+esc(q.reason)+'</span></p>'+grounds+
   '<div class="rs-actions"><button type="button" class="btn" data-proposal-publish="'+esc(q.id)+'">Отправить студенту</button></div>'+
   '<details class="rs-return"><summary>Вопрос лишний</summary><div class="fld"><label>Почему вопрос лишний. Помощник изучит комплект заново с вашим комментарием (не короче 10 знаков)<textarea data-proposal-comment="'+esc(q.id)+'" minlength="10" maxlength="1000" rows="3"></textarea></label></div><button type="button" class="btn" data-proposal-return="'+esc(q.id)+'">Вернуть на изучение</button></details></section>';
  if(q.state==='published')return '<section class="rs-card"><p><b>Отправлено студенту:</b> '+esc(q.published_text)+'</p>'+(q.restudy_reason?'<p class="rs-why">'+esc(q.restudy_reason)+'</p>':'')+'</section>';
  if(q.state==='returned')return '<section class="rs-card"><p><b>Возвращено на изучение:</b> '+esc(q.return_comment)+'</p><p class="rs-why">'+esc(q.restudy_reason||'Ожидает повторного изучения комплекта')+'</p></section>';
  return '<section class="rs-card"><p>'+esc(q.question)+'</p><p class="rs-why">Комплект изменился. Вопрос будет пересмотрен при новом изучении.</p></section>';
 }
 function questions(s,esc){
  var list=(s.proposals||[]).slice().sort(function(a,b){return (current(s,b)?1:0)-(current(s,a)?1:0);});
  if(!list.length)return s.state==='done'?'':'<h4 class="rs-h">Вопросы студенту</h4><p class="hint">Вопросы появятся после изучения комплекта.</p>';
  return '<h4 class="rs-h">Вопросы студенту</h4>'+list.map(function(q){return questionCard(s,q,esc);}).join('');
 }
 function reviews(s,esc){
  var review=s.result&&s.result.kitReview;if(!review)return '';
  var answer={sufficient:'Ответ достаточен',insufficient:'Ответ недостаточен',unknown:'Достаточность ответа не установлена'};
  var items=(review.answerReviews||[]).map(function(a){return '<section class="rs-card"><b>'+esc(answer[a.status]||'Ответ требует проверки')+'</b><p class="rs-why">'+esc(a.reason)+'</p>'+((a.refs||[]).length?'<details><summary>Показать основание</summary>'+sources(a.refs,'',esc)+'</details>':'')+'</section>';})
   .concat((review.returnedReviews||[]).map(function(r){var t=r.status==='resolved'?'Вопрос снят по заключению':r.status==='unresolved'?'Вопрос сохраняется':'Снятие вопроса не подтверждено';return '<section class="rs-card"><b>'+esc(t)+'</b><p class="rs-why">'+esc(r.reason)+'</p>'+((r.refs||[]).length?'<details><summary>Показать основание</summary>'+sources(r.refs,'',esc)+'</details>':'')+'</section>';}));
  return items.length?'<h4 class="rs-h">Ответы студента и возвращённые вопросы</h4>'+items.join(''):'';
 }
 function understood(s,esc){
  var fields=(s.result&&s.result.fields)||{},rows=[];
  mainFields.forEach(function(k){var f=fields[k];if(!f||!(f.values||[]).length)return;
   rows.push('<tr><td>'+esc(f.label||k)+(f.status==='conflict'?'<br><small>в документах разные значения</small>':'')+'</td><td>'+f.values.map(function(v){return esc(v.value)+((v.refs||[]).length?'<details><summary>источник</summary>'+sources(v.refs,v.value,esc)+'</details>':'');}).join('<hr>')+'</td></tr>');});
  return rows.length?'<h4 class="rs-h">Что система поняла о работе</h4><div class="rs-card"><table class="rs-table">'+rows.join('')+'</table></div>':'';
 }
 function detectedRoles(s,f){
  var roles=[];((s.result&&s.result.roles)||[]).forEach(function(role){var c=role.role==='requirements'?'methodology':role.role;if(roleLabels[c]&&(role.refs||[]).some(function(r){return r.fileId===f.id;})&&roles.indexOf(c)<0)roles.push(c);});
  return roles;
 }
 function files(s,esc){
  var list=s.files||[];if(!list.length)return '';
  var open=list.filter(function(f){return !(f.category&&f.category!=='unclassified')&&s.state==='done'&&detectedRoles(s,f).length;});
  var rows=list.map(function(f){var confirmed=f.category&&f.category!=='unclassified',roles=detectedRoles(s,f);
   return '<li>'+esc(f.name)+' — '+(f.status!=='ready'?esc(readingLabels[f.status]||f.status):confirmed?esc(roleLabels[f.category]||f.category):roles.length?esc(roleLabels[roles[0]]):'назначение не определено')+'</li>';}).join('');
  var all=list.every(function(f){return f.category&&f.category!=='unclassified';});
  var tail=all?'<p class="rs-ok">✓ Назначение файлов подтверждено</p>':open.length?'<p class="rs-why">Назначение определено автоматически. Проверьте и подтвердите.</p><div class="rs-actions"><button type="button" class="btn" data-file-classify-all="'+esc(s.analysisId)+'">Всё верно — подтвердить</button></div><details><summary>Исправить назначение</summary>'+open.map(function(f){var roles=detectedRoles(s,f);return '<div class="fld"><label>'+esc(f.name)+'<select data-file-role="'+esc(f.id)+'">'+roles.map(function(r){return '<option value="'+esc(r)+'">'+esc(roleLabels[r])+'</option>';}).join('')+'</select></label><button type="button" class="mini" data-file-classify="'+esc(f.id)+'" data-analysis="'+esc(s.analysisId)+'">Подтвердить этот файл</button></div>';}).join('')+'</details>':'<p class="rs-why">Назначение файлов подтверждается после изучения.</p>';
  return '<h4 class="rs-h">Файлы</h4><div class="rs-card"><ul>'+rows+'</ul>'+tail+'</div>';
 }
 function requirements(s,esc){
  var result=s.result||{},fields=result.fields||{},total=0;
  var groups=requirementGroups.map(function(g){
   var values=g[0]==='requirement'?(result.requirements||[]):((fields[g[0]]||{}).values||[]);total+=values.length;
   return values.length?'<p><b>'+esc(g[1])+'</b></p>'+values.map(function(v){return '<div class="rs-card"><p style="white-space:pre-wrap">'+esc(v.value)+(v.condition?'<br><small>Условие: '+esc(v.condition)+'</small>':'')+'</p>'+sources(v.refs,v.value,esc)+'</div>';}).join(''):'';
  }).join('');
  return total?'<details class="rs-more" data-rs-key="requirements"><summary>Требования из документов ('+total+')</summary>'+groups+'</details>':'';
 }
 function dialog(s,esc){
  var messages=(s.dialog||[]).map(function(m){return '<section class="rs-card"><b>'+esc(m.kind==='assistant'?'Помощник':'Вы')+'</b><p style="white-space:pre-wrap">'+esc(m.body)+'</p></section>';}).join('');
  return '<details class="rs-more" data-rs-key="dialog"><summary>Переписка с помощником'+((s.dialog||[]).length?' ('+s.dialog.length+')':'')+'</summary><p class="hint">Сообщения видите только вы. Студент увидит только отправленный ему вопрос.</p>'+messages+'<div class="fld"><label>Комментарий помощнику<textarea data-private-text maxlength="1000" rows="3"></textarea></label></div><button type="button" class="btn" data-private-send'+(s.manifest?'':' disabled')+'>Отправить помощнику</button></details>';
 }
 function content(s,esc){
  return css+statusLine(s)+'<div class="rs-actions"><button type="button" class="mini" data-study-refresh>Обновить</button></div>'+questions(s,esc)+reviews(s,esc)+understood(s,esc)+files(s,esc)+requirements(s,esc)+dialog(s,esc);
 }
 async function show(o){
  var wrap=o.openModal('<button type="button" class="close" data-x="1">✕</button><h3>Изучение документов</h3><p role="status">Загрузка…</p>'),identity=root.Oblako.identity();
  var busy=false,studyManifest=null,pendingComment=null,latest=null;
  var nativeRemove=wrap.remove;wrap.remove=function(){var was=wrap.isConnected;nativeRemove.call(wrap);if(was&&typeof o.onClose==='function')o.onClose(latest);};
  function same(){return identity===root.Oblako.identity();}
  var buttons='[data-proposal-publish],[data-proposal-return],[data-file-classify],[data-file-classify-all],[data-private-send],[data-study-refresh]';
  async function draw(){
   var response=await o.api({action:'registered-study-state',id:o.requestId});
   if(!wrap.isConnected)return;
   if(!same())throw Error('Аккаунт изменился. Откройте изучение заново.');
   studyManifest=response.study.manifest;latest=summary(response.study);
   if(typeof o.onState==='function')o.onState(latest);
   var pane=wrap.querySelector('.sheet-in');
   // Раскрытые разделы остаются раскрытыми после сохранения и обновления.
   var opened=Array.from(pane.querySelectorAll('details[data-rs-key][open]')).map(function(d){return d.dataset.rsKey;});
   pane.innerHTML='<button type="button" class="close" data-x="1" aria-label="Закрыть">✕</button><h3 id="'+o.esc(wrap.getAttribute('aria-labelledby'))+'">Изучение документов</h3>'+content(response.study,o.esc)+'<p role="status" data-study-status></p>';
   opened.forEach(function(k){var d=pane.querySelector('details[data-rs-key="'+k+'"]');if(d)d.open=true;});
   pane.querySelector('[data-x]').focus();
  }
  wrap.addEventListener('click',async function(event){
   var publish=event.target.closest('[data-proposal-publish]'),back=event.target.closest('[data-proposal-return]'),classify=event.target.closest('[data-file-classify]'),classifyAll=event.target.closest('[data-file-classify-all]');
   var privateSend=event.target.closest('[data-private-send]'),refresh=event.target.closest('[data-study-refresh]');
   if((!publish&&!back&&!classify&&!classifyAll&&!privateSend&&!refresh)||busy)return;
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
    if(classify||classifyAll){
     busy=true;wrap.querySelectorAll(buttons).forEach(function(b){b.disabled=true;});
     var targets=classify?[classify]:Array.from(wrap.querySelectorAll('[data-file-classify]'));
     // Файлы подтверждаются по одному тем же действием, что и прежде; ошибка останавливает цепочку.
     for(var i=0;i<targets.length;i++){
      var fileId=targets[i].dataset.fileClassify;
      if(!same())throw Error('Аккаунт изменился. Откройте изучение заново.');
      await o.api({action:'registered-material-classify',id:o.requestId,analysisId:targets[i].dataset.analysis,fileId:fileId,category:wrap.querySelector('[data-file-role="'+fileId+'"]').value});
     }
     await draw();return;
    }
    var id=publish?publish.dataset.proposalPublish:back.dataset.proposalReturn;
    var text=wrap.querySelector(publish?'[data-proposal-text="'+id+'"]':'[data-proposal-comment="'+id+'"]').value.trim();
    if(!text)throw Error(publish?'Текст вопроса пуст. Впишите вопрос студенту.':'Напишите, почему вопрос лишний: от 10 знаков');
    if(!publish&&text.length<10)throw Error('Напишите, почему вопрос лишний: от 10 знаков');
    busy=true;wrap.querySelectorAll(buttons).forEach(function(b){b.disabled=true;});
    await o.api({action:'registered-question-decide',id:o.requestId,proposalId:id,decision:publish?'publish':'return',text:text});
    if(!same())throw Error('Аккаунт изменился. Откройте изучение заново.');
    await draw();
   }catch(e){if(status&&status.isConnected)status.textContent=e.message||'Сохранение не подтверждено. Повторите то же действие.';}
   finally{busy=false;if(same())wrap.querySelectorAll(buttons).forEach(function(b){b.disabled=b.hasAttribute('data-private-send')&&!studyManifest;});}
  });
  try{await draw();}catch(e){if(wrap.isConnected)wrap.querySelector('[role=status]').textContent=e.message||'Не удалось загрузить изучение';}
 }
 root.StudRegisteredStudy={show:show,content:content,summary:summary};
 if(typeof module!=='undefined')module.exports=root.StudRegisteredStudy;
})(typeof window==='undefined'?globalThis:window);
