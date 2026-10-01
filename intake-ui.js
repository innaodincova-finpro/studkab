(function(global){
 'use strict';
 var types={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 function database(){return new Promise(function(resolve,reject){
  var r=indexedDB.open('studkab-intake-queue',2);
  r.onupgradeneeded=function(){var store=r.result.objectStoreNames.contains('files')?r.transaction.objectStore('files'):r.result.createObjectStore('files',{keyPath:'key'});if(!store.indexNames.contains('owner'))store.createIndex('owner','owner');};
  r.onsuccess=function(){resolve(r.result);};r.onerror=function(){reject(Error('Не удалось сохранить файлы на устройстве'));};
  r.onblocked=function(){reject(Error('Закройте другую вкладку кабинета и повторите загрузку'));};
 });}
 async function queue(method,value){
  var db=await database();
  try{return await new Promise(function(resolve,reject){
   var tx=db.transaction('files',method==='getAll'?'readonly':'readwrite'),store=tx.objectStore('files');
   var r=method==='getAll'?store.index('owner').getAll(value):store[method](value),result;
   r.onsuccess=function(){result=r.result;};
   tx.oncomplete=function(){resolve(result);};
   tx.onerror=tx.onabort=function(){reject(Error('Файлы не сохранены на устройстве. Проверьте свободное место и повторите выбор'));};
  });}finally{db.close();}
 }
 async function prepare(file,owner,replaces){
  var ext=file.name.toLowerCase().split('.').pop(),type=types[ext];
  if(!type||!file.size||file.size>5242880||file.name.length>180)throw Error(file.name+': выберите DOCX, PDF или XLSX до 5 МБ');
  var bytes=await file.arrayBuffer(),view=new Uint8Array(bytes);
  var valid=ext==='pdf'?new TextDecoder().decode(view.slice(0,5))==='%PDF-':view[0]===80&&view[1]===75&&view[2]===3&&view[3]===4;
  if(!valid)throw Error(file.name+': содержимое не соответствует формату');
  var digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');
  return {key:owner+':'+hash+':'+(replaces||''),owner:owner,fileHash:hash,fileName:file.name,contentType:type,sizeBytes:file.size,bytes:bytes,replacesId:replaces||null};
 }
 function encoded(bytes){var view=new Uint8Array(bytes),parts=[];for(var i=0;i<view.length;i+=16384)parts.push(String.fromCharCode.apply(null,view.subarray(i,i+16384)));return btoa(parts.join(''));}
 function visible(files){var replaced=new Set(files.filter(function(f){return f.state==='saved'&&f.supersedes;}).map(function(f){return f.supersedes;}));return files.filter(function(f){return !replaced.has(f.id);});}
 async function open(options){
  document.querySelectorAll('[data-intake-dialog]').forEach(function(el){el.remove();});
  var readWarnings={archive_limit:'Файл превышает предел распаковки. Разделите документ на части',damaged_archive:'Файл повреждён: сохраните его заново в Word или Excel',damaged_pdf:'PDF повреждён: загрузите исправленную текстовую версию',encrypted_pdf:'PDF защищён паролем: нужна доступная текстовая версия',unsafe_xml:'Файл содержит неподдерживаемые XML-объявления: сохраните его заново',result_limit:'Документ слишком большой для чтения: разделите его на части',time_limit:'Чтение превысило допустимое время: разделите документ на части',pdf_annotations:'Поля или примечания PDF требуют текстовой версии',undecodable_text:'Часть символов не распознана: загрузите Word или исправленную текстовую версию',pdf_image_page:'На странице PDF есть изображение: нужна текстовая версия',pdf_nontext_page:'Содержимое страницы PDF не прочитано: нужна текстовая версия',no_readable_text:'Читаемый текст не найден',word_field_cache:'Поля Word содержат сохранённый результат: требуется проверка',document_comments:'Замечания Word сохранены вместе с текстом',equation_layout:'Формулы Word требуют отдельной проверки',formula_cache_unverified:'Сохранённые результаты формул требуют проверки',formula_result_missing:'В формуле отсутствует сохранённый результат',cell_error:'В ячейке ошибка Excel',external_formula:'Формула с внешними данными не выполнялась',external_link:'Внешняя ссылка не открывалась',shared_formula_reference:'Общая формула: требуется проверка диапазона',non_text_content:'Изображения не прочитаны: нужна текстовая версия',tracked_changes:'Есть исправления Word: нужна согласованная версия',text_box_layout:'Текстовые поля Word требуют текстовой версии',non_cell_content:'Рисунки или примечания Excel не прочитаны',external_or_embedded_parts:'Вложенные или внешние данные не прочитаны',reading_unavailable:'Не удалось завершить чтение. Повторите чтение сохранённого файла'};
 function readingLabel(f){var state=f.read_status||'idle';return {idle:'Ожидает чтения',reading:'Чтение выполняется — откройте материалы позже',ready:'Текст и структура прочитаны',blocked:'Чтение неполное — нужна другая версия документа',failed:'Чтение прервано — можно повторить'}[state]||'Чтение не подтверждено';}
 var owner=options.owner(),identity=options.identity(),draft=null,files=[],busy=false,receiptUnknown=false,analysisTimer=null,confirmCleanup=null;
  var wrap=options.openModal('<button type="button" class="close" data-x>✕</button><h2>Материалы к заявке</h2>'+
   '<p class="small">Выберите все имеющиеся документы вместе. Не нужно распределять их по пунктам. Сохранённый комплект останется в вашем кабинете после выхода.</p>'+
   '<div class="field"><label for="intakeFiles">Документы Word, PDF или Excel</label><input id="intakeFiles" type="file" multiple accept=".docx,.pdf,.xlsx" disabled></div>'+
   '<p class="hint">До 8 файлов, до 5 МБ каждый. PDF должен содержать читаемый текст. Фотографии и сканы не подходят.</p>'+
   '<p class="hint" role="status" aria-live="polite" data-intake-status>Открываем сохранённые материалы…</p>'+
   '<div data-intake-reception hidden><div class="field"><label for="intakeDeadline">Срок готовности</label><input id="intakeDeadline" type="date"></div><div class="field"><label for="intakeDescription">Что подготовить, если это неясно из документов</label><textarea id="intakeDescription" maxlength="500"></textarea></div><p class="hint">После отправки заявка сразу появится в реестре. Помощники изучат документы отдельно.</p><button type="button" class="b b-main" data-intake-receive disabled>Отправить заявку</button></div><div data-intake-files></div><div data-intake-analysis aria-live="polite"></div><p class="small">Это черновик материалов. Заявка ещё не отправлена, сведения из документов ещё не проверены.</p>'+
   '<div class="rowbtns"><button type="button" class="b b-main" data-intake-retry disabled>Повторить сохранение</button><button type="button" class="b b-quiet" data-intake-read>Повторить чтение</button><button type="button" class="b b-quiet" data-x>Закрыть</button></div>');
  wrap.setAttribute('data-intake-dialog','');
  var status=wrap.querySelector('[data-intake-status]'),list=wrap.querySelector('[data-intake-files]'),input=wrap.querySelector('#intakeFiles'),retry=wrap.querySelector('[data-intake-retry]');
  function same(){return options.owner()===owner&&options.identity()===identity;}
  function current(allowClosed){if(!same()||(!allowClosed&&!wrap.isConnected))throw Error('Аккаунт или окно изменились. Откройте материалы заново');}
  async function pending(){return await queue('getAll',owner);}
  async function paint(){
   var queued=await pending();current();
   var shown=visible(files),known=new Set(shown.map(function(f){return f.file_hash;}));
   function row(f,history){var waiting=files.some(function(next){return next.supersedes===f.id&&next.state==='pending';})||queued.some(function(next){return next.replacesId===f.id;});
    return '<div class="item" style="flex-wrap:wrap"><div class="txt"><b>'+options.esc(f.file_name)+'</b><small>'+options.esc(f.state==='saved'?(history?'Предыдущая сохранённая версия':'Сохранён в кабинете'):'Сохранение не подтверждено — повторим загрузку')+'</small>'+(f.state==='saved'?'<small>'+options.esc(readingLabel(f))+'</small>'+((f.read_summary&&f.read_summary.warnings)||[]).slice(0,12).map(function(w){var at=w.source||{},place=at.page?' — страница '+at.page:at.cell?' — '+at.sheet+'!'+at.cell:'';return '<small>'+options.esc((readWarnings[w.code]||'Документ не прочитан полностью: проверьте формат или загрузите другую текстовую версию')+place)+'</small>';}).join(''):'')+'</div>'+
    (f.state==='saved'?'<button type="button" class="mini" data-intake-download="'+options.esc(f.id)+'">Скачать</button>'+(!history?'<button type="button" class="mini" data-intake-replace-button="'+options.esc(f.id)+'"'+(waiting?' data-intake-waiting disabled':'')+'>Заменить</button><input type="file" hidden accept=".docx,.pdf,.xlsx" data-intake-replace="'+options.esc(f.id)+'"'+(waiting?' data-intake-waiting disabled':'')+'>':''):'')+'</div>';}
   var active=new Set(shown.map(function(f){return f.id;})),history=files.filter(function(f){return !active.has(f.id);});
   list.innerHTML=shown.map(function(f){return row(f,false);}).join('')+
    queued.filter(function(f){return !known.has(f.fileHash);}).map(function(f){return '<div class="item"><div class="txt"><b>'+options.esc(f.fileName)+'</b><small>Сохранён на устройстве; ожидает передачи в кабинет</small></div></div>';}).join('')+
    (history.length?'<details><summary>Предыдущие версии: '+history.length+'</summary>'+history.map(function(f){return row(f,true);}).join('')+'</details>':'');
   if(!shown.length&&!queued.length)list.innerHTML='<p class="small">Документы пока не выбраны.</p>';
   list.querySelectorAll('[data-intake-replace],[data-intake-replace-button]').forEach(function(el){el.disabled=busy||receiptUnknown||!!draft&&draft.state==='submitted'||el.hasAttribute('data-intake-waiting');});
   input.disabled=busy||receiptUnknown||!draft||draft.state==='submitted';retry.disabled=busy||receiptUnknown||draft&&draft.state==='submitted';wrap.querySelector('[data-intake-read]').disabled=busy;
   if(draft&&draft.receiptMode){
    wrap.querySelector('[data-intake-reception]').hidden=false;wrap.querySelector('#intakeDeadline').disabled=busy||receiptUnknown||draft.state==='submitted';wrap.querySelector('#intakeDescription').disabled=busy||receiptUnknown||draft.state==='submitted';wrap.querySelector('[data-intake-read]').hidden=true;
    wrap.querySelector('[data-intake-analysis]').hidden=true;
    wrap.querySelector('[data-intake-receive]').disabled=busy||draft.state==='submitted'||queued.length>0||!shown.length||shown.some(function(f){return f.state!=='saved';});
   }
  }
  async function refresh(){var result=await options.api({action:'intake-open'});current();draft=result.draft;files=result.files;await paint();}
  async function readSaved(){
   for(var f of visible(files)){
    current();if(f.state!=='saved'||(f.read_version==='intake-reader-1'&&['ready','blocked'].includes(f.read_status)))continue;
    status.textContent='Материалы сохранены. Читаем '+f.file_name+'…';
    try{await options.api({action:'intake-read',id:draft.id,fileId:f.id});current();}catch(e){if(!same()||!wrap.isConnected)return;status.textContent='Материалы сохранены. Чтение не завершено: '+e.message;}
   }
   await refresh();
  }
  function sourceLabel(r){var at=r.source||{};return (r.fileName||'Примечание студента')+(at.page?' — страница '+at.page:at.cell?' — '+at.sheet+'!'+at.cell:at.table?' — таблица '+at.table+', строка '+at.row+', ячейка '+at.column:at.paragraph?' — абзац '+at.paragraph:'');}
  function paintAnalysis(a){
   var box=wrap.querySelector('[data-intake-analysis]'),labels={idle:'Документы ещё не разобраны',disabled:'Материалы сохранены. Автоматический разбор пока не включён исполнителем',queued:'Документы ожидают разбора. Можно закрыть страницу',claimed:'Разбираем документы. Можно закрыть страницу',sent:'Разбираем документы. Можно закрыть страницу',budget:'Разбор остановлен: достигнут разрешённый предел расходов. Материалы сохранены',output_limited:'Ответ помощника не завершён: достигнут предел ответа. Материалы сохранены; автоматического платного повтора не будет',unknown:'Результат разбора не подтверждён. Автоматического платного повтора не будет; нужна проверка исполнителя',invalid:'Ответ помощника не прошёл проверку источников или полноты блоков. Нужна проверка исполнителя',stale:'Документы изменились. Прежние сведения больше не актуальны'};
   if(a.state!=='done'||!a.result){box.innerHTML='<p class="hint">'+options.esc(labels[a.state]||'Разбор не подтверждён')+'</p>';return;}
   box.innerHTML='';
   if(confirmCleanup)confirmCleanup();
   global.StudIntakeConfirmation.render({box:box,result:a.result,analysisId:a.id,draftId:draft.id,owner:owner,api:options.api,esc:options.esc,same:same,
    beforeSubmit:async function(){current();if(busy||(await pending()).length)throw Error('Сначала завершите сохранение выбранных файлов');busy=true;input.disabled=true;retry.disabled=true;wrap.querySelector('[data-intake-read]').disabled=true;list.querySelectorAll('[data-intake-replace],[data-intake-replace-button]').forEach(function(el){el.disabled=true;});},
    afterSubmit:function(){if(draft.state!=='submitted'&&same()&&wrap.isConnected){busy=false;paint();}},
    submitted:function(s){current();input.disabled=true;retry.disabled=true;wrap.querySelector('[data-intake-read]').disabled=true;list.querySelectorAll('[data-intake-replace],[data-intake-replace-button]').forEach(function(el){el.disabled=true;});status.textContent='Заявка №'+s.number+' отправлена. Комплект сохранён.';draft.state='submitted';if(options.submitted)options.submitted(s);}
   }).then(function(cleanup){if(!wrap.isConnected||!same())cleanup();else confirmCleanup=cleanup;});
  }

  async function analysis(start){
   clearTimeout(analysisTimer);current();
   if(!draft||!visible(files).length||visible(files).some(function(f){return f.state!=='saved'||f.read_status!=='ready';})||(await pending()).length){paintAnalysis({state:visible(files).length?'stale':'idle'});return;}
   try{
    var started=start?await options.api({action:'intake-analyze',id:draft.id}):null;current();
    var response=await options.api({action:'intake-analysis-state',id:draft.id});current();
    // A disabled start has no queued job; display that reason, not an empty result.
    var a=response.analysis;
    if(started&&started.analysis.state==='disabled')a=started.analysis;
    paintAnalysis(a);
   if(['queued','claimed','sent','budget'].includes(a.state))analysisTimer=setTimeout(function(){if(same()&&wrap.isConnected)analysis(false);},10000);
   }catch(e){if(same()&&wrap.isConnected)wrap.querySelector('[data-intake-analysis]').textContent='Не удалось получить разбор: '+e.message+'. Сохранённые документы доступны.';}
  }
  async function transmit(){
   var queued=await pending(),errors=[];current();
   for(var f of queued){
    current();status.textContent='Сохраняем '+f.fileName+'…';
    try{
     await options.api({action:'intake-upload',id:draft.id,fileName:f.fileName,contentType:f.contentType,sizeBytes:f.sizeBytes,fileHash:f.fileHash,base64:encoded(f.bytes),replacesId:f.replacesId});
     if(!same())return;await queue('delete',f.key);current();
    }catch(e){if(!same()||!wrap.isConnected)return;errors.push(f.fileName+': '+e.message);}
   }
   await refresh();if(draft.receiptMode){status.textContent=errors.length?'Часть файлов не передана. Повторите сохранение. '+errors.join(' '):'Материалы сохранены. Укажите срок и отправьте заявку; изучение начнётся после регистрации.';return;}await readSaved();await analysis(true);status.textContent=errors.length?'Часть файлов не передана. Сохранённые файлы доступны; нажмите «Повторить сохранение». '+errors.join(' '):'Материалы сохранены в кабинете. '+(visible(files).some(function(f){return f.read_status!=='ready';})?'Для части документов чтение не подтверждено — смотрите пояснения у файлов. ':(draft.receiptMode?'Изучение начнётся после регистрации заявки. ':'Документы прочитаны; сведения заявки ещё не подтверждены. '))+'Заявка ещё не отправлена.';
  }
  async function run(selected,replaces){
   if(busy||receiptUnknown||draft&&draft.state==='submitted')return;if(confirmCleanup){confirmCleanup();confirmCleanup=null;}wrap.querySelector('[data-intake-analysis]').innerHTML='';busy=true;input.disabled=true;retry.disabled=true;wrap.querySelector('[data-intake-read]').disabled=true;
   try{
    current();
    if(!draft)await refresh();
    var errors=[];
    for(var file of selected||[]){
     try{var prepared=await prepare(file,owner,replaces);current(true);
      if(replaces&&files.some(function(f){return f.file_hash===prepared.fileHash;}))throw Error(file.name+': эта версия уже сохранена');
      var queued=await pending();current(true);
      var hashes=new Set(visible(files).filter(function(f){return !f.supersedes||f.state==='saved';}).map(function(f){return f.file_hash;}));
      queued.filter(function(f){return !f.replacesId;}).forEach(function(f){hashes.add(f.fileHash);});
      if(!replaces&&!hashes.has(prepared.fileHash)&&hashes.size>=8)throw Error('Можно сохранить до 8 файлов');
      await queue('put',prepared);current(true);
     }catch(e){errors.push(e.message);}
    }
    await paint();await transmit();
    if(errors.length)status.textContent+=' Не добавлены: '+errors.join(' ');
   }catch(e){if(same()&&wrap.isConnected)status.textContent='Сохранение не завершено: '+e.message;}
   finally{busy=false;if(same()&&wrap.isConnected){input.value='';input.disabled=!draft||draft.state==='submitted';retry.disabled=!!draft&&draft.state==='submitted';wrap.querySelector('[data-intake-read]').disabled=false;list.querySelectorAll('[data-intake-replace],[data-intake-replace-button]').forEach(function(el){el.disabled=!!draft&&draft.state==='submitted'||el.hasAttribute('data-intake-waiting');});if(draft&&draft.receiptMode)await paint();}}
  }
  input.addEventListener('change',function(){run(Array.from(input.files));});
  wrap.addEventListener('change',function(e){if(e.target.matches('[data-intake-replace]'))run(Array.from(e.target.files),e.target.getAttribute('data-intake-replace'));});
  retry.addEventListener('click',function(){run([]);});
  wrap.querySelector('[data-intake-read]').addEventListener('click',function(){run([]);});
  wrap.addEventListener('click',async function(e){var replacement=e.target.closest('[data-intake-replace-button]');if(replacement&&!busy){wrap.querySelector('[data-intake-replace="'+replacement.getAttribute('data-intake-replace-button')+'"]').click();return;}
   var button=e.target.closest('[data-intake-download]');if(!button||busy)return;
   button.disabled=true;try{current();var result=await options.api({action:'intake-download',id:draft.id,fileId:button.getAttribute('data-intake-download')});current();
    var url=new URL(result.url);if(url.origin!==new URL(global.OBLAKO_CONFIG.url).origin)throw Error('Не удалось подтвердить ссылку');
    var link=document.createElement('a');link.href=url.href;link.download=result.fileName;link.rel='noopener';link.click();
   }catch(e){if(same()&&wrap.isConnected)status.textContent=e.message;}finally{button.disabled=false;}
  });
  wrap.addEventListener('click',function(e){if(e.target.closest('[data-x]')){clearTimeout(analysisTimer);if(confirmCleanup)confirmCleanup();}});
  function receiptInputs(){return {deadline:wrap.querySelector('#intakeDeadline').value,description:wrap.querySelector('#intakeDescription').value};}
  var receiptKey='studkab-intake-reception:'+owner;
  try{var savedReceipt=JSON.parse(localStorage.getItem(receiptKey)||'null');if(savedReceipt){wrap.querySelector('#intakeDeadline').value=savedReceipt.deadline||'';wrap.querySelector('#intakeDescription').value=savedReceipt.description||'';}}catch(_){}
  wrap.querySelector('[data-intake-reception]').addEventListener('input',function(){if(same())localStorage.setItem(receiptKey,JSON.stringify(receiptInputs()));});
  function acceptReceipt(receipt){
   if(!receipt||!receipt.submitted||!receipt.ready||!receipt.payload)throw Error('Приём заявки не подтверждён');
   receiptUnknown=false;draft.state='submitted';wrap.querySelector('#intakeDeadline').value=receipt.payload.dl;wrap.querySelector('#intakeDescription').value=receipt.payload.rq;
   status.textContent='Заявка №'+receipt.number+' принята. Документы сохранены; комплект ожидает изучения.';
   if(options.submitted)options.submitted(receipt);
  }
  wrap.querySelector('[data-intake-receive]').addEventListener('click',async function(){
   if(busy||!draft||!draft.receiptMode||draft.state==='submitted')return;
   busy=true;
   try{
    current();await paint();if((await pending()).length)throw Error('Сначала завершите сохранение выбранных документов');
    var values=receiptInputs();
    if(!values.deadline||Number.isNaN(Date.parse(values.deadline))||new Date(values.deadline).toISOString().slice(0,10)!==values.deadline)throw Error('Укажите срок готовности');
    localStorage.setItem('studkab-intake-submit:'+owner,JSON.stringify({draftId:draft.id,receiptMode:true}));
    receiptUnknown=true;var result=await options.api({action:'intake-receive',id:draft.id,revision:draft.revision,deadline:values.deadline,description:values.description});current();
    acceptReceipt(result.submission);
   }catch(e){
    if(!same()||!wrap.isConnected)return;
    if(receiptUnknown){
     try{var recovered=(await options.api({action:'intake-receive-state',id:draft.id})).submission;current();if(recovered&&recovered.submitted){acceptReceipt(recovered);return;}receiptUnknown=false;}
     catch(_){if(!same()||!wrap.isConnected)return;}
    }
    status.textContent='Отправка не подтверждена: '+e.message+'. Сохранённые материалы доступны; повтор не создаёт новую заявку.';
   }
   finally{busy=false;if(same()&&wrap.isConnected)await paint();}
  });
  var intent;try{intent=JSON.parse(localStorage.getItem('studkab-intake-submit:'+owner)||'null');}catch(_){}
  if(intent&&intent.draftId)try{
   var previous=(await options.api({action:intent.receiptMode?'intake-receive-state':'intake-submission-state',id:intent.draftId})).submission;current();
   if(previous&&previous.submitted){
    if(options.submitted)options.submitted(previous);status.textContent='Заявка №'+previous.number+' уже отправлена. Весь комплект сохранён.';
    input.disabled=true;retry.disabled=true;wrap.querySelector('[data-intake-read]').disabled=true;
    var next=document.createElement('button');next.type='button';next.className='b b-main';next.textContent='Новая заявка';next.onclick=function(){localStorage.removeItem('studkab-intake-submit:'+owner);localStorage.removeItem(receiptKey);wrap.querySelector('#intakeDeadline').value='';wrap.querySelector('#intakeDescription').value='';next.remove();run([]);};list.appendChild(next);return wrap;
   }
  }catch(e){if(!same())return wrap;status.textContent='Проверка прежней отправки не завершена: '+e.message+'. Повтор не создаёт новую заявку.';}
  await run([]);
  return wrap;
 }
 global.StudIntake={open:open};
})(window);
