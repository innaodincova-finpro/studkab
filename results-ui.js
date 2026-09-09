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
 function download(document){
  var blob=ResultDocx(document,document.chapters),url=URL.createObjectURL(blob),a=global.document.createElement('a');
  a.href=url;a.download=('Черновик '+document.topic).replace(/[\\/:*?"<>|]/g,'').slice(0,100)+'.docx';
  documentDummy(a);setTimeout(function(){URL.revokeObjectURL(url);},10000);
 }
 function documentDummy(a){global.document.body.appendChild(a);a.click();a.remove();}
 function deliver(x){
  if(!x.requestNumber)return toast('Эта запись получена вне кабинета. Передайте документ через согласованный мессенджер.');
  var payload;try{
   var problems=DraftQuality.issues(x.doc||{});
   if(problems.length)throw Error('Передача недоступна: '+problems.join('; '));
   if(!x.doc || x.doc.review!==DraftQuality.stamp(x))throw Error('Откройте документ и нажмите «Проверить готовность» перед передачей');
   payload=snapshot(x);}catch(e){return toast(e.message);}
  var data=D,identity=Oblako.identity(),deliveryId=crypto.randomUUID(),requestId=x.id,reviewStamp=x.doc.review,busy=false;
  var wrap=openModal('<button type="button" class="close" data-x="1">✕</button><h3>Передать черновик студенту</h3><p>'+esc(x.student||'Студент')+' · заявка №'+esc(x.requestNumber)+'</p><p>'+esc(x.topic)+'</p><p class="hint">Будет передана сохранённая версия документа. Новая передача сохраняется отдельно от предыдущей.</p><button type="button" class="chip" data-preview>Проверить Word перед передачей</button><p><label><input type="checkbox" data-reviewed> Я проверил документ и получателя</label></p><button type="button" class="btn" data-deliver>Передать в кабинет студента</button><p role="status" data-result-status></p>');
  wrap.dataset.accountIdentity=String(identity);
  var msg=wrap.querySelector('[data-result-status]');
  wrap.querySelector('[data-preview]').onclick=function(){if(!same(data,identity)){msg.textContent='Аккаунт изменился. Откройте документ заново.';return;}download(payload);};
  wrap.querySelector('[data-deliver]').onclick=async function(){
   if(busy)return;if(!same(data,identity)){msg.textContent='Аккаунт изменился. Откройте передачу заново.';return;}
   if(reviewStamp!==DraftQuality.stamp(x)){msg.textContent='Документ или получатель изменился. Закройте окно и повторите проверку.';return;}
   if(!wrap.querySelector('[data-reviewed]').checked){msg.textContent='Проверьте документ и подтвердите получателя.';return;}
   busy=true;this.disabled=true;msg.textContent='Передаём документ…';
   try{
    var result=await Oblako.requestApi({action:'deliver',id:requestId,deliveryId:deliveryId,document:payload});
    if(!same(data,identity))throw Error('Аккаунт изменился. Проверьте результат после повторного входа.');
    if(!result.saved||result.deliveryId!==deliveryId)throw Error('Передача не подтверждена. Повторите попытку.');
    msg.textContent='Черновик доступен студенту в его работе: «Результат от исполнителя». Уведомление в мессенджер не отправлялось.';
    this.textContent='Черновик передан';
   }catch(e){msg.textContent=e.message||'Передача не подтверждена. Повторите попытку.';this.disabled=false;}
   finally{busy=false;}
  };
 }
 async function receive(w){
  var data=D,identity=Oblako.identity();
  var wrap=openModal('<button type="button" class="close" data-x="1">✕</button><h3>Результат от исполнителя</h3><p role="status" data-result-status>Проверяем готовность…</p><button type="button" class="btn" data-download hidden>Скачать черновик Word</button><p class="hint">Прочитайте документ, проверьте факты, источники и требования преподавателя. При необходимости доработайте его перед сдачей.</p>');
  wrap.dataset.accountIdentity=String(identity);
  var msg=wrap.querySelector('[data-result-status]');
  try{
   var response=await Oblako.requestApi({action:'result',id:w.req.serverId});
   if(!same(data,identity))throw Error('Аккаунт изменился. Откройте результат заново.');
   if(!response.result){msg.textContent='Заявка получена. Исполнитель ещё не передал черновик. Проверьте готовность позже.';return;}
   var result=response.result;
   msg.textContent='Черновик готов. Передан '+new Date(result.created_at).toLocaleString('ru-RU')+'.';
   var button=wrap.querySelector('[data-download]');button.hidden=false;
   button.onclick=function(){if(!same(data,identity)){button.hidden=true;msg.textContent='Аккаунт изменился. Откройте результат заново.';return;}try{download(result.document);}catch(e){msg.textContent='Не удалось собрать файл. Откройте результат повторно.';}};
  }catch(e){msg.textContent=e.message||'Не удалось проверить результат. Откройте его повторно.';}
 }
 global.StudResults={deliver:deliver,receive:receive};
})(window);
