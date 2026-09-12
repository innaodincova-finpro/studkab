(function(global){
 'use strict';
 function form(x){
  var p=DraftQuality.inputs(x),fields=[['organization','Организация или объект исследования'],['period','Период исследования'],['requirements','Задание и требования преподавателя'],['materials','Фактические материалы и выдержки из источников'],['sources','Проверенная библиография: по одному источнику в строке, с адресом или страницами']];
  var html='<details><summary>Материалы для подготовки</summary><p class="hint">Заполните один раз. Используйте материалы студента и проверенные источники. Текстовые файлы TXT можно загрузить в поле материалов. Библиографию программа включит в документ без выдуманных дополнений.</p>';
  fields.forEach(function(f){html+='<div class="fld"><label for="draft-'+f[0]+'">'+f[1]+'</label><textarea id="draft-'+f[0]+'" data-draft-input="'+f[0]+'" maxlength="60000" rows="3">'+esc(p[f[0]])+'</textarea></div>';});
  html+='<label>Загрузить текст материалов (.txt)<input type="file" data-material-file accept=".txt,text/plain"></label>';
  if(DraftQuality.financial(x))html+='<div class="fld"><label for="draft-finance">Данные отчётности (тыс. руб.)</label><p class="hint">За 2–5 последовательных лет. Вставьте строки из Excel (столбцы разделены табуляцией) или CSV с точкой с запятой. Пустая ячейка не означает ноль. Балансовые данные — на конец года, выручка и прибыль — за год.</p><p class="hint">Столбцы: '+DraftQuality.headers.join('; ')+'</p><textarea id="draft-finance" data-draft-input="finance" maxlength="60000" rows="5" placeholder="Вставьте фактические значения"></textarea><label>Загрузить CSV<input type="file" data-finance-file accept=".csv,text/csv"></label><p class="hint">Рассчитываются текущая ликвидность, автономия, отношение обязательств к капиталу, чистый оборотный капитал и чистая рентабельность продаж. Для иных расчётов добавьте проверенные расчёты с формулами в материалы. Эти пять показателей не заменяют все требования методички.</p></div>';
  if(DraftQuality.extended(x))html+='<button type="button" class="chip" data-fin-analysis>Рассчитать 20 показателей</button><p class="hint">Расчёт по таблицам в материалах: три отчётных года и начальные остатки. Нейросеть не используется.</p>';
  return html+'</details>';
 }
 function read(w,x){var p=DraftQuality.inputs(x);w.querySelectorAll('[data-draft-input]').forEach(function(el){p[el.dataset.draftInput]=el.value;});x.doc.inputs=p;}
 function bind(w,x,saveInput){
  var fin=w.querySelector('#draft-finance');if(fin)fin.value=DraftQuality.inputs(x).finance;
  w.querySelectorAll('[data-draft-input]').forEach(function(el){el.addEventListener('change',saveInput);});
  [['[data-material-file]','materials'],['[data-finance-file]','finance']].forEach(function(pair){var el=w.querySelector(pair[0]);if(!el)return;el.onchange=async function(){var file=el.files[0];if(!file)return;if(file.size>240000)return toast('Файл слишком большой. Добавьте нужные фрагменты до 60 000 знаков.');var text=await file.text();if(!w.isConnected)return;if(text.length>60000)return toast('Текст превышает 60 000 знаков');w.querySelector('[data-draft-input="'+pair[1]+'"]').value=text;saveInput();};});
 }
 function basis(x){return JSON.stringify([x.topic,DraftQuality.inputs(x),x.doc.order]);}
 function backup(x){
  var d=x.doc,previous=d.previous;
  var copy={order:JSON.parse(JSON.stringify(d.order)),structure:JSON.parse(JSON.stringify(d.structure)),inputs:DraftQuality.inputs(x),basis:d.basis||'',updated:d.updated||''};
  d.previous=copy;
  if(!save()){d.previous=previous;toast('Не удалось сохранить предыдущую версию. Подготовка не запущена.');return false;}return true;
 }
 function restore(x){
  var d=x.doc;if(!d.previous){toast('Предыдущей версии пока нет');return false;}
  if(!confirm('Восстановить предыдущую версию? Текущая версия будет сохранена для обратного переключения.'))return false;
  var old=JSON.parse(JSON.stringify(d.previous));if(!backup(x))return false;old.previous=d.previous;x.doc=old;
  if(!save()){x.doc=d;toast('Не удалось сохранить восстановление');return false;}return true;
 }
 function lock(w,on){w.querySelectorAll('button,input,textarea,select').forEach(function(el){el.disabled=on;});}
 function check(x){
  var errors=DraftQuality.preflight(x).concat(DraftQuality.issues(x.doc),DraftQuality.finAcceptance(x).errors);
  var notes=DraftQuality.editorialNotes(x);
  var notesHtml=notes.length?'<p>Замечания к объёму и повторам:</p><ul>'+notes.map(function(n){return '<li>'+esc(n)+'</li>';}).join('')+'</ul>':'';
  if(x.doc.basis && x.doc.basis!==basis(x))errors.push('Материалы или структура изменились после подготовки');
  var w=openModal('<button type="button" class="close" data-x="1">✕</button><h3>Проверка черновика</h3>'+notesHtml+ (errors.length?'<p>Передача пока недоступна:</p><ul>'+errors.map(function(e){return '<li>'+esc(e)+'</li>';}).join('')+'</ul>':'<p>Автоматическая проверка не обнаружила пустых разделов и известных пометок. Она не подтверждает достоверность исследования.</p><p>Проверьте Word: выводы соответствуют данным, ссылки ведут к использованным источникам, требования преподавателя выполнены.</p><label><input type="checkbox" data-review> Я проверил расчёты, факты, источники, объём и требования</label><button type="button" class="btn" data-approve>Подтвердить проверку</button>')+'<p data-review-status role="status"></p>');
  var data=D,identity=Oblako.identity(),stamp=DraftQuality.stamp(x);w.dataset.accountIdentity=String(identity);
  var b=w.querySelector('[data-approve]');if(b)b.onclick=function(){if(D!==data||Oblako.identity()!==identity||stamp!==DraftQuality.stamp(x))return toast('Документ изменился. Повторите проверку.');if(!w.querySelector('[data-review]').checked)return toast('Подтвердите проверку документа');x.doc.review=stamp;if(save()){w.remove();toast('Проверка подтверждена. Можно передавать черновик.');}else{delete x.doc.review;toast('Подтверждение не сохранено');}};
 }
 global.DraftEditor={form:form,read:read,bind:bind,basis:basis,backup:backup,restore:restore,lock:lock,check:check};
})(window);
