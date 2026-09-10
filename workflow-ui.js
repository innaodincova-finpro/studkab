(function(global){
 'use strict';
 var seq=0,busy=false,viewState=null;
 var labels={submitted:'Заявка получена',completeness_review:'Проверяются материалы',needs_information:'Нужны данные',passport_draft:'Формируется паспорт требований',passport_approved:'Требования утверждены',preparing:'Готовится документ',quality_review:'Проверяется документ',changes_required:'Нужна доработка',ready_to_deliver:'Готов к передаче',delivered:'Черновик передан',closed:'Работа закрыта',cancelled:'Заявка отменена'};
 var purposes={assignment:'Задание преподавателя',guidelines:'Методические указания',financials:'Финансовые материалы',bibliography:'Библиография',sample:'Образец оформления',other:'Другой материал'};
 var next={submitted:['completeness_review','Начать проверку материалов'],completeness_review:['passport_draft','Сформировать паспорт требований'],passport_approved:['preparing','Начать подготовку'],preparing:['quality_review','Передать на контроль'],changes_required:['preparing','Вернуть в подготовку'],delivered:['closed','Закрыть заявку']};
 var baseRequirements=[
  ['IN-01','Тема совпадает с заданием','critical','manual'],['IN-02','Организация указана однозначно','critical','manual'],['IN-03','Период совпадает с заданием и исходными данными','critical','manual'],['IN-04','Задание приложено либо отсутствие зафиксировано','critical','manual'],['IN-05','Применимая методичка определена','critical','manual'],['IN-06','Конфликты требований разрешены','critical','manual'],['IN-08','Получатель и титульные данные подтверждены','critical','manual'],
  ['DATA-01','Все обязательные формы и периоды присутствуют','critical','manual'],['DATA-02','Единицы измерения установлены','critical','manual'],['DATA-03','Баланс сходится в установленном допуске','critical','manual'],['DATA-04','Данные перенесены без потери строк и знаков','critical','manual'],['DATA-07','Происхождение данных зафиксировано','critical','manual'],
  ['CALC-01','Показатели соответствуют заданию','critical','manual'],['CALC-02','Для показателей указаны формулы и источники','critical','manual'],['CALC-04','Арифметика воспроизводится из исходных данных','critical','manual'],['CALC-06','Таблицы, текст и выводы содержат согласованные значения','critical','manual'],
  ['AN-01','Каждый обязательный показатель проанализирован','critical','manual'],['AN-02','Выводы соответствуют рассчитанным значениям','critical','manual'],['AN-04','Причины изменений не выдуманы','critical','manual'],['REC-01','Рекомендации связаны с выявленными проблемами','critical','manual'],['REC-04','Не обещан неподтверждённый эффект','critical','manual'],
  ['SRC-01','Каждый источник существует и идентифицирован','critical','manual'],['SRC-02','Источник подтверждает связанное утверждение','critical','manual'],['SRC-05','Нет требующих ссылки утверждений без основания','critical','manual'],
  ['TXT-04','Нет технических пометок и пустых разделов','critical','automatic'],['TXT-05','Нет полных межраздельных повторов','substantial','automatic'],
  ['DOC-01','Титульный лист соответствует паспорту','critical','manual'],['DOC-04','Таблицы и рисунки читаемы и подписаны','critical','manual'],['DOC-06','Файл DOCX открывается и имеет верную структуру','critical','automatic'],['DOC-07','Передаваемая версия совпадает с проверенной','critical','automatic'],['DOC-08','Получатель совпадает с владельцем заявки','critical','automatic'],['DOC-09','Ограничения подготовлены для студента','critical','manual']
 ];
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function command(action,requestId,payload){return global.Oblako.workflowApi({action:action,requestId:requestId,commandId:crypto.randomUUID(),payload:payload||{}});}
 async function hash(value){var bytes=value instanceof Blob?await value.arrayBuffer():new TextEncoder().encode(String(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),function(b){return b.toString(16).padStart(2,'0');}).join('');}
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
  var delivered=(data.documents||[]).filter(function(x){return x.state==='delivered';}).at(-1);
  return '<div class="card"><div class="label">Подготовка по заявке</div><div class="stat"><span>Текущий этап</span><b>'+esc(labels[data.process.status]||data.process.status)+'</b></div>'+fileRows(data.files||[])+
   '<div class="fld"><label>Добавить материал</label><select data-workflow-purpose>'+Object.keys(purposes).map(function(k){return '<option value="'+k+'">'+esc(purposes[k])+'</option>';}).join('')+'</select><input type="file" data-workflow-file accept=".pdf,.docx,.xlsx,.csv,.txt,image/png,image/jpeg,image/heic"><button type="button" class="chip" data-workflow-action="upload" data-request-id="'+id+'">Загрузить файл</button></div></div>'+
   open.map(function(q){return '<div class="card"><div class="label">Уточнение исполнителя</div><p>'+esc(q.question)+'</p><div class="fld"><textarea data-workflow-answer maxlength="12000" placeholder="Напишите ответ"></textarea></div><button type="button" class="btn" data-workflow-action="answer" data-request-id="'+id+'" data-clarification-id="'+esc(q.id)+'">Отправить ответ</button></div>';}).join('')+
   (delivered?'<div class="card"><div class="label">Проверенный черновик Word</div><p class="hint">Версия '+esc(delivered.version)+'. Перед скачиванием программа сверит контрольную сумму.</p><button type="button" class="btn" data-workflow-action="download" data-request-id="'+id+'">Скачать Word</button></div>':'');
 }
 function requirementRows(requirements,criteria,documentId){
  var by={};criteria.filter(function(c){return c.document_id===documentId;}).forEach(function(c){by[c.requirement_id+':'+c.evaluator_type]=c;});
  return requirements.filter(function(r){return r.applicability==='applicable';}).map(function(r){var manual=by[r.id+':human'],auto=by[r.id+':automatic'];return '<div class="stat" style="display:block"><b>'+esc(r.code)+' · '+esc(r.rule_text)+'</b><div class="hint">'+esc(r.severity==='critical'?'Критический':r.severity==='substantial'?'Существенный':'Рекомендательный')+' · '+esc(r.verification_method==='automatic'?'автоматически':r.verification_method==='combined'?'автоматически и вручную':'вручную')+(auto?' · автопроверка: '+esc(auto.status):'')+'</div>'+(r.verification_method!=='automatic'?'<select data-workflow-check="'+esc(r.id)+'"><option value="">Не проверено</option><option value="pass"'+(manual&&manual.status==='pass'?' selected':'')+'>Соответствует</option><option value="fail"'+(manual&&manual.status==='fail'?' selected':'')+'>Не соответствует</option><option value="unable_to_verify"'+(manual&&manual.status==='unable_to_verify'?' selected':'')+'>Невозможно проверить</option></select><input data-workflow-comment="'+esc(r.id)+'" maxlength="1000" placeholder="Комментарий или доказательство" value="'+esc(manual&&manual.comment||'')+'">':'')+'</div>';}).join('');
 }
 function executor(data,id){
  var action=next[data.process.status],criteria=data.criteria||[],failed=criteria.filter(function(x){return x.status==='fail'||x.status==='unable_to_verify';}).length;
  var passport=(data.passports||[]).slice().sort(function(a,b){return a.version-b.version;}).at(-1),requirements=passport?(data.requirements||[]).filter(function(r){return r.passport_id===passport.id;}):[];
  var document=(data.documents||[]).find(function(d){return d.id===data.process.active_document_id;});
  var head='<div class="card"><div class="label">Контроль качества</div><div class="stat"><span>Этап</span><b>'+esc(labels[data.process.status]||data.process.status)+'</b></div><div class="stat"><span>Версия процесса</span><b>'+esc(data.process.revision)+'</b></div><div class="stat"><span>Проверенные файлы</span><b>'+esc((data.files||[]).filter(function(f){return f.state==='accepted';}).length)+' из '+esc((data.files||[]).length)+'</b></div><div class="stat"><span>Проблемы контроля</span><b>'+failed+'</b></div>'+(action?'<button type="button" class="btn" data-workflow-action="transition" data-request-id="'+id+'" data-next="'+action[0]+'" data-revision="'+data.process.revision+'">'+esc(action[1])+'</button>':'')+'</div>';
  var canEditPassport=['completeness_review','needs_information','passport_draft'].includes(data.process.status);
  var pass='<div class="card"><div class="label">Паспорт требований</div>'+(passport?'<div class="stat"><span>Версия</span><b>'+esc(passport.version)+' · '+esc(passport.state)+'</b></div><details><summary>Критерии · '+requirements.length+'</summary>'+requirements.map(function(r){return '<div class="stat"><span>'+esc(r.code)+'</span><b>'+esc(r.rule_text)+'</b></div>';}).join('')+'</details>':'<p class="hint">Паспорт ещё не создан. Типовой профиль нужно дополнить требованиями задания и методички.</p>')+'<div class="chips">'+(canEditPassport?'<button type="button" class="chip" data-workflow-action="passport-open" data-request-id="'+id+'">'+(passport?'Создать новую версию':'Создать паспорт')+'</button>':'')+(passport&&passport.state==='draft'?'<button type="button" class="btn" data-workflow-action="passport-approve" data-request-id="'+id+'" data-passport-id="'+passport.id+'" data-revision="'+data.process.revision+'">Утвердить паспорт</button>':'')+'</div></div>';
  var ask=['completeness_review','passport_draft'].includes(data.process.status)?'<div class="card"><div class="label">Уточнение студенту</div><div class="fld"><textarea data-workflow-question maxlength="4000" placeholder="Какого документа или сведения не хватает?"></textarea></div><button type="button" class="chip" data-workflow-action="ask" data-request-id="'+id+'">Отправить вопрос</button></div>':'';
  var doc='<div class="card"><div class="label">Контрольный лист документа</div>'+(document?'<div class="stat"><span>Версия Word</span><b>'+esc(document.version)+' · '+esc(document.state)+'</b></div><details open><summary>Критерии · '+requirements.length+'</summary>'+requirementRows(requirements,criteria,document.id)+'</details><div class="chips"><button type="button" class="chip" data-workflow-action="automatic-checks" data-request-id="'+id+'" data-document-id="'+document.id+'">Запустить автопроверку</button><button type="button" class="chip" data-workflow-action="checks-save" data-request-id="'+id+'" data-document-id="'+document.id+'">Сохранить ручную проверку</button>'+(data.process.status==='quality_review'?'<button type="button" class="btn" data-workflow-action="document-approve" data-request-id="'+id+'" data-document-id="'+document.id+'" data-revision="'+data.process.revision+'">Подтвердить готовность</button>':'')+(data.process.status==='ready_to_deliver'?'<button type="button" class="btn" data-workflow-action="document-deliver" data-request-id="'+id+'" data-document-id="'+document.id+'" data-revision="'+data.process.revision+'">Передать студенту</button>':'')+'</div>':'<p class="hint">Сначала утвердите паспорт и подготовьте документ.</p>'+(data.process.status==='preparing'?'<button type="button" class="btn" data-workflow-action="document-register" data-request-id="'+id+'" data-passport-id="'+esc(data.process.active_passport_id)+'" data-revision="'+data.process.revision+'">Зарегистрировать текущий Word для проверки</button>':''))+'</div>';
  return head+pass+ask+doc;
 }
 async function paint(){
  var node=document.getElementById('workflowPanel');if(!node)return;
  var token=++seq,id=node.getAttribute('data-request-id'),role=node.getAttribute('data-role');
  node.innerHTML='<div class="card"><p class="hint">Загружаем состояние заявки…</p></div>';
  try{
   var data=await command('get_snapshot',id,{});
   if(token!==seq||!node.isConnected||node.getAttribute('data-request-id')!==id)return;
   viewState=data;node.innerHTML=role==='executor'?executor(data,id):student(data,id);
   var legacy=document.getElementById('legacyDeliveryPanel');if(legacy&&role==='executor')legacy.hidden=true;
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
    var checked=await command('complete_upload',id,{fileId:prepared.fileId});
    if(checked.state!=='accepted')throw Error('Файл отклонён: формат или содержимое не соответствуют выбранному типу');
    if(global.toast)global.toast('Файл загружен и проверен');
   }else if(action==='answer'){
    var text=button.closest('.card').querySelector('[data-workflow-answer]').value.trim();if(!text)throw Error('Напишите ответ');
    await command('answer_clarification',id,{clarificationId:button.getAttribute('data-clarification-id'),answer:text,expectedRevision:viewState.process.revision});
    if(global.toast)global.toast('Ответ отправлен исполнителю');
   }else if(action==='passport-open'){
    var rows=baseRequirements.map(function(r){return '<div class="stat"><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>';}).join('');
    global.openModal('<button type="button" class="close" data-x="1">✕</button><h3>Паспорт требований</h3><p class="hint">Типовые критерии финансовой курсовой. Добавьте только требования конкретного задания или методички.</p><details><summary>Типовые критерии · '+baseRequirements.length+'</summary>'+rows+'</details><div class="fld"><label>Дополнительные требования — по одному в строке</label><textarea data-workflow-custom maxlength="12000" rows="6"></textarea></div><label><input type="checkbox" data-workflow-passport-confirm> Я сверил требования с заданием, методичкой и принятыми файлами</label><button type="button" class="btn" data-workflow-action="passport-create" data-request-id="'+id+'">Сохранить новую версию</button>');
    busy=false;return;
   }else if(action==='passport-create'){
    var modal=button.closest('.sheet')||button.parentElement;if(!modal.querySelector('[data-workflow-passport-confirm]').checked)throw Error('Подтвердите сверку требований');
    var custom=modal.querySelector('[data-workflow-custom]').value.split(/\n+/).map(function(x){return x.trim();}).filter(Boolean);
    var items=baseRequirements.map(function(r){return {code:r[0],ruleText:r[1],sourceType:'profile',sourceFileId:null,sourceLocation:'Типовой профиль v1.0',sourceExcerpt:null,severity:r[2],scope:'whole_document',verificationMethod:r[3],applicability:'applicable',resolutionNote:null};});
    custom.forEach(function(rule,i){items.push({code:'CUSTOM-'+String(i+1).padStart(2,'0'),ruleText:rule,sourceType:'assignment',sourceFileId:null,sourceLocation:'Задание или методичка',sourceExcerpt:null,severity:'critical',scope:'whole_document',verificationMethod:'manual',applicability:'applicable',resolutionNote:null});});
    var accepted=(viewState.files||[]).filter(function(f){return f.state==='accepted';}).map(function(f){return [f.id,f.sha256,f.purpose,f.version];});
    await command('submit_passport',id,{expectedRevision:viewState.process.revision,profileCode:'financial-course-v1',profileVersion:'1.0',sourceSetHash:await hash(JSON.stringify(accepted)),items:items});
    modal.remove();if(global.toast)global.toast('Паспорт требований сохранён');
   }else if(action==='passport-approve'){
    await command('approve_passport',id,{passportId:button.getAttribute('data-passport-id'),expectedRevision:Number(button.getAttribute('data-revision'))});
    if(global.toast)global.toast('Паспорт требований утверждён');
   }else if(action==='ask'){
    var question=button.closest('.card').querySelector('[data-workflow-question]').value.trim();if(!question)throw Error('Напишите вопрос студенту');
    await command('ask_clarification',id,{question:question,requirementId:null,expectedRevision:viewState.process.revision});
    if(global.toast)global.toast('Уточнение отправлено студенту');
   }else if(action==='document-register'){
    var record=global.item&&global.item(id);if(!record)throw Error('Заявка не найдена в реестре');
    var issues=global.DraftQuality.issues(record.doc||{});if(issues.length)throw Error('Документ не готов: '+issues.join('; '));
    if(!record.doc||record.doc.review!==global.DraftQuality.stamp(record))throw Error('Сначала откройте документ и подтвердите проверку готовности');
    var content=global.StudResults.snapshot(record),blob=global.ResultDocx(content,content.chapters),docxSha=await hash(blob);
    var preparedResult=await command('prepare_result_upload',id,{originalName:('Черновик '+record.topic).replace(/[\\/:*?"<>|]/g,'').slice(0,100)+'.docx',declaredMime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sizeBytes:blob.size});
    await global.Oblako.workflowUpload(preparedResult.path,blob);
    var resultCheck=await command('complete_result_upload',id,{fileId:preparedResult.fileId});if(resultCheck.state!=='accepted')throw Error('Сформированный Word не прошёл серверную проверку');
    await command('create_document_version',id,{expectedRevision:Number(button.getAttribute('data-revision')),passportId:button.getAttribute('data-passport-id'),content:content,contentSha256:await hash(JSON.stringify(content)),docxFileId:preparedResult.fileId,docxSha256:docxSha,exporterVersion:'result-docx-5'});
    if(global.toast)global.toast('Версия Word зарегистрирована для контроля');
   }else if(action==='automatic-checks'){
    await command('run_automatic_checks',id,{documentId:button.getAttribute('data-document-id')});if(global.toast)global.toast('Автоматические проверки выполнены');
   }else if(action==='checks-save'){
    var checks=[];document.querySelectorAll('[data-workflow-check]').forEach(function(el){if(el.value)checks.push({requirementId:el.getAttribute('data-workflow-check'),status:el.value,evaluatorType:'human',evidence:{confirmedInUi:true},comment:(document.querySelector('[data-workflow-comment="'+el.getAttribute('data-workflow-check')+'"]')||{}).value||null,checkerVersion:'executor-ui-1'});});
    if(!checks.length)throw Error('Отметьте хотя бы один критерий');
    await command('record_checks',id,{documentId:button.getAttribute('data-document-id'),checks:checks});if(global.toast)global.toast('Ручная проверка сохранена');
   }else if(action==='document-approve'){
    await command('approve_document',id,{documentId:button.getAttribute('data-document-id'),expectedRevision:Number(button.getAttribute('data-revision'))});if(global.toast)global.toast('Документ готов к передаче');
   }else if(action==='document-deliver'){
    await command('deliver_document',id,{documentId:button.getAttribute('data-document-id'),expectedRevision:Number(button.getAttribute('data-revision'))});if(global.toast)global.toast('Проверенный черновик передан студенту');
   }else if(action==='download'){
    var delivered=await command('download_document',id,{}),downloadBlob=await global.Oblako.workflowDownload(delivered.path);
    if(await hash(downloadBlob)!==delivered.sha256)throw Error('Контрольная сумма файла не совпала');
    var url=URL.createObjectURL(downloadBlob),a=document.createElement('a');a.href=url;a.download=delivered.name||'Черновик.docx';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},10000);
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
