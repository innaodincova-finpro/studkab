const results=document.querySelector('#results');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const check=(value,message)=>{const li=document.createElement('li');li.className=value?'pass':'fail';li.textContent=(value?'PASS — ':'FAIL — ')+message;results.append(li);if(!value)throw new Error(message)};
async function frame(file){let f=document.createElement('iframe');document.querySelector('#frames').replaceChildren(f);await new Promise(r=>{f.onload=r;f.src='/'+file});await delay(250);return f;}
document.querySelector('#run').onclick=async function(){this.disabled=true;results.replaceChildren();try{
for(const file of ['index.html','reestr.html']){
 const isCab=file==='index.html';let f=await frame(file),w=f.contentWindow;
 w.confirm=()=>true;
 check(!!w.D && !!w.Oblako,file+': страница и облачный модуль запущены');
 w.QA.switchUser('qa-a');await delay(350);
 check(w.KEY.endsWith(':user:qa-a'),file+': вход A выбирает отдельное хранилище');
 w.D.settings.name='QA Alice';w.save();await delay(1700);
 check(Object.values(w.QA.rows).some(r=>r.data.settings?.name==='QA Alice'),file+': автосохранение подтверждено');
 const saved=JSON.stringify(w.D); const backup=JSON.parse(saved);
 check(!w.checkBackup(backup),file+': собственная резервная копия проходит проверку');
 backup.settings.name='Restored';check(w.cloudApply(backup),file+': резервная копия применена');
 check(w.D.settings.name==='Restored',file+': восстановлены значения');
 w.QA.failWrite=true;let bad=await w.cloudSave('FALSE SUCCESS');
 check(bad.status==='error'&&!w.document.querySelector('#toast').textContent.includes('FALSE SUCCESS'),file+': отказ записи не показывает успех');
 w.QA.failWrite=false;
 w.QA.switchUser('');await delay(100);w.QA.switchUser('qa-b');await delay(350);
 check(w.D.settings.name!=='Restored' && w.D.settings.name!=='QA Alice',file+': B не видит данные A');
 w.QA.switchUser('qa-a');await delay(350);
 check(w.KEY.endsWith(':user:qa-a'),file+': возврат A');
 w.QA.failRead=true;await w.Oblako.pull();let count=w.QA.writes.length;w.save();await delay(1700);
 check(w.QA.writes.length===count,file+': ошибка чтения блокирует автозапись');
 w.QA.failRead=false;
 const evil=JSON.parse(saved);if(isCab)evil.works=[{id:'"><img onerror=alert(1)>',topic:'x'}];else evil.items=[{id:'"><img onerror=alert(1)>'}];
 check(!!w.checkBackup(evil),file+': опасная копия отвергнута');
 check(w.document.documentElement.scrollWidth<=400,file+': ширина 390 без горизонтального переполнения');
 f.style.width='1200px';await delay(100);check(w.document.documentElement.scrollWidth<=1210,file+': ширина 1200 без переполнения');
 if(isCab){w.openNewWork();let modal=w.document.querySelector('#nTopic');modal.value='Проверка учебного документа';w.document.querySelector('[data-save]').click();check(w.D.works.length>0,'Создание работы через форму');let bytes=w.buildDocx(w.D.works[0]);check(bytes && (bytes.length>100 || bytes.size>100),'Сборка Word из созданной работы');}
}
check(true,'Приёмка завершена');
}catch(e){check(false,'Проверка остановлена: '+e.message)}finally{this.disabled=false}};
