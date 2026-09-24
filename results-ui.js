(function(global){
 'use strict';
 function snapshot(x,external){
  if(external){var e=x.externalResult;if(!e)throw Error("Сначала прикрепите Word");return {topic:x.topic,student:x.student||"",group:x.group||"",format:{},chapters:e.chapters,structure:e.structure,uploadedWord:{name:e.name,fileHash:e.fileHash}};}
  var doc=x.doc;if(!doc||!doc.order||!doc.order.length)throw Error('Сначала подготовьте и сохраните документ');
  var format=Object.assign({toc:true,year:String(new Date().getFullYear())},x.format||{});
  ['univ','faculty','kafedra','program','form','course','city','supervisor','workType','discipline'].forEach(function(k){format[k]=x[k]||'';});
  var out={topic:x.topic,student:x.student||'',group:x.group||'',format:format,chapters:doc.order,structure:doc.structure};
  if(!doc.order.some(function(c){return ((doc.structure[c.id]||{}).text||'').trim();}))throw Error('В документе пока нет текста');
  return JSON.parse(JSON.stringify(out));
 }
 function same(data,identity){return D===data&&Oblako.identity()===identity;}
 function download(document,bytes){
  var blob=bytes||ResultDocx(document,document.chapters),url=URL.createObjectURL(blob),a=global.document.createElement('a');
  a.href=url;a.download=('Черновик '+document.topic).replace(/[\\/:*?"<>|]/g,'').slice(0,100)+'.docx';
  documentDummy(a);setTimeout(function(){URL.revokeObjectURL(url);},10000);
 }
 function documentDummy(a){global.document.body.appendChild(a);a.click();a.remove();}
 function contextKey(x,external){
  var p=(x.passports||[])[0];
  if(!p||p.status!=='approved'||!p.source_fingerprint)throw Error('Обновите и утвердите паспорт требований перед итоговой проверкой.');
  return JSON.stringify([external?JSON.stringify([x.id,x.requestNumber,x.topic,x.student,x.group,x.externalResult,DraftQuality.inputs(x)]):DraftQuality.stamp(x),p.id,p.revision,p.status,p.source_fingerprint,p.title,p.summary,p.items]);
 }
 async function sha(bytes){var d=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(d)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');}
 async function reviewDocument(x,key,external){var out=snapshot(x,external),p=x.passports[0];out.reviewContext={passportId:p.id,sourceFingerprint:p.source_fingerprint,fingerprint:await sha(new TextEncoder().encode(key))};return out;}
 function deliver(x,external){
  if(!x||!x.requestNumber)return toast('Эта запись получена вне кабинета. Передайте документ через согласованный мессенджер.');
  var key;
  try{
   if(!external){
   var problems=DraftQuality.issues(x.doc||{}).concat(DraftQuality.documentAcceptance(x).errors,DraftQuality.finAcceptance(x).errors,DraftQuality.percentageCheck(x).errors);
   if(problems.length)throw Error('Передача недоступна: '+problems.join('; '));
   if(!x.doc||x.doc.review!==DraftQuality.stamp(x))throw Error('Откройте документ и нажмите «Проверить готовность» перед передачей');
   }
   key=contextKey(x,external);
  }catch(e){return toast(e.message);}
  var quality=null,qualityBusy=false;
  var data=D,identity=Oblako.identity(),requestId=x.id,busy=true,payload,captured,receipt=null,reviewId=crypto.randomUUID(),versionId=crypto.randomUUID(),notesId=crypto.randomUUID(),amend=false,changes=false,reviewed=false,previewed=false,delivered=false,known=false;
  var reviewCriteria=DraftQuality.reviewCriteria(x),labels=reviewCriteria.map(function(c){return c.label;}),codes=reviewCriteria.map(function(c){return c.code;}),profile=DraftQuality.requirementProfile(x);
  var methodology=(external?'<p class="hint">Проверяется прикреплённый Word. Автоматические проверки текста редактора к нему не применялись. Проверьте все 16 пунктов по этому файлу, включая объём, расчёты и условия оригинальности.</p>':'')+'<details><summary>Требования этой заявки и методички</summary><p class="hint">Проверьте каждый предоставленный пункт. Программа автоматически проверяет только измеримые требования; смысл и специальные условия подтверждает исполнитель.</p><ul>'+profile.manual.map(function(line){return '<li>'+esc(line)+'</li>';}).join('')+'</ul></details>';
  var checklist=methodology+(external?'':DraftEditor.sourceReview(x))+'<details><summary>Протокол проверки — 16 пунктов</summary><p class=hint>Для каждого пункта выберите результат и укажите страницу, таблицу или другое доказательство. «Не пройден» и незавершённая ручная проверка блокируют передачу. Для «Не применимо» обязательно объясните причину.</p>'+codes.map(function(code,i){return '<fieldset style="margin:12px 0"><legend>'+esc(labels[i])+'</legend><label>Результат <select data-criterion-status="'+code+'"><option value="">Выберите результат</option><option value="pass">Пройден</option><option value="fail">Не пройден</option><option value="manual">Нужна ручная проверка</option><option value="not_applicable">Не применимо</option></select></label><input data-criterion-section="'+code+'" maxlength="300" placeholder="Место: страница, раздел или весь документ"><textarea data-criterion="'+code+'" rows="2" maxlength="2000" placeholder="Доказательство или обоснование" style="width:100%;box-sizing:border-box"></textarea></fieldset>';}).join('')+'</details>';
  var wrap=openModal('<button type="button" class="close" data-x="1">✕</button><h3>Итоговая проверка Word</h3><p>'+esc(x.student||'Студент не указан')+' · заявка №'+esc(x.requestNumber)+'</p><p>'+esc(x.topic)+'</p><p class="hint">Скачайте точный Word, откройте скачанный файл и подтвердите просмотр. Передача студенту выполняется отдельной кнопкой.</p><button type="button" class="chip" data-preview disabled>Скачать точный Word</button><p><label><input type="checkbox" data-word-opened disabled> Я открыл скачанный Word и проверил его содержимое</label></p>'+checklist+'<div data-quality-evidence></div><details data-review-history><summary>История проверок всех версий Word</summary><div data-review-history-body style="overflow-wrap:anywhere">Откройте, чтобы загрузить историю.</div></details><p><label><input type="checkbox" data-reviewed> Я проверил документ и получателя</label></p><button type="button" class="chip" data-save-notes disabled>Сохранить замечания</button><button type="button" class="btn" data-save-review disabled>Сохранить итоговую проверку</button><button type="button" class="btn" data-deliver hidden disabled style="display:none">Передать студенту</button><p role="status" data-result-status>Проверяем сохранённое состояние…</p><button type="button" class="chip" data-result-refresh disabled>Обновить состояние</button>');
  wrap.dataset.accountIdentity=String(identity);
  var notesButton=wrap.querySelector('[data-save-notes]');
  var msg=wrap.querySelector('[data-result-status]'),saveButton=wrap.querySelector('[data-save-review]'),sendButton=wrap.querySelector('[data-deliver]'),refreshButton=wrap.querySelector('[data-result-refresh]');
  var opened=wrap.querySelector('[data-word-opened]');
  function confirmedWord(){return previewed&&opened.checked;}
  function guard(){try{if(!wrap.isConnected||!same(data,identity))throw Error('Аккаунт изменился или окно закрыто. Откройте проверку заново.');if(key!==contextKey(x,external)||(!external&&x.doc.review!==DraftQuality.stamp(x)))throw Error('Документ, требования или получатель изменились. Повторите проверку.');}catch(e){known=false;throw e;}}
  function controls(){
   notesButton.textContent=reviewed&&!amend?'Добавить замечания к проверке':'Сохранить замечания';notesButton.hidden=delivered;notesButton.disabled=busy||qualityBusy||!known;
   saveButton.hidden=reviewed||delivered;saveButton.disabled=busy||qualityBusy||!known||!quality||!quality.ready();
   sendButton.hidden=!reviewed&&!delivered;sendButton.style.display=sendButton.hidden?'none':'';saveButton.style.display=saveButton.hidden?'none':'';sendButton.disabled=busy||qualityBusy||!known||delivered||amend||!quality||!quality.ready();
   sendButton.textContent=delivered?'Результат передан':'Передать студенту';
   if(quality)quality.sync();
   refreshButton.disabled=busy||qualityBusy;wrap.querySelector('[data-preview]').disabled=busy||qualityBusy||!known;
   opened.disabled=busy||!previewed||(reviewed&&!amend)||delivered;
   wrap.querySelectorAll('[data-criterion],[data-criterion-status],[data-criterion-section],[data-reviewed]').forEach(function(el){el.disabled=busy||(reviewed&&!amend)||delivered;});
  }
  function status(){msg.textContent=delivered?'Проверенная версия доступна студенту. Уведомление в мессенджер не отправлялось.':reviewed?'Проверка сохранена. Результат ещё не передан студенту.':changes?'Замечания сохранены к этой версии Word. Передача заблокирована до новой положительной проверки.':'Проверьте точный Word и заполните все пункты. Сохранение проверки не передаёт результат.';}
  function criteriaValues(){var criteria={};for(var i=0;i<codes.length;i++){
   var field=wrap.querySelector('[data-criterion="'+codes[i]+'"]'),value=wrap.querySelector('[data-criterion-status="'+codes[i]+'"]').value,evidence=field.value.trim();
   if(!value||evidence.length<10){field.closest('details').open=true;field.focus();throw Error(!value?'Выберите результат: '+labels[i]:'Добавьте доказательство: '+labels[i]);}
   if(value==='fail'||value==='manual')throw Error(value==='fail'?'Передача заблокирована: не пройден пункт «'+labels[i]+'».':'Передача заблокирована: завершите ручную проверку «'+labels[i]+'».');
   criteria[codes[i]]={status:value,evidence:evidence,section:wrap.querySelector('[data-criterion-section="'+codes[i]+'"]').value.trim()};
  }return criteria;}
  async function loadState(restore){
   guard();known=false;
   var state=await Oblako.requestApi({action:'result-review-state',id:requestId,document:payload,includeFile:true});guard();
   if(!state||['none','stale','prepared','changes_requested','reviewed','delivered'].indexOf(state.state)<0)throw Error('Сервер не подтвердил состояние проверки. Передача недоступна.');
   if((state.state==='changes_requested'||state.state==='prepared')&&reviewed){reviewId=crypto.randomUUID();amend=false;wrap.querySelector('[data-reviewed]').checked=false;}
   changes=state.state==='changes_requested';
   if(state.state==='none'||state.state==='stale'){if(receipt){versionId=crypto.randomUUID();reviewId=crypto.randomUUID();}receipt=null;reviewed=false;delivered=false;previewed=false;opened.checked=false;}
   else{
    var r=state.receipt;if(!r||!r.versionId||!r.recipientId||!r.documentHash||!r.fileHash||!state.docxBase64)throw Error('Не хватает данных сохранённой версии.');
    var bytes=Uint8Array.from(atob(state.docxBase64),function(c){return c.charCodeAt(0);});
    if(bytes.length>3145728||await sha(bytes)!==r.fileHash)throw Error('Контрольная сумма сохранённого Word не совпала.');
    guard();
    if(!captured||await sha(await captured.arrayBuffer())!==r.fileHash){previewed=false;opened.checked=false;}
    guard();captured=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});receipt=r;versionId=r.versionId;
    reviewed=state.state==='reviewed'||state.state==='delivered';delivered=state.state==='delivered';
    if(changes&&state.review&&state.review.reviewId===notesId)notesId=crypto.randomUUID();
    if(changes&&restore!==false){
     amend=false;
     if(!state.review||state.review.versionId!==versionId)throw Error("Версия замечаний не подтверждена");
     codes.forEach(function(code){var c=state.review.criteria[code]||{};wrap.querySelector('[data-criterion-status="'+code+'"]').value=c.status||"";wrap.querySelector('[data-criterion="'+code+'"]').value=c.evidence||"";wrap.querySelector('[data-criterion-section="'+code+'"]').value=c.section||"";});
     wrap.querySelector("[data-reviewed]").checked=false;
    }
    if(reviewed){
     if(!state.review||state.review.versionId!==versionId||!state.review.reviewId)throw Error('Проверка версии не подтверждена.');
     reviewId=state.review.reviewId;
     codes.forEach(function(code){var c=state.review.criteria[code];if(!c||['pass','not_applicable'].indexOf(c.status)<0||typeof c.evidence!=='string'||c.evidence.trim().length<10)throw Error('Сохранённый протокол не подтверждён.');wrap.querySelector('[data-criterion-status="'+code+'"]').value=c.status;wrap.querySelector('[data-criterion="'+code+'"]').value=c.evidence;wrap.querySelector('[data-criterion-section="'+code+'"]').value=c.section||'';});
     wrap.querySelector('[data-reviewed]').checked=true;
    }
    if(delivered&&(!state.delivery||!state.delivery.deliveryId))throw Error('Передача не подтверждена.');
   }
   if(external&&!receipt)throw Error('Прикреплённая версия не найдена в текущем состоянии. Прикрепите Word заново.');
   guard();known=true;status();if(quality)await quality.refresh();
   if(delivered){x.deliveryConfirmation={context:key,versionId:versionId,external:!!external};x.deliveryState={checkedAt:new Date().toISOString(),last:{deliveryId:state.delivery.deliveryId,versionId:versionId,createdAt:state.delivery.createdAt}};x.status='sent';if(typeof save==='function')save();if(typeof render==='function')render();}
  }
  function binding(){return {id:requestId,versionId:versionId,reviewId:reviewId,recipientId:receipt.recipientId,fileHash:receipt.fileHash,documentHash:receipt.documentHash,document:payload};}
  async function run(action){if(busy)return;busy=true;controls();try{guard();await action();}catch(e){msg.textContent=e.message||'Не удалось подтвердить состояние. Нажмите «Обновить состояние».';}finally{busy=false;controls();}}
  wrap.querySelector('[data-preview]').onclick=function(){try{guard();download(payload,captured);previewed=true;opened.checked=false;msg.textContent='Файл скачан. Откройте его в Word, проверьте и отметьте подтверждение просмотра.';controls();}catch(e){known=false;msg.textContent=e.message;controls();}};
  async function prepareVersion(){
   if(!receipt){
    var bytes=new Uint8Array(await captured.arrayBuffer()),binary='';for(var j=0;j<bytes.length;j+=8192)binary+=String.fromCharCode.apply(null,bytes.subarray(j,j+8192));
    guard();known=false;var prepared=await Oblako.requestApi({action:'prepare-result',id:requestId,versionId:versionId,document:payload,docxBase64:btoa(binary)});guard();
    if(prepared.versionId!==versionId||prepared.fileHash!==await sha(bytes))throw Error('Сохранённый файл не совпал с проверенным');guard();receipt=prepared;
   }
  }
  notesButton.onclick=function(){if(reviewed&&!amend&&!busy){amend=true;controls();msg.textContent='Укажите замечания и сохраните их. До сохранения действует предыдущая проверка.';return;}return run(async function(){
   if(!confirmedWord())throw Error('Скачайте точный Word, откройте файл и подтвердите просмотр перед сохранением замечаний.');
   var criteria={},blocked=false;
   codes.forEach(function(code){
    var value=wrap.querySelector('[data-criterion-status="'+code+'"]').value,evidence=wrap.querySelector('[data-criterion="'+code+'"]').value.trim(),section=wrap.querySelector('[data-criterion-section="'+code+'"]').value.trim();
    if(value!=='fail'&&value!=='manual')return;
    if(!value||evidence.length<10||!section)throw Error('Укажите результат, место и замечание: '+code);
    criteria[code]={status:value,evidence:evidence,section:section};if(value==='fail'||value==='manual')blocked=true;
   });
   if(!blocked)throw Error('Выберите «Не пройден» или «Нужна ручная проверка» для замечания.');
   await loadState(false);if(delivered)throw Error('Эта версия уже передана. Прикрепите новую версию Word.');
   if(!confirmedWord())throw Error('Word изменился. Скачайте точный файл и подтвердите просмотр повторно.');
   await prepareVersion();
   known=false;
   var ack=await Oblako.requestApi(Object.assign({},binding(),{action:'review-notes',reviewId:notesId,criteria:criteria}));guard();
   if(ack.reviewId!==notesId||ack.versionId!==versionId)throw Error('Сохранение замечаний не подтверждено. Обновите состояние.');
   notesId=crypto.randomUUID();reviewId=crypto.randomUUID();
   await loadState();if(!changes)throw Error('Замечания не подтверждены сервером.');
  });};
  saveButton.onclick=function(){return run(async function(){
   if(!confirmedWord()||!wrap.querySelector('[data-reviewed]').checked)throw Error('Скачайте и проверьте Word, подтвердите просмотр файла и получателя.');
   var criteria=criteriaValues();msg.textContent='Сохраняем проверку…';
   await loadState(false);if(reviewed||delivered)return;
   if(!confirmedWord())throw Error('На сервере другая версия Word. Скачайте точный файл и подтвердите просмотр повторно.');
   await prepareVersion();
   if(!quality)throw Error('Проверки качества недоступны. Обновите приложение.');await quality.refresh();if(!quality.ready())throw Error('Завершите внутреннюю проверку заимствований и сохраните внешний отчёт об оригинальности для этого Word.');
   known=false;var ack=await Oblako.requestApi(Object.assign({action:'review-result',criteria:criteria},binding()));guard();
   if(ack.reviewId!==reviewId||ack.versionId!==versionId)throw Error('Проверка не подтверждена');
   await loadState();if(!reviewed)throw Error('Сохранение проверки не подтверждено сервером. Обновите состояние.');
  });};
  sendButton.onclick=function(){return run(async function(){
   await loadState();if(delivered)return;if(!reviewed||!receipt)throw Error('Нет сохранённой проверки этой версии.');if(!quality||!quality.ready())throw Error('Проверки заимствований и оригинальности не подтверждены для этой версии.');
   guard();msg.textContent='Передаём проверенную версию…';
   known=false;var result=await Oblako.requestApi(Object.assign({action:'deliver',deliveryId:versionId},binding()));guard();
   if(!result.saved||result.deliveryId!==versionId)throw Error('Передача не подтверждена. Обновите состояние.');
   await loadState();if(!delivered)throw Error('Передача не подтверждена. Обновите состояние.');
  });};
  wrap.querySelector('[data-review-history]').ontoggle=async function(){
   if(!this.open)return;
   var target=wrap.querySelector('[data-review-history-body]');target.textContent='Загружаем историю…';
   try{guard();var result=await Oblako.requestApi({action:'result-review-history',id:requestId});guard();
    if(!Array.isArray(result.reviews))throw Error('История не подтверждена');
    target.innerHTML='<p class="hint">Последние '+result.reviews.length+' проверок (не более 100). Замечания старой версии не подтверждают новую.</p>'+result.reviews.map(function(r){
     var v=r.studkab_result_versions||{};
     return '<details><summary>Версия '+esc(v.revision)+' · '+esc(new Date(r.created_at).toLocaleString('ru-RU'))+'</summary><p>Word: '+esc(v.file_hash)+'</p>'+Object.keys(r.criteria||{}).map(function(code){var c=r.criteria[code];return '<p><b>'+esc(code)+' · '+esc({pass:'Пройден',fail:'Не пройден',manual:'Нужна ручная проверка',not_applicable:'Не применимо'}[c.status]||c.status)+'</b><br>'+esc(c.section||'')+'<br>'+esc(c.evidence||'')+'</p>';}).join('')+'</details>';
    }).join('');
   }catch(e){target.textContent=e.message||'Не удалось загрузить историю.';}
  };
  if(global.QualityEvidence)quality=QualityEvidence.mount(wrap.querySelector('[data-quality-evidence]'),{
   id:requestId,guard:guard,parentBusy:function(){return busy||!known;},getBinding:function(){if(!receipt)return null;var p=x.passports[0];return Object.assign({},receipt,{passportId:p.id,sourceFingerprint:p.source_fingerprint});},
   ensureVersion:async function(){guard();await prepareVersion();guard();known=true;controls();},
   onChange:function(ready,pending){qualityBusy=pending;controls();},
   onSaved:async function(){await loadState(false);controls();}
  });
  else wrap.querySelector('[data-quality-evidence]').textContent='Проверки качества не загружены. Обновите приложение; обычная передача недоступна.';
  refreshButton.onclick=function(){return run(loadState);};
  (async function(){try{
   payload=await reviewDocument(x,key,external);guard();captured=external?null:ResultDocx(payload,payload.chapters);
   if(captured&&captured.size>3145728)throw Error('Word больше 3 МБ. Передача этой версии пока недоступна.');
   await loadState();
  }catch(e){known=false;msg.textContent=e.message||'Состояние проверки недоступно.';}finally{busy=false;controls();}})();
 }
 async function attach(x){
  if(!x||!x.requestNumber)return toast('Прикрепление доступно для заявки из кабинета студента.');
  try{var p=(x.passports||[])[0];if(!p||p.status!=='approved')throw Error('Сначала уточните и утвердите требования заявки. Прикрепление не отменяет эту проверку.');}catch(e){return toast(e.message);}
  var data=D,identity=Oblako.identity(),initial=JSON.stringify([x.id,x.topic,x.student,x.group,x.passports,DraftQuality.inputs(x)]);
  var w=openModal('<button type="button" class="close" data-x="1">✕</button><h3>Прикрепить готовый Word</h3><p>'+esc(x.student||'')+' · заявка №'+esc(x.requestNumber)+'</p><p class="hint">Выберите .docx до 3 МБ. Файл сохранится как отдельная версия результата. Текст редактора и материалы студента сохранятся. Передача — только после итоговой проверки.</p><label>Готовый Word<input type="file" data-word-file accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label><p role="status" data-word-status>Файл не выбран.</p><button type="button" class="btn" data-word-save disabled>Сохранить файл в заявке</button>');
  w.dataset.accountIdentity=String(identity);
  var input=w.querySelector('[data-word-file]'),button=w.querySelector('[data-word-save]'),msg=w.querySelector('[data-word-status]'),selection=null,busy=false,versionId=null;
  function guard(){if(!w.isConnected||!same(data,identity)||initial!==JSON.stringify([x.id,x.topic,x.student,x.group,x.passports,DraftQuality.inputs(x)]))throw Error('Аккаунт, заявка или требования изменились. Откройте прикрепление заново.');}
  input.onchange=async function(){
   if(busy)return;selection=null;button.textContent='Сохранить файл в заявке';button.disabled=true;busy=true;input.disabled=true;
   try{
    guard();var file=input.files[0];if(!file)return;
    if(!/\.docx$/i.test(file.name)||file.size>3145728||!file.size)throw Error('Выберите непустой .docx до 3 МБ.');
    msg.textContent='Проверяем файл…';
    var bytes=new Uint8Array(await file.arrayBuffer()),module=await import('./external-word.mjs?v=1'),info=await module.inspectWord(bytes);guard();
    var chapters=[],structure={};
    for(var at=0,i=0;at<info.text.length;at+=90000,i++){var id='file_'+i;chapters.push({id:id,name:'Текст прикреплённого Word · '+(i+1)});structure[id]={text:info.text.slice(at,at+90000)};}
    var metadata={name:file.name.slice(0,200),fileHash:info.fileHash,chapters:chapters,structure:structure};
    var proposed=Object.assign({},x,{externalResult:metadata}),payload=await reviewDocument(proposed,contextKey(proposed,true),true);guard();
    selection={bytes:bytes,metadata:metadata,payload:payload};versionId=crypto.randomUUID();
    msg.textContent=file.name+' · '+Math.ceil(file.size/1024)+' КБ. Файл выбран, ещё не сохранён.';
   }catch(e){msg.textContent=e.message||'Файл не удалось прочитать.';}
   finally{busy=false;input.disabled=false;button.disabled=!selection;}
  };
  button.onclick=async function(){
   if(busy||!selection)return;busy=true;button.disabled=true;input.disabled=true;
   try{
    guard();var bin='';for(var j=0;j<selection.bytes.length;j+=8192)bin+=String.fromCharCode.apply(null,selection.bytes.subarray(j,j+8192));
    msg.textContent='Сохраняем файл…';
    await Oblako.requestApi({action:'prepare-result',id:x.id,versionId:versionId,document:selection.payload,docxBase64:btoa(bin)});guard();
    var state=await Oblako.requestApi({action:'result-review-state',id:x.id,document:selection.payload,includeFile:true});guard();
    if(!state.receipt||state.receipt.versionId!==versionId||state.receipt.fileHash!==selection.metadata.fileHash||!state.docxBase64)throw Error('Сохранение файла не подтверждено. Повторите сохранение.');
    var returned=Uint8Array.from(atob(state.docxBase64),function(c){return c.charCodeAt(0);});
    if(await sha(returned)!==selection.metadata.fileHash)throw Error('Сохранённый файл не совпал с выбранным.');
    guard();x.externalResult=selection.metadata;delete x.deliveryConfirmation;
    if(typeof save==='function')save();if(typeof render==='function')render();
    msg.textContent='Word сохранён в заявке. Студенту ещё не передан. Следующий шаг — проверка прикреплённого Word.';
    selection=null;button.textContent='Файл сохранён';
   }catch(e){msg.textContent=e.message||'Сохранение не подтверждено. Повтор использует тот же номер операции.';}
   finally{busy=false;button.disabled=!selection;input.disabled=false;}
  };
 }

 async function receive(w){
  var data=D,identity=Oblako.identity();
  var wrap=openModal('<button type="button" class="close" data-x="1">✕</button><h3>Черновик от исполнителя</h3><p role="status" data-result-status>Проверяем готовность…</p><button type="button" class="btn" data-download hidden style="display:none">Скачать черновик Word</button><p class="hint">Прочитайте документ, проверьте факты, источники и требования преподавателя. При необходимости доработайте его перед сдачей.</p>');
  wrap.dataset.accountIdentity=String(identity);
  var msg=wrap.querySelector('[data-result-status]');
  try{
   var response=await Oblako.requestApi({action:'result',id:w.req.serverId});
   if(!same(data,identity))throw Error('Аккаунт изменился. Откройте результат заново.');
   if(!response.result){msg.textContent='Заявка получена. Исполнитель ещё не передал черновик. Проверьте готовность позже.';return;}
   var result=response.result,receivedBlob=null;
   if(result.version_id){
    if(!result.docxBase64||!result.fileHash)throw Error('Проверенный файл не найден');
    var raw=atob(result.docxBase64),bytes=Uint8Array.from(raw,function(c){return c.charCodeAt(0);}),digest=await crypto.subtle.digest('SHA-256',bytes),fileHash=Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    if(fileHash!==result.fileHash)throw Error('Контрольная сумма файла не совпала. Повторите загрузку.');
    receivedBlob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
   }
   if(!same(data,identity))throw Error('Аккаунт изменился. Откройте результат заново.');
   msg.textContent='Черновик готов. Передан '+new Date(result.created_at).toLocaleString('ru-RU')+'.';
   var button=wrap.querySelector('[data-download]');button.hidden=false;button.style.removeProperty('display');
   button.onclick=function(){if(!same(data,identity)){button.hidden=true;button.style.display='none';msg.textContent='Аккаунт изменился. Откройте результат заново.';return;}try{download(result.document,receivedBlob);}catch(e){msg.textContent='Не удалось собрать файл. Откройте результат повторно.';}};
  }catch(e){msg.textContent=e.message||'Не удалось проверить результат. Откройте его повторно.';}
 }
 var TEST_LABEL='Тестовый файл — проверка качества не завершена';
 function testUnavailable(reason){return {FORBIDDEN:'Тестовая передача недоступна этому аккаунту.',TEST_ACCESS_UNAVAILABLE:'Доступ получателя не подтверждён.',TEST_NOT_ALLOWED:'Нет разрешения на тестовую передачу этой заявки.',MATERIAL_REVISION_OPEN:'Сначала завершите дополнение материалов.',MATERIAL_MANIFEST_REQUIRED:'Проверьте состав материалов и утвердите актуальный паспорт.',TEST_VERSION_CHANGED:'Сохраните актуальную версию Word перед тестовой передачей.'}[reason]||'Тестовая передача недоступна. Обновите сведения о заявке.';}
 var TEST_BINDINGS=['versionId','recipientId','fileHash','documentHash','passportId','sourceFingerprint'];
 function testBinding(value){var out={};if(!value)throw Error('Тестовая передача не подтверждена сервером.');TEST_BINDINGS.forEach(function(k){if(typeof value[k]!=='string'||!value[k])throw Error('Тестовая передача не подтверждена сервером.');out[k]=value[k];});return out;}
 function sameTest(a,b){return JSON.stringify(testBinding(a))===JSON.stringify(testBinding(b));}
 function validTest(value){return value&&value.qualityStatus==='incomplete'&&value.label===TEST_LABEL&&typeof value.deliveryId==='string';}
 async function mountTestDelivery(x,host,student){
  if(!host||!x)return;var data=D,identity=Oblako.identity(),id=student?x.req&&x.req.serverId:x.requestNumber&&x.id;
  if(!id)return;
  function current(){return host.isConnected&&same(data,identity);}
  try{
   var response=await Oblako.requestApi({action:student?'test-result':'test-delivery-state',id:id,includeFile:false});if(!current())return;
   if(student){
    var delivered=response.testDelivery;if(!validTest(delivered))return;testBinding(delivered);
    host.innerHTML='<div class="card"><b>'+TEST_LABEL+'</b><p class="hint">Файл передан только для проверки тестового маршрута. Это не готовая работа для сдачи.</p><button type="button" class="btn" data-test-receive>Скачать тестовый Word</button><p role="status" data-test-status></p></div>';
    host.querySelector('[data-test-receive]').onclick=function(){return receiveTest(id,delivered,host,data,identity);};
   }else{
    var state=response.testDeliveryState;if(!state||state.eligible!==true)return;testBinding(state);
    host.innerHTML='<div class="card"><b>Тестовая передача</b><p class="hint">'+TEST_LABEL+'. Обычная итоговая проверка остаётся обязательной для готового результата.</p><button type="button" class="chip" data-test-open>Передать тестовый файл</button></div>';
    host.querySelector('[data-test-open]').onclick=function(){if(current())testDeliver(x);};
   }
   host.hidden=false;
  }catch(e){/* Unknown eligibility never exposes a test action. */}
 }
 async function receiveTest(id,expected,host,data,identity){
  var button=host.querySelector('[data-test-receive]'),msg=host.querySelector('[data-test-status]');button.disabled=true;
  function guard(){if(!host.isConnected||!same(data,identity))throw Error('Аккаунт или окно изменились. Откройте заявку заново.');}
  try{
   guard();msg.textContent='Проверяем тестовый файл…';
   var response=await Oblako.requestApi({action:'test-result',id:id,includeFile:true});guard();var delivered=response.testDelivery;
   if(!validTest(delivered)||!sameTest(delivered,expected)||delivered.deliveryId!==expected.deliveryId||typeof delivered.docxBase64!=='string')throw Error('Тестовый файл изменился или недоступен. Откройте заявку заново.');
   var bytes=Uint8Array.from(atob(delivered.docxBase64),function(c){return c.charCodeAt(0);});
   if(!bytes.length||bytes.length>3145728||await sha(bytes)!==delivered.fileHash)throw Error('Контрольная сумма тестового файла не совпала.');guard();
   var url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})),a=global.document.createElement('a');
   a.href=url;a.download='Тестовый файл — качество не подтверждено.docx';documentDummy(a);setTimeout(function(){URL.revokeObjectURL(url);},10000);msg.textContent=TEST_LABEL+'. Скачивание начато.';
  }catch(e){if(host.isConnected)msg.textContent=e.message||'Не удалось получить тестовый файл.';}
  finally{button.disabled=!same(data,identity);}
 }
 function testDeliver(x){
  if(!x||!x.requestNumber)return;var data=D,identity=Oblako.identity(),id=x.id,operation=crypto.randomUUID(),operationBinding=null,state=null,busy=true;
  var wrap=openModal('<button type="button" class="close" data-x="1">✕</button><h3>Тестовая передача</h3><p><b>'+TEST_LABEL+'</b></p><p>'+esc(x.student||'Получатель заявки')+' · заявка №'+esc(x.requestNumber)+'</p><p class="hint">Передаётся последняя сохранённая версия Word. Файл доступен только для тестирования. Эта операция не утверждает качество, не завершает обычную проверку и не меняет статус заявки на «Передано».</p><label><input type="checkbox" data-test-confirm disabled> Я проверил получателя и подтверждаю передачу непроверенного тестового файла</label><button type="button" class="btn" data-test-send disabled>Передать тестовый файл</button><button type="button" class="chip" data-test-refresh disabled>Обновить состояние</button><p role="status" data-test-status>Проверяем разрешение сервера…</p>');
  wrap.dataset.accountIdentity=String(identity);
  var confirm=wrap.querySelector('[data-test-confirm]'),send=wrap.querySelector('[data-test-send]'),refresh=wrap.querySelector('[data-test-refresh]'),msg=wrap.querySelector('[data-test-status]');
  function guard(){if(!wrap.isConnected||!same(data,identity))throw Error('Аккаунт или окно изменились. Откройте заявку заново.');}
  function controls(){send.disabled=busy||!state||!confirm.checked;confirm.disabled=busy||!state;refresh.disabled=busy;}
  async function load(){
   guard();state=null;confirm.checked=false;
   var response=await Oblako.requestApi({action:'test-delivery-state',id:id});guard();var latest=response.testDeliveryState;
   if(!latest||latest.eligible!==true){msg.textContent=testUnavailable(latest&&latest.reason);return;}
   testBinding(latest);
   var found=await Oblako.requestApi({action:'test-result',id:id,includeFile:false});guard();
   if(validTest(found.testDelivery)&&sameTest(found.testDelivery,latest)){msg.textContent=TEST_LABEL+'. Эта версия уже доступна студенту.';return;}
   if(operationBinding&&!sameTest(operationBinding,latest)){operation=crypto.randomUUID();operationBinding=null;}
   state=latest;msg.textContent='Разрешена отдельная тестовая передача. Подтвердите получателя.';
  }
  async function run(fn){if(busy)return;busy=true;controls();try{guard();await fn();}catch(e){state=null;msg.textContent=e.message||'Передача не подтверждена. Обновите состояние.';}finally{busy=false;controls();}}
  confirm.onchange=controls;
  refresh.onclick=function(){return run(load);};
  send.onclick=function(){if(!confirm.checked||!state)return;var captured=testBinding(state);operationBinding=captured;return run(async function(){
   var response=await Oblako.requestApi({action:'test-delivery-state',id:id});guard();var latest=response.testDeliveryState;
   if(!latest||latest.eligible!==true||!sameTest(latest,captured))throw Error('Версия, получатель или разрешение изменились. Обновите состояние и подтвердите заново.');
   await Oblako.requestApi(Object.assign({action:'test-deliver',id:id,deliveryId:operation},captured));guard();
   var saved=await Oblako.requestApi({action:'test-result',id:id,includeFile:false});guard();
   if(!validTest(saved.testDelivery)||!sameTest(saved.testDelivery,captured))throw Error('Тестовая передача не подтверждена. Обновите состояние.');
   state=null;confirm.checked=false;msg.textContent=TEST_LABEL+'. Эта версия доступна студенту. Обычная итоговая проверка не завершена.';
  });};
  busy=false;run(load);
 }
 global.StudResults={mountTestDelivery:mountTestDelivery,testDeliver:testDeliver,attach:attach,deliver:deliver,receive:receive,isCurrentDelivery:function(x){try{return !!x.deliveryConfirmation&&x.deliveryConfirmation.context===contextKey(x,!!x.deliveryConfirmation.external)&&!!x.deliveryState&&!!x.deliveryState.last&&x.deliveryState.last.versionId===x.deliveryConfirmation.versionId;}catch(e){return false;}}};
})(window);
