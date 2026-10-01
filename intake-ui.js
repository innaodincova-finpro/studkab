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
 var owner=options.owner(),identity=options.identity(),draft=null,files=[],busy=false,analysisTimer=null,confirmCleanup=null;
  var wrap=options.openModal('<button type="button" class="close" data-x>✕</button><h2>Материалы к заявке</h2>'+
   '<p class="small">Выберите все имеющиеся документы вместе. Не нужно распределять их по пунктам. Сохранённый комплект останется в вашем кабинете после выхода.</p>'+
   '<div class="field"><label for="intakeFiles">Документы Word, PDF или Excel</label><input id="intakeFiles" type="file" multiple accept=".docx,.pdf,.xlsx" disabled></div>'+
   '<p class="hint">До 8 файлов, до 5 МБ каждый. PDF должен содержать читаемый текст. Фотографии и сканы не подходят.</p>'+
   '<p class="hint" role="status" aria-live="polite" data-intake-status>Открываем сохранённые материалы…</p>'+
   '<div data-intake-files></div><div data-intake-analysis aria-live="polite"></div><p class="small">Это черновик материалов. Заявка ещё не отправлена, сведения из документов ещё не проверены.</p>'+
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
   list.querySelectorAll('[data-intake-replace],[data-intake-replace-button]').forEach(function(el){el.disabled=busy||el.hasAttribute('data-intake-waiting');});
   input.disabled=busy||!draft;retry.disabled=busy;wrap.querySelector('[data-intake-read]').disabled=busy;
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
   var box=wrap.querySelector('[data-intake-analysis]'),labels={idle:'Документы ещё не разобраны',disabled:'Материалы сохранены. Автоматический разбор пока не включён исполнителем',queued:'Документы ожидают разбора. Можно закрыть страницу',claimed:'Разбираем документы. Можно закрыть страницу',sent:'Разбираем документы. Можно закрыть страницу',budget:'Разбор остановлен: достигнут разрешённый предел расходов. Материалы сохранены',unknown:'Результат разбора не подтверждён. Автоматического платного повтора не будет; нужна проверка исполнителя',invalid:'Ответ помощника не прошёл проверку источников или полноты блоков. Нужна проверка исполнителя',stale:'Документы изменились. Прежние сведения больше не актуальны'};
   if(a.state!=='done'||!a.result){box.innerHTML='<p class="hint">'+options.esc(labels[a.state]||'Разбор не подтверждён')+'</p>';return;}
   box.innerHTML='';
   if(confirmCleanup)confirmCleanup();
   global.StudIntakeConfirmation.render({box:box,result:a.result,analysisId:a.id,draftId:draft.id,owner:owner,api:options.api,esc:options.esc,same:same}).then(function(cleanup){if(!wrap.isConnected||!same())cleanup();else confirmCleanup=cleanup;});
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
   await refresh();await readSaved();await analysis(true);status.textContent=errors.length?'Часть файлов не передана. Сохранённые файлы доступны; нажмите «Повторить сохранение». '+errors.join(' '):'Материалы сохранены в кабинете. '+(visible(files).some(function(f){return f.read_status!=='ready';})?'Для части документов чтение не подтверждено — смотрите пояснения у файлов. ':'Документы прочитаны; сведения заявки ещё не подтверждены. ')+'Заявка ещё не отправлена.';
  }
  async function run(selected,replaces){
   if(busy)return;if(confirmCleanup){confirmCleanup();confirmCleanup=null;}wrap.querySelector('[data-intake-analysis]').innerHTML='';busy=true;input.disabled=true;retry.disabled=true;wrap.querySelector('[data-intake-read]').disabled=true;
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
   finally{busy=false;if(same()&&wrap.isConnected){input.value='';input.disabled=!draft;retry.disabled=false;wrap.querySelector('[data-intake-read]').disabled=false;list.querySelectorAll('[data-intake-replace],[data-intake-replace-button]').forEach(function(el){el.disabled=el.hasAttribute('data-intake-waiting');});}}
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
  await run([]);
  return wrap;
 }
 global.StudIntake={open:open};
})(window);
