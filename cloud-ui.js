/* Shared storage interface for the cabinet and registry. No credentials here. */
(function(global){
 'use strict';
 var running=null, runningIdentity=null, activeChoice=null;
 function o(){return global.Oblako;}
 function panel(){
  var on=o() && o().mode==='cloud';
  return '<div id="cloudPanel"><div id="cloudBadge" style="font-weight:600">'+(on?'Облачное хранение':'Хранение на устройстве')+'</div>'+
   (on?'<p id="cloudAccount" class="mut" style="overflow-wrap:anywhere">'+esc(o().email)+'</p>':'')+
   '<p id="cloudLine" class="hint" role="status" aria-live="polite">'+esc(o()?o().statusText():'Облако временно недоступно')+'</p>'+
   '<div class="chips">'+(on?'<button class="chip" type="button" data-act="cloud-sync">Синхронизировать</button><button class="chip" type="button" data-act="cloud">Аккаунт</button>':'<button class="chip" type="button" data-act="cloud">Войти по почте и паролю</button><button class="chip" type="button" data-act="cloud-google">Войти через Google</button>')+'</div>'+
   (!on?'<p class="hint">Без входа можно продолжать работу на этом устройстве. Первый вход по почте — по приглашению исполнителя.</p>':'')+'</div>';
 }
 function paint(){
  if(activeChoice && activeChoice.identity!==o().identity())activeChoice.cancel();
  var node=document.getElementById('cloudPanel');
  if(node){var focus=node.contains(document.activeElement)?document.activeElement.getAttribute('data-act'):null;node.outerHTML=panel();if(focus){var button=document.querySelector('#cloudPanel [data-act="'+focus+'"]');if(button)button.focus();}}
 }
 function choose(title,text,choices){
  return new Promise(function(resolve){
   var previous=document.activeElement,done=false;
   var w=openModal('<h3 id="cloudChoiceTitle">'+esc(title)+'</h3><p class="hint">'+esc(text)+'</p><div class="rowbtns" style="flex-direction:column">'+choices.map(function(c,i){return '<button type="button" class="btn '+(i?'ghost':'')+'" data-cloud-choice="'+i+'">'+esc(c.label)+'</button>';}).join('')+'</div>');
   w.setAttribute('role','dialog');w.setAttribute('aria-modal','true');w.setAttribute('aria-labelledby','cloudChoiceTitle');
   function finish(value){if(done)return;done=true;activeChoice=null;w.remove();if(previous && previous.isConnected)previous.focus();resolve(value);}
   w.addEventListener('click',function(e){var b=e.target.closest('[data-cloud-choice]');if(b)finish(choices[Number(b.dataset.cloudChoice)].value);else if(e.target===w)finish('later');});
   w.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();finish('later');}if(e.key==='Tab'){var buttons=Array.from(w.querySelectorAll('button'));if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0].focus();}}});
   activeChoice={identity:o().identity(),cancel:function(){finish('later');}};
   w.querySelector('button').focus();
  });
 }
 function backup(){
  // Keep both versions before any explicit replacement. Failure stops replacement.
  var k=KEY+':before-cloud-choice';
  return {save:function(remote){localStorage.setItem(k,JSON.stringify({at:new Date().toISOString(),local:JSON.parse(o().snapshot(D)),remote:JSON.parse(o().snapshot(remote))}));}};
 }
 function summary(data){return CLOUD_APP==='reestr'?(data.items||[]).length+' заявок':(data.works||[]).length+' работ, '+(data.tasks||[]).length+' задач';}
 async function sync(){
  if(running){if(runningIdentity!==o().identity())return running.then(sync);return running;}
  runningIdentity=o().identity();
  running=reconcile().catch(function(e){toast(e.message||'Синхронизация не завершена. Записи на устройстве сохранены');}).finally(function(){running=null;paint();});
  return running;
 }
 async function reconcile(){
  var api=o();if(!api || api.mode!=='cloud')return openCloud();
  if(api.busy){toast('Дождитесь завершения текущей операции');return;}
  var identity=api.identity();
  if(global.cloudGuestCandidate){
   var guest=global.cloudGuestCandidate;
   var importGuest=await choose('Записи без входа', 'На этом устройстве есть записи, созданные без аккаунта. Перенести их в аккаунт '+api.email+'? Исходная копия останется на устройстве.', [{label:'Перенести мои записи',value:'import'},{label:'Открыть только записи аккаунта',value:'skip'},{label:'Решить позже',value:'later'}]);
   if(identity!==api.identity()||importGuest==='later')return;
   if(importGuest==='import'){
    var invalid=checkBackup(guest);if(invalid)throw Error('Не удалось проверить локальные записи: '+invalid);
    localStorage.setItem(KEY, JSON.stringify(guest));D=guest;load();render();
   }
   global.cloudGuestCandidate=null;
  }
  var baseline=api.baseline(), res=await api.pull();
  if(identity!==api.identity())return;
  if(!res||res.status==='busy'||res.status==='stale')return;
  if(res.status==='error'){toast(res.error);return;}
  if(res.status!=='loaded'&&res.status!=='empty')return;
  var local=api.snapshot(D);
  if(res.status==='empty'){
   // Account scope has already been selected; no existing cloud records to replace.
   api.accept();await cloudSave('Записи сохранены в облаке');return;
  }
  var bad=checkBackup(res.remote);if(bad){toast('Не удалось проверить облачные записи: '+bad);return;}
  var remote=api.snapshot(res.remote);
  if(local===remote){api.accept(D);return;}
  if(cloudIsEmpty(D)||baseline===local){cloudApply(res.remote);return;}
  if(baseline===remote){api.accept();await cloudSave('Изменения сохранены в облаке');return;}
  var action=await choose('Записи на устройствах различаются',
   'На этом устройстве: '+summary(D)+'. В облаке: '+summary(res.remote)+'. Выберите, какие записи использовать. Перед заменой обе версии сохранятся в разделе «Копия данных».',
   [{label:'Использовать записи из облака',value:'remote'},{label:'Использовать записи этого устройства',value:'local'},{label:'Решить позже — ничего не заменять',value:'later'}]);
  if(identity!==api.identity()||action==='later')return;
  // An edit or another tab can change local data while the choice is open.
  if(api.snapshot(D)!==local){toast('Записи изменились во время выбора. Повторите синхронизацию');return;}
  if(action==='local'){
   var yes=await choose('Заменить облачную версию?', 'Записи этого устройства заменят текущую версию в облаке для этого аккаунта. Другие ваши приложения не изменятся.',[{label:'Заменить облачную версию',value:'yes'},{label:'Вернуться без замены',value:'later'}]);
   if(yes!=='yes'||identity!==api.identity()||api.snapshot(D)!==local)return;
  }
  backup().save(res.remote);
  if(action==='remote')cloudApply(res.remote);
  else {api.accept();await cloudSave('Записи этого устройства сохранены в облаке');}
 }
 function downloadBackup(){
  var raw=localStorage.getItem(KEY+':before-cloud-choice');if(!raw){toast('Копий перед заменой пока нет');return;}
  var data=JSON.parse(raw);
  choose('Копия перед заменой', 'Выберите версию для скачивания. Файл можно вернуть через «Загрузить копию».', [{label:'Копия с этого устройства',value:'local'},{label:'Копия из облака',value:'remote'},{label:'Закрыть',value:'later'}]).then(function(part){
   if(part==='later')return;var url=URL.createObjectURL(new Blob([JSON.stringify(data[part],null,2)],{type:'application/json'}));var a=document.createElement('a');a.href=url;a.download='studkab-before-replacement-'+part+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
  });
 }
 document.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b)return;
  var act=b.getAttribute('data-act');
  if(act==='cloud-sync'){e.preventDefault();sync();}
  if(act==='cloud-google'){e.preventDefault();o().signInGoogle().catch(function(e){toast(e.message);});}
  if(act==='cloud-before-copy'){e.preventDefault();downloadBackup();}
 });
 global.CloudUI={panel:panel,paint:paint,choose:choose,sync:sync};
})(window);
