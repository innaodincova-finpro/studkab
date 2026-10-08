// ROUTE-03, R3-A: окно «Отправьте задание» в кабинете студента.
// Студент прикладывает файлы любого допустимого вида (Word, PDF, Excel, фото) и/или ссылку
// на папку в облаке, заполняет сведения для титульного листа, срок и пожелания.
// Программа файлы не читает: заявка регистрируется сразу, материалы открывает исполнитель.
(function(global){
 'use strict';
 var LIMIT=20;
 var KINDS=['Практические задания','Лабораторная работа','Контрольная работа','Реферат','Эссе','Курсовая работа','Отчёт по практике','Выпускная квалификационная работа','Другое'];
 var FORMS=['Очная','Очно-заочная','Заочная'];
 var DETAILS=[
  ['k','Вид работы',true,'select',KINDS],['d','Дисциплина',true,'text',null,200],
  ['u','Вуз',true,'text',null,300,true],['kf','Кафедра',false,'text',null,300],
  ['pr','Направление подготовки',false,'text',null,200],['fo','Форма обучения',true,'select',FORMS],
  ['g','Курс и группа',true,'text',null,100],['n','Фамилия, имя, отчество',true,'text',null,200],
  ['s','Преподаватель',false,'text',null,200]
 ];
 var LINK=/^https:\/\/(disk\.yandex\.(ru|com|by|kz)|yadi\.sk|disk\.360\.yandex\.ru|drive\.google\.com|docs\.google\.com|cloud\.mail\.ru)\/[^\s<>"]+$/;
 var CSS='.r3f .sheet-in{max-width:760px}'+
  '.r3f h2{margin:0 0 6px}.r3f .lead{font-size:14px;color:var(--ink,#22303F);margin:0 0 4px}'+
  '.r3f .grp{border:1px solid var(--line,#DCE6EE);border-radius:16px;padding:14px 14px 6px;margin:14px 0 0;background:#FCFDFE}'+
  '.r3f .grp h3{font-family:inherit;font-size:15px;margin:0 0 10px;font-weight:600;letter-spacing:0}.r3f .grp h3 small{font-weight:400;color:var(--mut,#6B7F92);font-size:13px;margin-left:6px}'+
  '.r3f .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}.r3f .wide{grid-column:1/-1}'+
  '.r3f .field label{font-size:13px;font-weight:600;color:var(--ink,#22303F)}.r3f .req{color:#8F6A3A;margin-left:2px}'+
  '.r3f input[type=text],.r3f input[type=url],.r3f input[type=date],.r3f select,.r3f textarea{width:100%;box-sizing:border-box}'+
  '.r3f .or{display:flex;align-items:center;gap:10px;color:var(--mut,#6B7F92);font-size:13px;margin:6px 0 10px}.r3f .or:before,.r3f .or:after{content:"";flex:1;border-top:1px solid var(--line,#DCE6EE)}'+
  '.r3f .addf{display:flex;justify-content:center;align-items:center;gap:8px;cursor:pointer;color:var(--accent,#2F6091);font-weight:600;font-size:15px;padding:12px 16px;border:1.5px dashed var(--accent,#2F6091);border-radius:12px;background:#F5F9FC}'+
  '.r3f .addf input{position:absolute;width:1px;height:1px;opacity:0}'+
  '.r3f .rowbtns .send{flex:0 0 auto;padding:13px 26px}@media(max-width:640px){.r3f .rowbtns .send{flex:1 1 auto}}.r3f .send{background:linear-gradient(120deg,#B08347,#D2A46A);box-shadow:0 8px 20px -8px rgba(176,131,71,.65)}'+
  '.r3f .next{border-top:1px solid var(--line,#DCE6EE);margin-top:16px;padding-top:12px}'+
  '.r3f .next b{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut,#6B7F92);margin-bottom:4px}'+
  '@media(max-width:640px){.r3f .grid{grid-template-columns:1fr}}';
 function style(){if(!document.querySelector('style[data-r3-form]')){var s=document.createElement('style');s.setAttribute('data-r3-form','');s.textContent=CSS;document.head.appendChild(s);}}
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
  var f=await global.StudFilePrep.prepare(file);
  var digest=await crypto.subtle.digest('SHA-256',f.bytes),hash=Array.from(new Uint8Array(digest)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');
  return {key:owner+':'+hash+':'+(replaces||''),owner:owner,fileHash:hash,fileName:f.name,contentType:f.type,sizeBytes:f.size,bytes:f.bytes,replacesId:replaces||null};
 }
 function encoded(bytes){var view=new Uint8Array(bytes),parts=[];for(var i=0;i<view.length;i+=16384)parts.push(String.fromCharCode.apply(null,view.subarray(i,i+16384)));return btoa(parts.join(''));}
 function visible(files){var replaced=new Set(files.filter(function(f){return f.state==='saved'&&f.supersedes;}).map(function(f){return f.supersedes;}));return files.filter(function(f){return !replaced.has(f.id);});}
 function kindLabel(type){return /^image\//.test(type||'')?'фото':/pdf/.test(type||'')?'PDF':/spreadsheet/.test(type||'')?'Excel':'Word';}
 function fieldHtml(d,esc){
  var id='intakeDetail-'+d[0],label='<label for="'+id+'">'+esc(d[1])+(d[2]?'<span class="req">*</span>':'')+'</label>',input;
  if(d[3]==='select')input='<select id="'+id+'" data-intake-detail="'+d[0]+'"><option value="">Выберите</option>'+d[4].map(function(v){return '<option>'+esc(v)+'</option>';}).join('')+'</select>';
  else input='<input type="text" id="'+id+'" data-intake-detail="'+d[0]+'" maxlength="'+d[5]+'"'+(d[0]==='s'?' placeholder="если известен"':'')+'>';
  return '<div class="field'+(d[6]?' wide':'')+'">'+label+input+'</div>';
 }
 async function open(options){
  document.querySelectorAll('[data-intake-dialog]').forEach(function(el){el.remove();});
  style();
  var esc=options.esc,owner=options.owner(),identity=options.identity(),draft=null,files=[],busy=false,receiptUnknown=false,acceptedReceipt=null;
  var wrap=options.openModal('<button type="button" class="close" data-x>✕</button><h2>Отправьте задание</h2>'+
   '<p class="lead">Приложите задание от преподавателя и заполните сведения для титульного листа. Звёздочкой отмечено обязательное.</p>'+
   '<p class="hint" role="status" aria-live="polite" data-intake-status>Открываем сохранённые материалы…</p>'+
   '<button type="button" class="b b-main" data-intake-check hidden style="display:none">Проверить отправку</button>'+
   '<section class="grp"><h3>Задание от преподавателя<small>файлы или ссылка — как удобнее</small></h3>'+
    '<div data-intake-files></div>'+
    '<label class="addf">+ Добавить файлы<input id="intakeFiles" type="file" multiple accept="'+global.StudFilePrep.ACCEPT+'" disabled></label>'+
    '<p class="hint">Word, PDF, Excel, фото и снимки экрана · до '+LIMIT+' файлов, каждый до 5 МБ. Крупные фото уменьшаются автоматически.</p>'+
    '<button type="button" class="b b-quiet b-sm" data-intake-retry hidden style="display:none">Повторить сохранение</button>'+
    '<div class="or">или</div>'+
    '<div class="field"><label for="intakeLink">Ссылка на папку в облаке</label><input type="url" id="intakeLink" maxlength="500" placeholder="https://disk.yandex.ru/d/…" inputmode="url" autocomplete="off"></div>'+
    '<p class="hint" role="status" aria-live="polite" data-intake-link-status>Яндекс Диск, Google Диск или Облако Mail.ru. Откройте доступ по ссылке для всех, иначе файлы не будут видны.</p>'+
   '</section>'+
   '<section class="grp"><h3>Для титульного листа</h3><div class="grid">'+DETAILS.map(function(d){return fieldHtml(d,esc);}).join('')+'</div></section>'+
   '<div class="grid" style="margin-top:14px"><div class="field"><label for="intakeDeadline">Когда нужна работа<span class="req">*</span></label><input id="intakeDeadline" type="date"></div>'+
   '<div class="field"><label for="intakeDescription">Пожелания — если нужно</label><textarea id="intakeDescription" maxlength="500" placeholder="Например: «Решить любые 2 задания из каждого практического»"></textarea></div></div>'+
   '<div class="rowbtns"><button type="button" class="b send" data-intake-receive disabled>Отправить задание</button></div>'+
   '<section class="grp" data-intake-receipt hidden style="display:none"><h3 data-intake-receipt-title></h3><button type="button" class="b b-main" data-intake-open-receipt hidden style="display:none"></button></section>'+
   '<p class="hint">Заполненное сохраняется на этом устройстве — можно вернуться позже.</p>'+
   '<div class="next"><b>Что будет дальше</b><span class="hint">Заявке присвоят номер. Исполнитель откроет материалы и, если чего-то не хватает, спросит здесь.</span></div>');
  wrap.setAttribute('data-intake-dialog','');wrap.classList.add('r3f');
  var status=wrap.querySelector('[data-intake-status]'),list=wrap.querySelector('[data-intake-files]'),input=wrap.querySelector('#intakeFiles'),retry=wrap.querySelector('[data-intake-retry]'),send=wrap.querySelector('[data-intake-receive]');
  var formInputs=function(){return Array.from(wrap.querySelectorAll('[data-intake-detail],#intakeLink,#intakeDeadline,#intakeDescription'));};
  var receiptCheck=wrap.querySelector('[data-intake-check]');
  var receiptPanel=wrap.querySelector('[data-intake-receipt]'),receiptOpen=wrap.querySelector('[data-intake-open-receipt]');
  receiptOpen.addEventListener('click',function(){
   if(!acceptedReceipt||!same()||!wrap.isConnected||typeof options.openReceipt!=='function')return;
   options.openReceipt(acceptedReceipt);wrap.remove();
  });
  function same(){return options.owner()===owner&&options.identity()===identity;}
  function current(allowClosed){if(!same()||(!allowClosed&&!wrap.isConnected))throw Error('Аккаунт или окно изменились. Откройте материалы заново');}
  async function pending(){return await queue('getAll',owner);}
  function submitted(){return !!draft&&draft.state==='submitted';}
  async function paint(){
   var queued=await pending();current();
   var shown=visible(files),known=new Set(shown.map(function(f){return f.file_hash;}));
   function row(f,history){var waiting=files.some(function(next){return next.supersedes===f.id&&next.state==='pending';})||queued.some(function(next){return next.replacesId===f.id;});
    return '<div class="item" style="flex-wrap:wrap"><div class="txt"><b>'+esc(f.file_name)+'</b><small>'+esc((f.state==='saved'?(history?'Предыдущая версия':'Сохранён'):'Сохранение не подтверждено — повторим загрузку')+(f.content_type?' · '+kindLabel(f.content_type):''))+'</small></div>'+
    (f.state==='saved'?'<button type="button" class="mini" data-intake-download="'+esc(f.id)+'">Скачать</button>'+(!history?'<button type="button" class="mini" data-intake-replace-button="'+esc(f.id)+'"'+(waiting?' data-intake-waiting disabled':'')+'>Заменить</button><input type="file" hidden accept="'+global.StudFilePrep.ACCEPT+'" data-intake-replace="'+esc(f.id)+'"'+(waiting?' data-intake-waiting disabled':'')+'>':''):'')+'</div>';}
   var active=new Set(shown.map(function(f){return f.id;})),history=files.filter(function(f){return !active.has(f.id);});
   list.innerHTML=shown.map(function(f){return row(f,false);}).join('')+
    queued.filter(function(f){return !known.has(f.fileHash);}).map(function(f){return '<div class="item"><div class="txt"><b>'+esc(f.fileName)+'</b><small>Сохранён на устройстве; ожидает передачи в кабинет</small></div></div>';}).join('')+
    (history.length?'<details><summary>Предыдущие версии: '+history.length+'</summary>'+history.map(function(f){return row(f,true);}).join('')+'</details>':'');
   var locked=busy||receiptUnknown||submitted();
   list.querySelectorAll('[data-intake-replace],[data-intake-replace-button]').forEach(function(el){el.disabled=locked||el.hasAttribute('data-intake-waiting');});
   input.disabled=locked||!draft;
   retry.hidden=!queued.length||submitted();retry.style.display=retry.hidden?'none':'';retry.disabled=locked;
   formInputs().forEach(function(el){el.disabled=receiptUnknown||submitted();});
   send.disabled=locked||queued.length>0||shown.some(function(f){return f.state!=='saved';});
   receiptCheck.hidden=!receiptUnknown;receiptCheck.style.display=receiptUnknown?'':'none';receiptCheck.disabled=busy;
  }
  async function refresh(){var result=await options.api({action:'intake-open'});current();draft=result.draft;files=result.files;await paint();}
  async function transmit(){
   var queued=await pending(),errors=[];current();
   for(var f of queued){
    current();status.textContent='Сохраняем '+f.fileName+'…';
    try{
     await options.api({action:'intake-upload',id:draft.id,fileName:f.fileName,contentType:f.contentType,sizeBytes:f.sizeBytes,fileHash:f.fileHash,base64:encoded(f.bytes),replacesId:f.replacesId});
     if(!same())return;await queue('delete',f.key);current();
    }catch(e){if(!same()||!wrap.isConnected)return;errors.push(f.fileName+': '+e.message);}
   }
   await refresh();
   var count=visible(files).length;
   status.textContent=errors.length?'Часть файлов не передана. Нажмите «Повторить сохранение». '+errors.join(' '):count?'Материалы сохранены: '+count+'. Заполните сведения и отправьте задание.':'Приложите файлы задания или ссылку на папку в облаке.';
  }
  async function run(selected,replaces){
   if(busy||receiptUnknown||submitted())return;
   busy=true;input.disabled=true;retry.disabled=true;
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
      if(!replaces&&!hashes.has(prepared.fileHash)&&hashes.size>=LIMIT)throw Error('Можно сохранить до '+LIMIT+' файлов');
      await queue('put',prepared);current(true);
     }catch(e){errors.push(e.message);}
    }
    await paint();await transmit();
    if(errors.length)status.textContent+=' Не добавлены: '+errors.join(' ');
   }catch(e){if(same()&&wrap.isConnected)status.textContent='Сохранение не завершено: '+e.message;}
   finally{busy=false;if(same()&&wrap.isConnected){input.value='';try{await paint();}catch(_){}}}
  }
  input.addEventListener('change',function(){run(Array.from(input.files));});
  wrap.addEventListener('change',function(e){if(e.target.matches('[data-intake-replace]'))run(Array.from(e.target.files),e.target.getAttribute('data-intake-replace'));});
  retry.addEventListener('click',function(){run([]);});
  wrap.addEventListener('click',async function(e){var replacement=e.target.closest('[data-intake-replace-button]');if(replacement&&!busy){wrap.querySelector('[data-intake-replace="'+replacement.getAttribute('data-intake-replace-button')+'"]').click();return;}
   var button=e.target.closest('[data-intake-download]');if(!button||busy)return;
   button.disabled=true;try{current();var result=await options.api({action:'intake-download',id:draft.id,fileId:button.getAttribute('data-intake-download')});current();
    var url=new URL(result.url);if(url.origin!==new URL(global.OBLAKO_CONFIG.url).origin)throw Error('Не удалось подтвердить ссылку');
    var link=document.createElement('a');link.href=url.href;link.download=result.fileName;link.rel='noopener';link.click();
   }catch(e){if(same()&&wrap.isConnected)status.textContent=e.message;}finally{button.disabled=false;}
  });
  function values(){
   var details={};wrap.querySelectorAll('[data-intake-detail]').forEach(function(el){details[el.getAttribute('data-intake-detail')]=el.value.trim();});
   return {details:details,link:wrap.querySelector('#intakeLink').value.trim(),deadline:wrap.querySelector('#intakeDeadline').value,description:wrap.querySelector('#intakeDescription').value};
  }
  function fill(v){
   if(!v)return;
   Object.keys(v.details||{}).forEach(function(k){var el=wrap.querySelector('[data-intake-detail="'+k+'"]');if(el)el.value=v.details[k]||'';});
   wrap.querySelector('#intakeLink').value=v.link||'';wrap.querySelector('#intakeDeadline').value=v.deadline||'';wrap.querySelector('#intakeDescription').value=v.description||'';
  }
  var receiptKey='studkab-intake-reception:'+owner;
  try{fill(JSON.parse(localStorage.getItem(receiptKey)||'null'));}catch(_){}
  // Сведения из профиля студента подставляются в пустые поля, чтобы не вводить одно и то же дважды.
  try{var pre=typeof options.profile==='function'?options.profile():null;
   if(pre)Object.keys(pre).forEach(function(k){var el=wrap.querySelector('[data-intake-detail="'+k+'"]');if(!el||el.value||!pre[k])return;
    if(el.tagName==='SELECT'&&![].some.call(el.options,function(o){return o.value===pre[k];}))return;el.value=pre[k];});
  }catch(_){}
  wrap.addEventListener('input',function(e){if(same()&&e.target.closest('[data-intake-detail],#intakeLink,#intakeDeadline,#intakeDescription'))try{localStorage.setItem(receiptKey,JSON.stringify(values()));}catch(_){}});
  wrap.addEventListener('change',function(e){if(same()&&e.target.matches('select[data-intake-detail]'))try{localStorage.setItem(receiptKey,JSON.stringify(values()));}catch(_){}});
  // R3-B: проверка ссылки и копия файлов папки Яндекс Диска в заявку (по одному файлу).
  var copying=false,linkState={link:'',state:''},linkBox=wrap.querySelector('[data-intake-link-status]'),linkRun=0;
  function linkSay(text){linkBox.textContent=text;}
  async function checkLink(){
   var link=wrap.querySelector('#intakeLink').value.trim(),run=++linkRun;
   if(!link){linkState={link:'',state:''};linkSay('Яндекс Диск, Google Диск, Облако Mail.ru. Доступ — «всем, у кого есть ссылка». С Яндекс Диска файлы копируются в заявку.');return;}
   if(!LINK.test(link)){linkState={link:link,state:'invalid'};linkSay('Ссылка должна начинаться с https:// и вести на Яндекс Диск, Google Диск или Облако Mail.ru');return;}
   if(!draft||submitted())return;
   linkSay('Проверяем ссылку…');
   var r;try{r=(await options.api({action:'intake-link-check',id:draft.id,link:link})).link;current();}catch(e){if(!same()||!wrap.isConnected)return;r={state:'unknown'};}
   if(run!==linkRun)return;
   linkState={link:link,state:r.state};
   if(r.state==='closed'){linkSay('Ссылка закрыта: откройте доступ «всем, у кого есть ссылка» и вставьте ссылку снова.');return;}
   if(r.state==='missing'){linkSay('Папка по ссылке не найдена — проверьте ссылку.');return;}
   if(r.state!=='open'){linkSay('Не удалось проверить ссылку. Её можно отправить — исполнитель откроет папку сам.');return;}
   if(r.service!=='yandex'){linkSay('✓ Открывается. С этого облака копию сделать нельзя — не удаляйте файлы до сдачи работы.');return;}
   var list=r.files||[],done=0,skipped=[];copying=true;
   try{for(var i=0;i<list.length;i++){
    if(run!==linkRun||!wrap.isConnected)return;
    if(visible(files).length>=LIMIT){skipped.push('остальные файлы — предел '+LIMIT+' файлов');break;}
    linkSay('✓ Открывается · файлов: '+list.length+'. Копируем в заявку: '+(i+1)+' из '+list.length+'…');
    try{await options.api({action:'intake-link-copy',id:draft.id,link:link,path:list[i].path});current();done++;await refresh();}
    catch(e){if(!same()||!wrap.isConnected)return;skipped.push(e.message);}
   }}finally{copying=false;}
   if(run!==linkRun)return;
   linkSay('✓ Открывается · скопировано в заявку: '+done+' из '+list.length+'.'+(skipped.length?' Не скопированы: '+skipped.join('; ')+'.':'')+(r.folders?' Вложенные папки исполнитель откроет по ссылке.':'')+(r.more?' В папке больше 100 файлов — остальные исполнитель откроет по ссылке.':''));
  }
  wrap.querySelector('#intakeLink').addEventListener('change',function(){checkLink();});
  function check(v){
   var missing=DETAILS.filter(function(d){return d[2]&&!v.details[d[0]];}).map(function(d){return d[1].toLowerCase();});
   if(!visible(files).length&&!v.link)return 'Приложите файлы задания или ссылку на папку в облаке';
   if(v.link&&!LINK.test(v.link))return 'Ссылка должна начинаться с https:// и вести на Яндекс Диск, Google Диск или Облако Mail.ru';
   if(v.link&&linkState.link===v.link&&linkState.state==='closed')return 'Ссылка закрыта: откройте доступ «всем, у кого есть ссылка»';
   if(v.link&&linkState.link===v.link&&linkState.state==='missing')return 'Папка по ссылке не найдена — проверьте ссылку';
   if(missing.length)return 'Заполните: '+missing.join(', ');
   if(!v.deadline||Number.isNaN(Date.parse(v.deadline))||new Date(v.deadline).toISOString().slice(0,10)!==v.deadline)return 'Укажите, когда нужна работа';
   return '';
  }
  function acceptReceipt(receipt){
   if(!receipt||!receipt.submitted||!receipt.ready||!receipt.payload)throw Error('Приём заявки не подтверждён');
   if(options.submitted)options.submitted(receipt);
   acceptedReceipt=receipt;
   receiptUnknown=false;draft.state='submitted';
   status.textContent='Заявка №'+receipt.number+' отправлена. Исполнитель откроет материалы и, если чего-то не хватает, спросит здесь.';
   try{localStorage.removeItem(receiptKey);}catch(_){}
   receiptPanel.hidden=false;receiptPanel.style.display='';
   wrap.querySelector('[data-intake-receipt-title]').textContent='Заявка № '+receipt.number+' отправлена';
   receiptOpen.hidden=typeof options.openReceipt!=='function';receiptOpen.style.display=receiptOpen.hidden?'none':'';
   receiptOpen.textContent='Открыть заявку № '+receipt.number;
   receiptPanel.scrollIntoView({block:'nearest'});
  }
  send.addEventListener('click',async function(){
   if(busy||receiptUnknown||!draft||submitted())return;
   // Проверка заполнения — до блокировки кнопки: подсказка появляется сразу, кнопка остаётся доступной.
   var v=values(),problem=copying?'Дождитесь окончания копирования файлов из папки':check(v);
   if(problem){status.textContent=problem;return;}
   busy=true;send.disabled=true;send.textContent='Отправляем задание…';status.textContent='Отправляем задание…';
   try{
    current();if((await pending()).length)throw Error('Сначала завершите сохранение выбранных файлов');
    localStorage.setItem('studkab-intake-submit:'+owner,JSON.stringify({draftId:draft.id,receiptMode:true}));
    receiptUnknown=true;var result=await options.api({action:'intake-receive',id:draft.id,revision:draft.revision,deadline:v.deadline,description:v.description,details:v.details,link:v.link});current();
    // Отправленные сведения запоминаются в профиле: в следующей заявке они подставятся сами.
    if(typeof options.remember==='function')try{options.remember(v.details);}catch(_){}
    acceptReceipt(result.submission);
   }catch(e){
    if(!same()||!wrap.isConnected)return;
    if(receiptUnknown){
     try{var recovered=(await options.api({action:'intake-receive-state',id:draft.id})).submission;current();if(recovered&&recovered.submitted){acceptReceipt(recovered);return;}if(!recovered||typeof recovered.canReceive!=='boolean')throw Error('Результат отправки не подтверждён');receiptUnknown=false;}
     catch(_){if(!same()||!wrap.isConnected)return;}
    }
    status.textContent=receiptUnknown?'Не удалось подтвердить отправку. Заявка могла быть получена. Проверьте отправку, чтобы узнать результат.':'Задание не отправлено: '+e.message+'. Заполненное и файлы сохранены; повтор не создаёт новую заявку.';
   }
   finally{busy=false;if(same()&&wrap.isConnected){send.textContent='Отправить задание';await paint();}}
  });
  receiptCheck.addEventListener('click',async function(){
   if(busy||!receiptUnknown||!draft)return;
   busy=true;receiptCheck.disabled=true;receiptCheck.textContent='Проверяем отправку…';status.textContent='Проверяем, получена ли заявка…';
   try{
    var receipt=(await options.api({action:'intake-receive-state',id:draft.id})).submission;current();
    if(receipt&&receipt.submitted){acceptReceipt(receipt);return;}
    if(!receipt||typeof receipt.canReceive!=='boolean')throw Error('Результат отправки не подтверждён');
    await refresh();current();receiptUnknown=false;
    status.textContent='Отправка не подтверждена: заявка пока не получена. Материалы сохранены; можно повторить отправку.';
   }catch(e){if(same()&&wrap.isConnected)status.textContent='Не удалось подтвердить отправку. Заявка могла быть получена. Проверьте отправку, чтобы узнать результат.';}
   finally{busy=false;if(same()&&wrap.isConnected){receiptCheck.textContent='Проверить отправку';await paint();}}
  });
  var intent;try{intent=JSON.parse(localStorage.getItem('studkab-intake-submit:'+owner)||'null');}catch(_){}
  if(intent&&intent.draftId)try{
   var previous=(await options.api({action:'intake-receive-state',id:intent.draftId})).submission;current();
   if(!previous||!previous.submitted&&typeof previous.canReceive!=='boolean')throw Error('Результат отправки не подтверждён');
   if(previous&&previous.submitted){
    draft={id:intent.draftId,state:'submitted'};acceptReceipt(previous);status.textContent='Заявка №'+previous.number+' уже отправлена.';
    input.disabled=true;send.disabled=true;formInputs().forEach(function(el){el.disabled=true;});
    var next=document.createElement('button');next.type='button';next.className='b b-main';next.textContent='Новое задание';next.onclick=function(){if(!same()||!wrap.isConnected)return;localStorage.removeItem('studkab-intake-submit:'+owner);try{localStorage.removeItem(receiptKey);}catch(_){}formInputs().forEach(function(el){el.value='';});next.remove();draft=null;acceptedReceipt=null;receiptPanel.hidden=true;receiptPanel.style.display='none';run([]);};list.appendChild(next);return wrap;
   }
  }catch(e){if(!same()||!wrap.isConnected)return wrap;draft={id:intent.draftId,state:'open'};receiptUnknown=true;status.textContent='Не удалось подтвердить отправку. Заявка могла быть получена. Проверьте отправку, чтобы узнать результат.';await paint();return wrap;}
  await run([]);
  if(wrap.querySelector('#intakeLink').value.trim())checkLink();
  return wrap;
 }
 global.StudIntake={open:open,DETAILS:DETAILS,LINK:LINK};
})(window);
