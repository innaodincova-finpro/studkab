(function(global){
 'use strict';
 function snapshot(x){
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
 function deliver(x){
  if(!x.requestNumber)return toast('Эта запись получена вне кабинета. Передайте документ через согласованный мессенджер.');
  var payload;try{
   var problems=DraftQuality.issues(x.doc||{}).concat(DraftQuality.finAcceptance(x).errors);
   if(problems.length)throw Error('Передача недоступна: '+problems.join('; '));
   if(!x.doc || x.doc.review!==DraftQuality.stamp(x))throw Error('Откройте документ и нажмите «Проверить готовность» перед передачей');
   payload=snapshot(x);}catch(e){return toast(e.message);}
  var data=D,identity=Oblako.identity(),deliveryId=crypto.randomUUID(),versionId=crypto.randomUUID(),reviewId=crypto.randomUUID(),requestId=x.id,reviewStamp=x.doc.review,busy=false,receipt=null,reviewed=false,previewed=false,reviewEvidence=null;
  var captured;try{captured=ResultDocx(payload,payload.chapters);if(captured.size>3145728)throw Error('Word больше 3 МБ. Передача этой версии пока недоступна.');}catch(e){return toast(e.message);}
  var labels=['Тема, получатель и задачи','Исходные данные','Расчёты и формулы','Методика расчёта','Выводы по показателям','Факторы изменения результата','Прибыль и денежные потоки','Сценарии и допущения','Рекомендации','Источники и ссылки','Открытие и редактирование в Microsoft Word','Объём и комплектность','Соответствие проверенного файла получателю','Ограничения данных','Оформление','Ясность и согласованность'];
  var codes=labels.map(function(_,i){return i<13?'C'+String(i+1).padStart(2,'0'):'S0'+(i-12);});
  var checklist='<details><summary>Протокол проверки — 16 пунктов</summary><p class=hint>Для каждого пункта укажите страницу, таблицу или результат проверки. Если пункт неприменим, объясните почему. Наличие протокола не заменяет проверку содержания.</p>'+codes.map(function(code,i){return '<label style="display:block;margin:12px 0">'+esc(labels[i])+'<textarea data-criterion="'+code+'" rows="2" maxlength="2000" placeholder="Где и что проверено" style="width:100%;box-sizing:border-box"></textarea></label>';}).join('')+'</details>';
  var wrap=openModal('<button type="button" class="close" data-x="1">✕</button><h3>Передать черновик студенту</h3><p>'+esc(x.student||'Студент')+' · заявка №'+esc(x.requestNumber)+'</p><p>'+esc(x.topic)+'</p><p class="hint">Будет передана сохранённая версия документа. Новая передача сохраняется отдельно от предыдущей.</p><button type="button" class="chip" data-preview>Проверить Word перед передачей</button>'+checklist+'<p><label><input type="checkbox" data-reviewed> Я проверил документ и получателя</label></p><button type="button" class="btn" data-deliver>Передать в кабинет студента</button><p role="status" data-result-status></p>');
  wrap.dataset.accountIdentity=String(identity);
  var msg=wrap.querySelector('[data-result-status]');
  wrap.querySelector('[data-preview]').onclick=function(){if(!same(data,identity)){msg.textContent='Аккаунт изменился. Откройте документ заново.';return;}download(payload,captured);previewed=true;};
  wrap.querySelector('[data-deliver]').onclick=async function(){
   if(busy)return;if(!same(data,identity)){msg.textContent='Аккаунт изменился. Откройте передачу заново.';return;}
   if(reviewStamp!==DraftQuality.stamp(x)){msg.textContent='Документ или получатель изменился. Закройте окно и повторите проверку.';return;}
   if(!previewed||!wrap.querySelector('[data-reviewed]').checked){msg.textContent='Проверьте документ Word и подтвердите получателя.';return;}
   var criteria={};for(var i=0;i<codes.length;i++){var evidence=wrap.querySelector('[data-criterion="'+codes[i]+'"]').value.trim();if(evidence.length<10){msg.textContent='Заполните пункт: '+labels[i];wrap.querySelector('details').open=true;return;}criteria[codes[i]]={status:'pass',evidence:evidence};}
   if(reviewEvidence&&reviewEvidence!==JSON.stringify(criteria)){msg.textContent='Протокол изменён. Закройте окно и повторите проверку.';return;}
   busy=true;this.disabled=true;msg.textContent='Передаём документ…';
   try{
    if(!receipt){
     var bytes=new Uint8Array(await captured.arrayBuffer()),binary='';for(var j=0;j<bytes.length;j+=8192)binary+=String.fromCharCode.apply(null,bytes.subarray(j,j+8192));
     var prepared=await Oblako.requestApi({action:'prepare-result',id:requestId,versionId:versionId,document:payload,docxBase64:btoa(binary)});
     var digest=await crypto.subtle.digest('SHA-256',bytes),localHash=Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
     if(prepared.versionId!==versionId||prepared.fileHash!==localHash)throw Error('Сохранённый файл не совпал с проверенным');receipt=prepared;
    }
    if(!same(data,identity)||reviewStamp!==DraftQuality.stamp(x))throw Error('Документ или аккаунт изменился. Повторите проверку.');
    var binding={id:requestId,versionId:versionId,reviewId:reviewId,recipientId:receipt.recipientId,fileHash:receipt.fileHash,documentHash:receipt.documentHash};
    if(!reviewed){reviewEvidence=JSON.stringify(criteria);var ack=await Oblako.requestApi(Object.assign({action:'review-result',criteria:criteria},binding));if(ack.reviewId!==reviewId||ack.versionId!==versionId)throw Error('Проверка не подтверждена');reviewed=true;}
    if(!same(data,identity)||reviewStamp!==DraftQuality.stamp(x))throw Error('Документ или аккаунт изменился. Повторите проверку.');
    var result=await Oblako.requestApi(Object.assign({action:'deliver',deliveryId:deliveryId},binding));
    if(!same(data,identity))throw Error('Аккаунт изменился. Проверьте результат после повторного входа.');
    if(!result.saved||result.deliveryId!==deliveryId)throw Error('Передача не подтверждена. Повторите попытку.');
    msg.textContent='Черновик доступен студенту в его работе: «Черновик от исполнителя». Уведомление в мессенджер не отправлялось.';
    this.textContent='Черновик передан';
   }catch(e){msg.textContent=e.message||'Передача не подтверждена. Повторите попытку.';this.disabled=false;}
   finally{busy=false;}
  };
 }
 async function receive(w){
  var data=D,identity=Oblako.identity();
  var wrap=openModal('<button type="button" class="close" data-x="1">✕</button><h3>Черновик от исполнителя</h3><p role="status" data-result-status>Проверяем готовность…</p><button type="button" class="btn" data-download hidden>Скачать черновик Word</button><p class="hint">Прочитайте документ, проверьте факты, источники и требования преподавателя. При необходимости доработайте его перед сдачей.</p>');
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
   var button=wrap.querySelector('[data-download]');button.hidden=false;
   button.onclick=function(){if(!same(data,identity)){button.hidden=true;msg.textContent='Аккаунт изменился. Откройте результат заново.';return;}try{download(result.document,receivedBlob);}catch(e){msg.textContent='Не удалось собрать файл. Откройте результат повторно.';}};
  }catch(e){msg.textContent=e.message||'Не удалось проверить результат. Откройте его повторно.';}
 }
 global.StudResults={deliver:deliver,receive:receive};
})(window);
