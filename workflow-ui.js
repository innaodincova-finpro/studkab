(function(global){
 'use strict';
 var seq=0,busy=false;
 var labels={submitted:'Заявка получена',completeness_review:'Проверяются материалы',needs_information:'Нужны данные',passport_draft:'Формируется паспорт требований',passport_approved:'Требования утверждены',preparing:'Готовится документ',quality_review:'Проверяется документ',changes_required:'Нужна доработка',ready_to_deliver:'Готов к передаче',delivered:'Черновик передан',closed:'Работа закрыта',cancelled:'Заявка отменена'};
 var purposes={assignment:'Задание преподавателя',guidelines:'Методические указания',financials:'Финансовые материалы',bibliography:'Библиография',sample:'Образец оформления',other:'Другой материал'};
 var next={submitted:['completeness_review','Начать проверку материалов'],completeness_review:['passport_draft','Сформировать паспорт требований'],passport_approved:['preparing','Начать подготовку'],preparing:['quality_review','Передать на контроль'],changes_required:['preparing','Вернуть в подготовку'],delivered:['closed','Закрыть заявку']};
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function command(action,requestId,payload){return global.Oblako.workflowApi({action:action,requestId:requestId,commandId:crypto.randomUUID(),payload:payload||{}});}
 function mime(file){
  if(file.type)return file.type;
  var ext=(file.name.split('.').pop()||'').toLowerCase();
  return {pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',txt:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',heic:'image/heic'}[ext]||'';
 }
 function fileRows(files){
  if(!files.length)return '<p class="hint">Файлы ещё не добавлены.</p>';
  return files.map(function(f){return '<div class="stat"><span>'+esc(purposes[f.purpose]||f.purpose)+'</span><b>'+esc(f.originalName||f.original_name)+' · '+esc(f.state==='accepted'?'проверен':f.state==='rejected'?'отклонён':'проверяется')+'</b></div>';}).join('');
 }
 function student(data,id){
  var open=(data.clarifications||[]).filter(function(x){return x.state==='open';});
  return '<div class="card"><div class="label">Подготовка по заявке</div><div class="stat"><span>Текущий этап</span><b>'+esc(labels[data.process.status]||data.process.status)+'</b></div>'+fileRows(data.files||[])+
   '<div class="fld"><label>Добавить материал</label><select data-workflow-purpose>'+Object.keys(purposes).map(function(k){return '<option value="'+k+'">'+esc(purposes[k])+'</option>';}).join('')+'</select><input type="file" data-workflow-file accept=".pdf,.docx,.xlsx,.csv,.txt,image/png,image/jpeg,image/heic"><button type="button" class="chip" data-workflow-action="upload" data-request-id="'+id+'">Загрузить файл</button></div></div>'+
   open.map(function(q){return '<div class="card"><div class="label">Уточнение исполнителя</div><p>'+esc(q.question)+'</p><div class="fld"><textarea data-workflow-answer maxlength="12000" placeholder="Напишите ответ"></textarea></div><button type="button" class="btn" data-workflow-action="answer" data-request-id="'+id+'" data-clarification-id="'+esc(q.id)+'">Отправить ответ</button></div>';}).join('');
 }
 function executor(data,id){
  var action=next[data.process.status],criteria=data.criteria||[],failed=criteria.filter(function(x){return x.status==='fail'||x.status==='unable_to_verify';}).length;
  return '<div class="card"><div class="label">Контроль качества</div><div class="stat"><span>Этап</span><b>'+esc(labels[data.process.status]||data.process.status)+'</b></div><div class="stat"><span>Версия процесса</span><b>'+esc(data.process.revision)+'</b></div><div class="stat"><span>Файлы</span><b>'+esc((data.files||[]).length)+'</b></div><div class="stat"><span>Требования паспорта</span><b>'+esc((data.requirements||[]).length)+'</b></div><div class="stat"><span>Проблемы контроля</span><b>'+failed+'</b></div>'+
   (action?'<button type="button" class="btn" data-workflow-action="transition" data-request-id="'+id+'" data-next="'+action[0]+'" data-revision="'+data.process.revision+'">'+esc(action[1])+'</button>':'<p class="hint">Следующее действие выполняется в соответствующем разделе паспорта или контроля документа.</p>')+'</div>';
 }
 async function paint(){
  var node=document.getElementById('workflowPanel');if(!node)return;
  var token=++seq,id=node.getAttribute('data-request-id'),role=node.getAttribute('data-role');
  node.innerHTML='<div class="card"><p class="hint">Загружаем состояние заявки…</p></div>';
  try{
   var data=await command('get_snapshot',id,{});
   if(token!==seq||!node.isConnected||node.getAttribute('data-request-id')!==id)return;
   node.innerHTML=role==='executor'?executor(data,id):student(data,id);
  }catch(e){
   if(token!==seq||!node.isConnected)return;
   if(e.status===503){node.innerHTML='';node.hidden=true;return;}
   node.innerHTML='<div class="card"><p class="hint">'+esc(e.message||'Не удалось получить состояние заявки')+'</p><button type="button" class="chip" data-workflow-action="refresh">Повторить</button></div>';
  }
 }
 async function act(button){
  if(busy)return;var action=button.getAttribute('data-workflow-action');if(action==='refresh')return paint();
  var id=button.getAttribute('data-request-id');busy=true;button.disabled=true;
  try{
   if(action==='upload'){
    var box=document.getElementById('workflowPanel'),input=box.querySelector('[data-workflow-file]'),file=input.files[0];
    if(!file)throw Error('Сначала выберите файл');
    if(file.size<1||file.size>15728640)throw Error('Размер файла должен быть не больше 15 МБ');
    var type=mime(file);if(!type)throw Error('Формат файла не поддерживается');
    var purpose=box.querySelector('[data-workflow-purpose]').value;
    var prepared=await command('prepare_upload',id,{purpose:purpose,originalName:file.name,declaredMime:type,sizeBytes:file.size});
    await global.Oblako.workflowUpload(prepared.path,file);
    if(global.toast)global.toast('Файл загружен и ожидает проверки');
   }else if(action==='answer'){
    var text=button.closest('.card').querySelector('[data-workflow-answer]').value.trim();if(!text)throw Error('Напишите ответ');
    await command('answer_clarification',id,{clarificationId:button.getAttribute('data-clarification-id'),answer:text});
    if(global.toast)global.toast('Ответ отправлен исполнителю');
   }else if(action==='transition'){
    await command('transition_request',id,{expectedRevision:Number(button.getAttribute('data-revision')),nextStatus:button.getAttribute('data-next'),reason:'executor_action'});
    if(global.toast)global.toast('Этап заявки обновлён');
   }
   await paint();
  }catch(e){if(global.toast)global.toast(e.message||'Действие не выполнено');}
  finally{busy=false;if(button.isConnected)button.disabled=false;}
 }
 document.addEventListener('click',function(e){var b=e.target.closest('[data-workflow-action]');if(b){e.preventDefault();act(b);}});
 global.WorkflowUI={paint:paint,labels:labels,purposes:purposes};
})(window);
