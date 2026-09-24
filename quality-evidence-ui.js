(function(global){
 'use strict';
 var KEYS=['versionId','recipientId','fileHash','documentHash','passportId','sourceFingerprint'];
 var labels={pass:'Пройдено',fail:'Не пройдено',manual:'Нужна ручная проверка'};
 function binding(value){var out={};KEYS.forEach(function(k){if(!value||typeof value[k]!=='string'||!value[k])throw Error('Привязка проверки к Word не подтверждена.');out[k]=value[k];});return out;}
 function equal(a,b){return JSON.stringify(binding(a))===JSON.stringify(binding(b));}
 function field(name,label,type){return '<label style="display:block;margin:10px 0">'+esc(label)+'<input data-q="'+name+'" type="'+(type||'text')+'" style="width:100%;box-sizing:border-box"'+(type==='number'?' min="0" max="100" step="0.01"':' maxlength="1000"')+'></label>';}
 function disposition(name){return '<label>Результат проверки<select data-q="'+name+'" style="width:100%"><option value="manual">Нужна ручная проверка</option><option value="fail">Не пройдено</option><option value="pass">Пройдено</option></select></label>';}
 function mount(host,options){
  var state=null,verified=false,dirty=false,scan=null,scanHash=null,busy=false,currentBinding=null,operations={},lastReady=false;
  host.innerHTML='<details data-quality-panel><summary>Проверки заимствований и оригинальности</summary><p class="hint">Эти два результата относятся к сохранённой версии Word. Они не заменяют проверку содержания по 16 критериям.</p><button type="button" class="chip" data-quality-start>Начать проверки этой версии Word</button><button type="button" class="chip" data-quality-refresh>Обновить проверки</button><p role="status" data-quality-status>Сначала сохраните точную версию Word для проверки.</p><div data-quality-body></div></details>';
  var msg=host.querySelector('[data-quality-status]'),body=host.querySelector('[data-quality-body]');
  function guard(){options.guard();if(!host.isConnected)throw Error('Окно проверки закрыто.');}
  function captured(){guard();return binding(options.getBinding());}
  function ready(){return verified&&!dirty&&!!state&&state.eligible===true&&Array.isArray(state.blockingCodes)&&state.blockingCodes.length===0&&['internal_borrowing','external_originality'].every(function(k){return state.latest&&state.latest[k]&&state.latest[k].payload&&state.latest[k].payload.disposition==='pass';});}
  function notify(){lastReady=ready();if(options.onChange)options.onChange(lastReady,busy);}
  function controls(silent){var blocked=busy||(options.parentBusy&&options.parentBusy());host.querySelectorAll('button,input,select,textarea').forEach(function(el){el.disabled=blocked||(el.dataset.q&&(!state||el.dataset.locked==='true'));});host.querySelector('[data-quality-refresh]').disabled=blocked||!options.getBinding();if(!silent)notify();}
  function check(after){guard();if(!equal(captured(),after))throw Error('Word, паспорт или получатель изменились. Откройте проверку заново.');}
  function validation(message){var error=Error(message);error.qualityValidation=true;return error;}
  function value(name){return body.querySelector('[data-q="'+name+'"]');}
  function put(name,v){var node=value(name);if(node)node.value=v===undefined||v===null?'':String(v);}
  function statusText(){return ready()?'Внутренняя и внешняя проверки сохранены для этой версии Word. Завершите проверку содержания по критериям.':'Обычная передача заблокирована, пока обе проверки этой версии не пройдены. Тестовая передача не подтверждает качество.';}
  function summary(evidence){return evidence?esc(labels[evidence.payload&&evidence.payload.disposition]||'Результат не подтверждён')+' · '+esc(new Date(evidence.createdAt||evidence.created_at).toLocaleString('ru-RU')):'Проверка не сохранена';}
  function findingsView(){
   var target=body.querySelector('[data-quality-findings]');if(!target)return;
   if(!scan){var pass=value('internalDisposition').querySelector('option[value="pass"]');pass.disabled=true;target.innerHTML='<p class="hint">Сравнение ещё не выполнено. Процент оригинальности здесь не рассчитывается.</p>';return;}
   var findings=Array.isArray(scan.matches)?scan.matches:[],scope=scan.scope||{};
   target.innerHTML='<p><b>Область проверки</b></p><p class="hint">Только извлечённый текст этого Word и доступные тексты приложенных источников. Интернет и закрытые базы не проверяются; отсутствие совпадений не подтверждает оригинальность.</p><pre data-quality-scope style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit"></pre>'+(findings.length?'<p>Совпадений для рассмотрения: '+findings.length+'</p>':'<p>В проверенной области совпадений не найдено. Это не результат внешнего антиплагиата.</p>')+findings.map(function(f,i){return '<fieldset data-finding="'+i+'" style="margin:12px 0;min-width:0"><legend>Совпадение '+(i+1)+'</legend><p data-finding-description style="white-space:pre-wrap;overflow-wrap:anywhere"></p><label>Решение<select data-finding-disposition style="width:100%"><option value="">Не рассмотрено</option><option value="explained">Объяснено: цитата или обоснованное совпадение</option><option value="needs_revision">Нужна доработка Word</option></select></label><label>Обоснование и место в документе<textarea data-finding-notes rows="2" maxlength="2000" style="width:100%;box-sizing:border-box"></textarea></label></fieldset>';}).join('');
   target.querySelector('[data-quality-scope]').textContent=scopeText(scope,scan);
   findings.forEach(function(f,i){var node=target.querySelector('[data-finding="'+i+'"]');node.querySelector('[data-finding-description]').textContent=findingText(f);});
   var pass=value('internalDisposition').querySelector('option[value="pass"]');pass.disabled=scan.status==='not_checked'||!scan.scope||!scan.scope.usableSources||scan.scope.usableSources!==scan.scope.providedSources||!!(scan.limits&&scan.limits.truncated);if(pass.disabled&&value('internalDisposition').value==='pass')value('internalDisposition').value='manual';
   var evidence=state&&state.latest&&state.latest.internal_borrowing;
   var decisions=evidence&&evidence.payload&&evidence.payload.scanHash===scanHash?evidence.payload.findingDecisions||[]:[];
   findings.forEach(function(f,i){var d=decisions.find(function(d){return d.findingId===f.id;}),node=target.querySelector('[data-finding="'+i+'"]');if(d){node.querySelector('select').value=d.disposition;node.querySelector('textarea').value=d.notes||'';}});
  }
  function scopeText(scope,result){
   var sources=Array.isArray(result.sources)?result.sources:[],descriptors=Array.isArray(result.sourceDescriptors)?result.sourceDescriptors:[],limits=result.limits||{},lines=[
    'Приложенных текстов источников: '+(scope.providedSources??'не подтверждено')+'. Пригодных для сравнения: '+(scope.usableSources??'не подтверждено')+'.',
    'В обработку включено словесных единиц Word: '+(scope.scannedDocumentTokens??'не подтверждено')+' из '+(scope.documentTokens??'не подтверждено')+'.',
    'Извлекается основной текст Word. Текст внутри изображений, колонтитулы и сноски в эту проверку не входят.'
   ];
   (descriptors.length?descriptors:sources).forEach(function(source,i){var measured=sources.find(function(s){return s.id===source.id;})||{};lines.push('Источник '+(i+1)+': '+(source.name||source.id)+' — в обработку включено '+(measured.scannedTokenCount??0)+' из '+(measured.tokenCount??0)+' единиц текста.');});
   if(limits.truncated)lines.push('Проверка прервана или ограничена объёмом; полнота не подтверждена. Положительный результат недоступен.');
   if(Array.isArray(limits.reasons)&&limits.reasons.length)lines.push('Ограничения: '+limits.reasons.join('; '));
   if(scope.usableSources<scope.providedSources)lines.push('Часть источников не содержит пригодного извлечённого текста. Положительный результат недоступен.');
   if(scope.usableSources===0)lines.push('Нет доступных текстов источников. Положительный результат недоступен.');
   return lines.join('\n');
  }
  function findingText(f){var d=f.document||{},source=f.source||{};return [f.kind==='internal'?'Повтор внутри Word':'Совпадение с источником '+(source.name||source.id||''),'Текст Word, строки '+d.lineStart+'–'+d.lineEnd+':',d.excerpt,'Сопоставленный фрагмент, строки '+source.lineStart+'–'+source.lineEnd+':',source.excerpt].filter(Boolean).join('\n');}
  function render(){
   var latest=state.latest||{},internal=latest.internal_borrowing,external=latest.external_originality,req=state.thresholdRequirement||{};
   body.innerHTML='<details open><summary>1. Внутренняя проверка заимствований</summary><p data-internal-saved>'+summary(internal)+'</p><p class="hint">Бесплатное сравнение доступных источников и повторов внутри текста. Совпадения рассматривает исполнитель.</p><button type="button" class="chip" data-quality-scan>Сравнить текст с доступными источниками</button><div data-quality-findings></div>'+disposition('internalDisposition')+'<label style="display:block">Вывод исполнителя<textarea data-q="internalNotes" rows="3" maxlength="4000" style="width:100%;box-sizing:border-box"></textarea></label><button type="button" class="chip" data-quality-save-internal>Сохранить внутреннюю проверку</button></details><details><summary>2. Внешний отчёт об оригинальности</summary><p data-external-saved>'+summary(external)+'</p><p class="hint">Прикрепите полученный PDF-отчёт до 5 МБ. Приложение не заказывает платную проверку и не подтверждает подлинность отчёта автоматически.</p><p><b>Условие из паспорта</b></p><p data-quality-threshold style="white-space:pre-wrap;overflow-wrap:anywhere"></p>'+field('service','Система проверки')+field('checkId','Номер проверки или отчёта')+field('checkedAt','Дата проверки','date')+'<div data-quality-required-threshold>'+field('thresholdPercent','Подтверждённый вузом порог, %','number')+'</div>'+field('actualPercent','Оригинальность по отчёту, %','number')+'<label style="display:block"><input type="checkbox" data-q="requirementConfirmed"> Я сверил основание проверки с паспортом</label><label style="display:block"><input type="checkbox" data-q="wordBindingConfirmed"> Я проверил, что PDF относится именно к открытому точному Word</label><label style="display:block;margin:10px 0">PDF-отчёт<input type="file" data-q="report" accept=".pdf,application/pdf" style="width:100%"></label>'+disposition('externalDisposition')+'<label style="display:block">Вывод и сведения для проверки<textarea data-q="externalNotes" rows="3" maxlength="4000" style="width:100%;box-sizing:border-box"></textarea></label><button type="button" class="chip" data-quality-save-external>Сохранить внешний отчёт</button><button type="button" class="chip" data-quality-report '+(external?'':'hidden')+'>Скачать сохранённый PDF</button></details>';
   body.querySelector('[data-quality-threshold]').textContent=req.text||'Пункт оригинальности не подтверждён. Уточните и утвердите паспорт; порог по умолчанию не установлен.';
   body.querySelector('[data-quality-required-threshold]').hidden=!['university_threshold','university_threshold_no_service'].includes(req.mode);
   if(req.mode==='university_threshold'){put('service',req.service);put('thresholdPercent',req.thresholdPercent);value('service').readOnly=true;value('thresholdPercent').readOnly=true;}
   if(req.mode==='university_threshold_no_service'){put('thresholdPercent',req.thresholdPercent);value('thresholdPercent').readOnly=true;body.querySelector('[data-q="externalDisposition"] option[value="pass"]').disabled=true;}
   if(req.mode==='university_no_threshold'){put('service',req.service);value('service').readOnly=true;}
   if(internal){put('internalDisposition',internal.payload.disposition);put('internalNotes',internal.payload.notes);if(internal.payload.scan){scan=internal.payload.scan;scanHash=internal.payload.scanHash;}}
   if(external){['service','checkId','thresholdPercent','actualPercent'].forEach(function(k){put(k,external.payload[k]);});put('checkedAt',(external.payload.checkedAt||'').slice(0,10));put('externalDisposition',external.payload.disposition);put('externalNotes',external.payload.notes);}
   findingsView();
   body.querySelector('[data-quality-scan]').onclick=function(){dirty=true;notify();return run(async function(){var expected=captured();var result=await Oblako.requestApi({action:'quality-scan',id:options.id,versionId:expected.versionId});check(expected);if(!result||!result.scan||typeof result.scanHash!=='string'||!(/^[a-f0-9]{64}$/).test(result.scanHash)||!Array.isArray(result.scan.matches))throw Error('Сервер не подтвердил результат сравнения.');scan=result.scan;scanHash=result.scanHash;findingsView();msg.textContent='Сравнение выполнено. Рассмотрите каждое совпадение и сохраните вывод.';});};
   body.querySelector('[data-quality-save-internal]').onclick=function(){return run(async function(){
    if(!scan||!scanHash)throw validation('Сначала выполните сравнение текста.');var disposition=value('internalDisposition').value,notes=value('internalNotes').value.trim();
    var decisions=scan.matches.map(function(f,i){var node=body.querySelector('[data-finding="'+i+'"]');return {findingId:f.id,disposition:node.querySelector('select').value,notes:node.querySelector('textarea').value.trim()};});
    if(notes.length<10)throw validation('Добавьте содержательный вывод внутренней проверки.');
    if(disposition==='pass'&&decisions.some(function(d){return !d.findingId||d.disposition!=='explained'||d.notes.length<10;}))throw validation('Положительный результат требует рассмотрения и обоснования каждого совпадения.');
    await saveEvidence('internal_borrowing',{scanHash:scanHash,disposition:disposition,notes:notes,findingDecisions:decisions.filter(function(d){return d.disposition;})});
   });};
   body.querySelector('[data-quality-save-external]').onclick=function(){return run(async function(){
    var expected=captured(),file=value('report').files[0];if(!file||!file.size||file.size>5242880||!/\.pdf$/i.test(file.name))throw validation('Выберите непустой PDF-отчёт до 5 МБ.');
    var req=state.thresholdRequirement;if(!req||!req.text||!req.itemId)throw validation('Условие оригинальности в паспорте не подтверждено.');
    var payload={};['service','checkId','checkedAt'].forEach(function(k){payload[k]=value(k).value.trim();if(!payload[k])throw validation('Заполните систему, номер и дату проверки.');});
    if(value('actualPercent').value==='')throw validation('Укажите результат внешней проверки.');payload.actualPercent=Number(value('actualPercent').value);if(!Number.isFinite(payload.actualPercent)||payload.actualPercent<0||payload.actualPercent>100)throw validation('Процент должен быть от 0 до 100.');
    payload.thresholdMode=req.mode;payload.thresholdPercent=['university_threshold','university_threshold_no_service'].includes(req.mode)?req.thresholdPercent:null;
    payload.thresholdItemId=req.itemId;payload.thresholdBasis=req.text;payload.requirementConfirmed=value('requirementConfirmed').checked;payload.wordBindingConfirmed=value('wordBindingConfirmed').checked;
    if(!payload.requirementConfirmed||!payload.wordBindingConfirmed)throw validation('Подтвердите основание порога и связь PDF с точным Word.');
    payload.disposition=value('externalDisposition').value;payload.notes=value('externalNotes').value.trim();if(payload.notes.length<10)throw validation('Добавьте содержательный вывод по внешнему отчёту.');
    if(payload.disposition==='pass'&&req.mode==='university_threshold_no_service')throw validation('Система проверки не указана в задании: положительная приёмка пока недоступна.');
    if(payload.disposition==='pass'&&req.mode==='university_threshold'&&payload.actualPercent<payload.thresholdPercent)throw validation('Результат ниже требуемого порога. Сохраните замечание, затем доработайте Word.');
    var bytes=new Uint8Array(await file.arrayBuffer());check(expected);if(String.fromCharCode.apply(null,bytes.subarray(0,5))!=='%PDF-')throw validation('Содержимое файла не подтверждает формат PDF.');
    var binary='';for(var i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));payload.reportName=file.name;payload.reportBase64=btoa(binary);
    await saveEvidence('external_originality',payload);
   });};
   body.querySelector('[data-quality-report]').onclick=function(){return run(async function(){
    var expected=captured(),e=state.latest.external_originality;if(!e)throw Error('Нет сохранённого отчёта.');
    var report=await Oblako.requestApi({action:'quality-report',id:options.id,evidenceId:e.id});check(expected);
    if(!report||typeof report.reportBase64!=='string'||!report.reportHash||report.reportHash!==e.reportHash)throw Error('Сохранённый отчёт не подтверждён.');
    var bytes=Uint8Array.from(atob(report.reportBase64),function(c){return c.charCodeAt(0);}),digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest)).map(function(v){return v.toString(16).padStart(2,'0');}).join('');check(expected);
    if(hash!==report.reportHash)throw Error('Контрольная сумма PDF не совпала.');var url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=report.reportName||'Отчёт.pdf';a.click();setTimeout(function(){URL.revokeObjectURL(url);},10000);
   });};
  }
  async function refresh(){
   guard();state=null;notify();var proposed=options.getBinding();if(!proposed){body.innerHTML='';scan=null;scanHash=null;msg.textContent='Нажмите «Начать проверки», чтобы сохранить точную версию Word.';return;}
   var expected=binding(proposed);if(currentBinding&&!equal(currentBinding,expected)){scan=null;scanHash=null;operations={};}currentBinding=expected;
   var result=await Oblako.requestApi({action:'quality-state',id:options.id,versionId:expected.versionId});check(expected);
   if(!result||!equal(result.bindings,expected)||!result.latest||!Array.isArray(result.blockingCodes)||typeof result.eligible!=='boolean')throw Error('Сервер не подтвердил проверки этой версии Word.');
   state=result;verified=true;dirty=false;render();msg.textContent=statusText();notify();
  }
  async function saveEvidence(kind,payload){
   var expected=captured(),signature=JSON.stringify([expected,payload]);if(!operations[kind]||operations[kind].signature!==signature)operations[kind]={id:crypto.randomUUID(),signature:signature};
   var op=operations[kind];state=null;notify();
   var ack=await Oblako.requestApi(Object.assign({action:'quality-save',id:options.id,evidenceId:op.id,kind:kind,payload:payload},expected));check(expected);
   if(!ack||!ack.evidence||ack.evidence.id!==op.id)throw Error('Сохранение проверки не подтверждено. Обновите состояние перед повтором.');
   await refresh();if(!state.latest[kind]||state.latest[kind].id!==op.id)throw Error('Сервер не подтвердил сохранённую проверку.');operations[kind]=null;if(options.onSaved)await options.onSaved();msg.textContent='Проверка сохранена. '+statusText();
  }
  async function run(fn){if(busy)return;busy=true;controls();try{guard();await fn();}catch(e){verified=false;if(!e.qualityValidation)state=null;msg.textContent=e.message||'Проверка не подтверждена. Обновите состояние.';}finally{busy=false;controls();}}
  host.querySelector('[data-quality-start]').onclick=function(){return run(async function(){await options.ensureVersion();guard();await refresh();});};
  host.querySelector('[data-quality-refresh]').onclick=function(){return run(refresh);};
  function changed(){dirty=true;msg.textContent='Есть несохранённые изменения проверки. Сохраните их или обновите проверки, чтобы отменить ввод. Обычная передача недоступна.';notify();}
  body.addEventListener('input',changed);body.addEventListener('change',changed);
  controls();
  return {sync:function(){controls(true);},refresh:async function(){try{await refresh();}catch(e){state=null;msg.textContent=e.message||'Проверки недоступны.';}finally{controls();}},ready:function(){return lastReady;},invalidate:function(){state=null;notify();}};
 }
 global.QualityEvidence={mount:mount};
})(window);
