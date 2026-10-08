import {MAX_CALENDAR_FILE,readCalendarXlsx,parseCalendarSheets,parseCalendarText,previewCalendarImport} from './calendar-import.mjs?v=1';

// CAL-IMPORT-01: this dialog only proposes changes; the host commits atomically.
export function mountCalendarImport(wrap,{getData,getScope,commit,esc,onSaved}){
 const scope=getScope(),body=wrap.querySelector('.sheet-in');
 let parsed=null,preview=null,text='',file=null,busy=false;
 const active=()=>wrap.isConnected&&getScope()===scope;
 const message=value=>{const el=body.querySelector('[data-result]');if(el)el.textContent=value;};
 const heading=title=>'<h3 id="calendar-import-heading">'+title+'</h3>';
 const navigation='<div class="rowbtns"><button type="button" class="btn ghost" data-back>Назад</button><button type="button" class="btn ghost" data-x>Отмена</button></div>';
 wrap.dataset.calendarImport='1';wrap.setAttribute('aria-labelledby','calendar-import-heading');
 function source(){
  busy=false;preview=null;
  body.innerHTML=heading('Учебный график')+
   '<p>Выберите Excel .xlsx или вставьте текст расписания. Перед добавлением вы проверите записи.</p>'+
   '<div class="fld"><label for="calendarFile">Excel .xlsx, до 5 МБ</label><input id="calendarFile" type="file" accept=".xlsx"></div>'+
   '<p data-filename class="muted"></p><button type="button" class="btn ghost" data-clear-file>Убрать файл</button><div class="fld"><label for="calendarText">Текст расписания</label><textarea id="calendarText" rows="5" style="width:100%;box-sizing:border-box" placeholder="Вставьте расписание с датами и временем"></textarea></div>'+
   '<p data-result role="status" aria-live="polite"></p><div class="rowbtns"><button type="button" class="btn" data-check>Проверить</button><button type="button" class="btn ghost" data-x>Отмена</button></div>'+
   '<p class="muted">Выберите один источник: файл или текст. Подготовленная работа остаётся несданной.</p>';
  body.querySelector('#calendarText').value=text;
  if(file)body.querySelector('[data-filename]').textContent='Выбран файл: '+file.name;
  body.querySelector('#calendarFile').addEventListener('change',ev=>{file=ev.target.files[0]||null;body.querySelector('[data-filename]').textContent=file?'Выбран файл: '+file.name:'';});
 }
 const label=e=>esc(e.title)+'<small style="display:block">'+esc(e.date)+' · '+esc(e.time)+(e.endTime?'–'+esc(e.endTime):'')+'</small>';
 function display(){
  preview=previewCalendarImport(getData().events,parsed,file?file.name:'Вставленный текст');
  const warnings=[...(parsed.warnings||[])];
  const entries=[...getData().events,...preview.add];let conflicts=[];
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
   const a=entries[i],b=entries[j],end=e=>e.endTime||/до (\d{2}:\d{2})/.exec(e.note||'')?.[1];
   if(a.kind==='cls'&&b.kind==='cls'&&a.date===b.date&&a.time&&b.time&&end(a)&&end(b)&&a.time<end(b)&&b.time<end(a)&&a.title!==b.title)
    conflicts.push(a.date+' '+a.time+' '+a.title+' / '+b.title);
  }
  body.innerHTML=heading('Проверьте учебный график')+navigation+
   '<p>'+esc(file?file.name:'Вставленный текст')+'</p><p><b>'+parsed.summary.classes+' занятий · '+parsed.summary.actions+' действий</b><br>В действия уже включены '+parsed.summary.tests+' тестов.</p>'+
   '<p>Новых: '+preview.add.length+' · Уже есть: '+preview.skip.length+' · Возможных изменений: '+preview.changes.length+'</p>'+
   (parsed.session?'<p>Сессия: '+esc(parsed.session.from)+' — '+esc(parsed.session.to)+'</p>':'')+
   '<p>Сроки работ и время тестов — план. <b>Подготовлена ≠ сдана.</b></p>'+
   '<div data-records style="max-height:36vh;overflow:auto;overflow-wrap:anywhere;border:1px solid var(--border,#d8e0e8);border-radius:12px;padding:10px">'+
   preview.add.map((e,i)=>'<label style="display:block;padding:8px 0"><input type="checkbox" data-add="'+i+'" checked> '+label(e)+'</label>').join('')+
   preview.changes.map((c,i)=>'<label style="display:block;padding:8px 0"><input type="checkbox" data-update="'+i+'"> '+label(c.event)+'<small>Было: '+esc(c.old.date)+' · '+esc(c.old.time)+'<br>'+esc(c.reason)+'</small></label>').join('')+
   (!preview.add.length&&!preview.changes.length?'<p>Новых записей нет.</p>':'')+'</div>'+
   (preview.issues.length?'<p><b>Нужно исправить источник перед сохранением:</b></p><ul>'+preview.issues.map(x=>'<li>'+esc([x.sheet,x.row?'строка '+x.row:'',x.message,x.title].filter(Boolean).join(' · '))+'</li>').join('')+'</ul>':'')+
   (warnings.length?'<details><summary>Предупреждения: '+warnings.length+'</summary><ul>'+warnings.map(x=>'<li>'+esc(x.sheet+' · строка '+x.row+' · '+x.message)+'</li>').join('')+'</ul></details>':'')+
   (conflicts.length?'<details><summary>Совпадения времени занятий: '+conflicts.length+'</summary><p>Это разные занятия. Они сохраняются; уточните расписание у вуза.</p><ul>'+conflicts.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details>':'')+
   (parsed.ignoredSheets?.length?'<details><summary>Листы без дополнительных событий</summary><p>'+esc(parsed.ignoredSheets.join(', '))+'</p></details>':'')+
   (parsed.ignoredRows?.length?'<details><summary>Примечания без даты: '+parsed.ignoredRows.length+'</summary><ul>'+parsed.ignoredRows.map(x=>'<li>'+esc(x.sheet+' · строка '+x.row+' · '+x.text)+'</li>').join('')+'</ul></details>':'')+
   '<p data-result role="status" aria-live="polite"></p><div class="rowbtns"><button type="button" class="btn" data-commit'+(preview.issues.length?' disabled':'')+'>Добавить выбранные записи</button><button type="button" class="btn ghost" data-x>Отмена</button></div>';
  body.querySelector('[data-back]').focus();
 }
 wrap.addEventListener('click',async ev=>{
  if(ev.target.closest('[data-clear-file]')){file=null;body.querySelector('#calendarFile').value='';body.querySelector('[data-filename]').textContent='';return;}
  if(ev.target.closest('[data-back]')){source();return;}
  if(!active()||busy)return;
  if(ev.target.closest('[data-check]')){
   text=body.querySelector('#calendarText').value;
   if(Boolean(file)===Boolean(text.trim())){message('Выберите один источник: Excel или текст.');return;}
   busy=true;const button=body.querySelector('[data-check]');button.disabled=true;message('Проверяем учебный график…');
   try{
    if(file){if(!/\.xlsx$/i.test(file.name)||file.size>MAX_CALENDAR_FILE)throw Error('Выберите Excel .xlsx размером до 5 МБ.');parsed=parseCalendarSheets(await readCalendarXlsx(new Uint8Array(await file.arrayBuffer())));}
    else parsed=parseCalendarText(text);
    if(!active())return;
    display();
   }catch(error){if(active())message(error.message||'Не удалось прочитать источник.');}
   finally{busy=false;if(button.isConnected)button.disabled=false;}
  }else if(ev.target.closest('[data-commit]')){
   if(!preview||preview.issues.length)return;
   const selected=[...body.querySelectorAll('[data-add]:checked')].map(el=>preview.add[+el.dataset.add]);
   const accepted=[...body.querySelectorAll('[data-update]:checked')].map(el=>preview.changes[+el.dataset.update].oldId);
   if(!selected.length&&!accepted.length){message('Выберите хотя бы одну запись.');return;}
   busy=true;
   try{const result=commit({...preview,add:selected},accepted,scope);wrap.remove();onSaved(result);}
   catch(error){message(error.message||'Не удалось сохранить. Записи не добавлены.');}
   finally{busy=false;}
  }
 });
 source();
}
