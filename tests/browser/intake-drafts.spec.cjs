const {test,expect,webkit}=require('@playwright/test');
const pdf=n=>({name:n+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-'+n)});
const word={name:'Задание.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from([80,75,3,4,1])};
const excel={name:'Расчёты.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from([80,75,3,4,2])};
async function setup(page){
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  window.calls=[];window.failUploads=false;window.loseResponse=false;
  Oblako.mode='cloud';
  Oblako.requestApi=async body=>{
   calls.push({action:body.action,owner:KEY});const key='mock-intake:'+KEY;
   let state=JSON.parse(localStorage.getItem(key)||'null');
   if(!state)state={draft:{id:crypto.randomUUID(),state:'open',revision:1,notes:''},files:[],writes:0};
   if(body.action==='intake-open'){localStorage.setItem(key,JSON.stringify(state));return state;}
   if(body.action==='intake-analyze')return {analysis:{state:window.analysisResult?'done':'disabled'}};
   if(body.action==='intake-analysis-state')return {analysis:window.analysisResult?{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',state:'done',result:window.analysisResult}:{state:'idle'}};
   if(body.action==='intake-confirmation-state'||body.action==='intake-confirmation-save'){
    const rules={};for(const [key,f] of Object.entries(window.analysisResult.fields)){
     if(!['structure','formatting','data','sources'].includes(key))rules['f:'+key]={kind:'field',field:key,required:['t','k','u','n','d','dl'].includes(key)&&!f.values.length||['conflict','needs_review'].includes(f.status)};
     else f.values.forEach((v,index)=>{if(v.condition)rules['c:'+key+':'+index]={kind:'condition',field:key,index,required:true};});
    }
    window.analysisResult.requirements.forEach((v,index)=>{if(v.condition)rules['c:requirement:'+index]={kind:'condition',field:'requirement',index,required:true};});
    if(!state.confirmation)state.confirmation={analysisId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',manifest:'a'.repeat(64),revision:0,answers:{},state:'editing',rules};
    if(body.action==='intake-confirmation-save'){
     if(window.failAnswerWrites)throw Error('Нет сети');
     const same=JSON.stringify(state.confirmation.answers)===JSON.stringify(body.answers)&&state.confirmation.state===(body.confirm?'confirmed':'editing');
     if(body.revision!==state.confirmation.revision&&!same)throw Error('Черновик изменился. Откройте материалы заново');
     if(!same){state.confirmation.revision++;state.confirmation.answers=body.answers;state.confirmation.state=body.confirm?'confirmed':'editing';state.confirmation.savedAt=new Date().toISOString();}
     localStorage.setItem(key,JSON.stringify(state));if(window.loseAnswerResponse)throw Error('Ответ потерян');
    }
    return {confirmation:state.confirmation};
   }
   if(body.action==='intake-upload'){
    if(failUploads)throw Error('Нет сети');
    let file=state.files.find(f=>f.file_hash===body.fileHash);
    if(!file){file={id:crypto.randomUUID(),file_name:body.fileName,content_type:body.contentType,file_hash:body.fileHash,size_bytes:body.sizeBytes,state:'saved',supersedes:body.replacesId||null,roles:[]};state.files.push(file);state.writes++;localStorage.setItem(key,JSON.stringify(state));}
    if(loseResponse)throw Error('Ответ потерян');return {file,duplicate:state.files.some(f=>f.id===file.id)};
   }
   if(body.action==='intake-read'){
    const f=state.files.find(f=>f.id===body.fileId);if(!f)throw Error('missing');
    if(window.failReads){f.read_status='failed';f.read_summary={status:'failed',warnings:[{code:'reading_unavailable',source:{}}]};}
    else{f.read_status=f.file_name.includes('Скан')?'blocked':'ready';f.read_summary={status:f.read_status,summary:{},warnings:f.read_status==='blocked'?[{code:'pdf_image_page',source:{page:2}}]:[]};}
    f.read_version='intake-reader-1';localStorage.setItem(key,JSON.stringify(state));return {reading:f.read_summary};
   }
   throw Error('Unexpected '+body.action);
  };
 });
}
async function open(page){await page.evaluate(()=>{StudIntake.open({api:Oblako.requestApi,openModal,esc,owner:()=>KEY,identity:Oblako.identity});});await expect(page.locator('#intakeFiles')).toBeEnabled();}
async function saved(page,n){await expect(page.locator('[data-intake-download]')).toHaveCount(n);await expect(page.locator('[data-intake-status]')).toContainText('Материалы сохранены');}
test('one choice saves DOCX/PDF/XLSX before work creation; reopening/reload retain originals without publishing',async({page})=>{
 await setup(page);await page.evaluate(()=>{tab='works';render();});
 await page.getByRole('button',{name:'Загрузить материалы',exact:true}).click();await expect(page.locator('#intakeFiles')).toBeEnabled();
 await page.locator('#intakeFiles').setInputFiles([word,pdf('Методичка'),excel]);await saved(page,3);
 await page.locator('[data-intake-dialog] .close').click();await open(page);await saved(page,3);
 await setup(page);await open(page);await saved(page,3);
 expect(await page.evaluate(()=>D.works.length)).toBe(0);
 expect(await page.evaluate(()=>calls.some(c=>['submit','request-publish'].includes(c.action)))).toBe(false);
});
test('failed network keeps bytes on device and retry after reload saves same-purpose documents',async({page})=>{
 await setup(page);await page.evaluate(()=>{failUploads=true;});await open(page);
 await page.locator('#intakeFiles').setInputFiles([pdf('Данные1'),pdf('Данные2')]);
 await expect(page.locator('[data-intake-status]')).toContainText('Часть файлов не передана');
 await expect(page.locator('[data-intake-files]')).toContainText('ожидает передачи');
 await setup(page);await open(page);await saved(page,2);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mock-intake:'+KEY)).writes)).toBe(2);
});
test('lost upload response followed by reopening does not create duplicate file versions',async({page})=>{
 await setup(page);await page.evaluate(()=>{loseResponse=true;});await open(page);
 await page.locator('#intakeFiles').setInputFiles(pdf('Данные'));await expect(page.locator('[data-intake-status]')).toContainText('Часть файлов');
 await setup(page);await open(page);await saved(page,1);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mock-intake:'+KEY)).writes)).toBe(1);
});
test('closing the dialog during a batch retains locally queued files for the next opening',async({page})=>{
 await setup(page);await page.evaluate(()=>{failUploads=true;});await open(page);
 await page.locator('#intakeFiles').setInputFiles([word,pdf('Методичка'),excel]);
 await page.locator('[data-intake-dialog] .close').click();
 await expect.poll(()=>page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('studkab-intake-queue',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const n=await new Promise(resolve=>{const tx=db.transaction('files'),r=tx.objectStore('files').index('owner').count(KEY);r.onsuccess=()=>resolve(r.result);});db.close();return n;
 })).toBe(3);
 await page.evaluate(()=>{failUploads=false;});await open(page);await saved(page,3);
});
test('account switch closes stale window and never uploads the first account queue for the second',async({page})=>{
 await setup(page);await page.evaluate(()=>{cloudSwitchUser('intake-a');failUploads=true;});await open(page);
 await page.locator('#intakeFiles').setInputFiles(pdf('Приватные данные'));await expect(page.locator('[data-intake-status]')).toContainText('Часть файлов');
 await page.evaluate(()=>{window.oldIntake=document.querySelector('[data-intake-dialog]');cloudSwitchUser('intake-b');failUploads=false;});
 await expect(page.locator('[data-intake-dialog]')).toHaveCount(0);await open(page);await saved(page,0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mock-intake:'+KEY)).files.length)).toBe(0);
 await page.evaluate(()=>{cloudSwitchUser('intake-a');});await open(page);await saved(page,1);
});
test('bad formats are explained and names are rendered as text; narrow screen and revisions preserve history',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await open(page);
 await page.locator('#intakeFiles').setInputFiles([{name:'photo.jpg',mimeType:'image/jpeg',buffer:Buffer.from('image')},pdf('<img onerror=alert(1)>')]);
 await expect(page.locator('[data-intake-status]')).toContainText('Не добавлены');await expect(page.locator('[data-intake-download]')).toHaveCount(1);
 expect(await page.locator('[data-intake-files] img').count()).toBe(0);
 await page.locator('[data-intake-replace]').setInputFiles(pdf('Новая версия'));await saved(page,2);
 await expect(page.getByText('Предыдущие версии: 1',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.querySelector('.sheet-in').scrollWidth<=document.querySelector('.sheet-in').clientWidth+1)).toBe(true);
});
test('Safari Word and Excel originals survive network failure and page reload',async()=>{
 const browser=await webkit.launch();try{const page=await browser.newPage();
  await setup(page);await page.evaluate(()=>{failUploads=true;});await open(page);
  await page.locator('#intakeFiles').setInputFiles([word,excel]);await expect(page.locator('[data-intake-status]')).toContainText('Часть файлов');
  await setup(page);await open(page);await saved(page,2);
 }finally{await browser.close();}
});

test('automatic reading shows page-specific blockers and preserves saved originals on failed read and retry',async({page})=>{
 await setup(page);await open(page);await page.locator('#intakeFiles').setInputFiles([word,pdf('Скан')]);await saved(page,2);
 await expect(page.locator('[data-intake-files]')).toContainText('Текст и структура прочитаны');await expect(page.locator('[data-intake-files]')).toContainText('страница 2');
 await page.evaluate(()=>{window.failReads=true;});await page.locator('#intakeFiles').setInputFiles(excel);await saved(page,3);await expect(page.locator('[data-intake-files]')).toContainText('Чтение прервано');
 await page.evaluate(()=>{window.failReads=false;});await page.getByRole('button',{name:'Повторить чтение',exact:true}).click();await saved(page,3);await expect(page.locator('[data-intake-files]')).not.toContainText('Чтение прервано');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mock-intake:'+KEY)).writes)).toBe(3);
 expect(await page.evaluate(()=>calls.some(c=>['submit','request-publish'].includes(c.action)))).toBe(false);
});

test('extracted fields show conflicts and source locations without creating a work; narrow layout escapes document content',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.evaluate(()=>{
  const value=(text,fileName,source)=>({value:text,condition:'',refs:[{fileName,source,quote:text}]});
  window.analysisResult={
   fields:{t:{label:'Тема',status:'conflict',values:[value('<img onerror=alert(1)>','Задание.docx',{paragraph:2}),value('Другая тема','Методичка.pdf',{page:3})]}},
   requirements:[value('Не использовать ИИ','Методичка.pdf',{page:4})]
  };
 });
 await open(page);await page.locator('#intakeFiles').setInputFiles(word);await saved(page,1);
 const box=page.locator('[data-intake-analysis]');await expect(box).toContainText('Найдено в документах');await expect(box).toContainText('Требуется уточнение');await expect(box).toContainText('Другая тема');
 await box.getByText('Источники',{exact:true}).first().click();await expect(box).toContainText('абзац 2');expect(await box.locator('img').count()).toBe(0);
 expect(await page.evaluate(()=>D.works.length)).toBe(0);
 expect(await page.evaluate(()=>document.querySelector('.sheet-in').scrollWidth<=document.querySelector('.sheet-in').clientWidth+1)).toBe(true);
});

async function knownAnalysis(page,questions=false){await page.evaluate(questions=>{
 const fields={};for(const [key,label] of Object.entries({t:'Тема',k:'Вид работы',u:'Вуз',n:'ФИО студента',d:'Предмет',dl:'Срок'}))fields[key]={label,status:'candidate',values:[{value:key==='d'?'Менеджмент':'Сведение '+key,condition:'',refs:[{fileName:'Задание.docx',source:{paragraph:1},quote:'Сведение '+key}]}]};
 if(questions){fields.dl={label:'Срок',status:'missing',values:[]};fields.n.status='conflict';fields.n.values.push({value:'Другое имя',condition:'',refs:[]});}
 window.analysisResult={fields,requirements:questions?[{value:'Использовать метод при наличии данных',condition:'при наличии данных',refs:[{fileName:'Методичка.pdf',source:{page:2},quote:'при наличии данных'}]}]:[]};
 },questions);}
test('short confirmation accepts found facts without retyping; lost response and reload retain one confirmation without sending',async({page})=>{
 await setup(page);await knownAnalysis(page);await open(page);await page.locator('#intakeFiles').setInputFiles(word);await saved(page,1);
 const card=page.locator('[data-intake-confirmation]');await expect(card).toContainText('Менеджмент');await expect(card.locator('[data-answer]:visible')).toHaveCount(0);
 await page.evaluate(()=>{window.loseAnswerResponse=true;});await card.getByRole('button',{name:'Подтвердить сведения',exact:true}).click();await expect(card.locator('[data-answer-status]')).toContainText('Подтверждение сохранено');
 await setup(page);await knownAnalysis(page);await open(page);await expect(page.locator('[data-answer-status]')).toContainText('Сведения подтверждены');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mock-intake:'+KEY)).confirmation.revision)).toBe(1);
 expect(await page.evaluate(()=>D.works.length)).toBe(0);expect(await page.evaluate(()=>calls.some(c=>['submit','request-publish'].includes(c.action)))).toBe(false);
});
test('important answers survive closing during offline edit and resume; unknown is explicit and conditional requirements are preserved',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await knownAnalysis(page,true);await page.evaluate(()=>{window.failAnswerWrites=true;});await open(page);await page.locator('#intakeFiles').setInputFiles(word);await saved(page,1);
 await page.locator('[data-answer="f:n"]').selectOption('custom');await page.locator('[data-custom="f:n"]').fill('<img onerror=alert(1)> Имя');await page.locator('[data-answer="f:dl"]').selectOption('unknown');await page.locator('[data-answer="c:requirement:0"]').selectOption('unknown');
 await expect.poll(()=>page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('studkab-intake-answers',1);r.onsuccess=()=>resolve(r.result);});const r=await new Promise(resolve=>{const tx=db.transaction('answers'),req=tx.objectStore('answers').getAll();req.onsuccess=()=>resolve(req.result);});db.close();return r.some(x=>x.owner===KEY&&x.answers['f:n']?.value==='<img onerror=alert(1)> Имя'&&x.answers['f:dl']?.type==='unknown'&&x.answers['c:requirement:0']?.type==='unknown');})).toBe(true);
 await page.locator('[data-intake-dialog] .close').click();await setup(page);await knownAnalysis(page,true);await open(page);await expect(page.locator('[data-answer-status]')).toContainText('Ответы сохранены в кабинете');await expect(page.locator('[data-custom="f:n"]')).toHaveValue('<img onerror=alert(1)> Имя');await expect(page.locator('[data-answer="f:dl"]')).toHaveValue('unknown');
 await page.getByRole('button',{name:'Подтвердить сведения',exact:true}).click();await expect(page.locator('[data-answer-status]')).toContainText('Сведения подтверждены');expect(await page.locator('[data-intake-confirmation] img').count()).toBe(0);expect(await page.evaluate(()=>document.querySelector('.sheet-in').scrollWidth<=document.querySelector('.sheet-in').clientWidth+1)).toBe(true);
});
test('a second tab cannot silently replace saved answers; conflict shows other values before explicit overwrite',async({page,context})=>{
 await setup(page);await knownAnalysis(page,true);await open(page);await page.locator('#intakeFiles').setInputFiles(word);await saved(page,1);
 const second=await context.newPage();await setup(second);await knownAnalysis(second,true);await open(second);await expect(second.locator('[data-answer="f:n"]')).toBeVisible();
 await page.locator('[data-answer="f:n"]').selectOption('custom');await page.locator('[data-custom="f:n"]').fill('Первая вкладка');await expect(page.locator('[data-answer-status]')).toContainText('Ответы сохранены в кабинете');
 await second.locator('[data-answer="f:n"]').selectOption('custom');await second.locator('[data-custom="f:n"]').fill('Вторая вкладка');await expect(second.locator('[data-answer-conflict]')).toContainText('Первая вкладка');
 expect(await second.evaluate(()=>JSON.parse(localStorage.getItem('mock-intake:'+KEY)).confirmation.answers['f:n'].value)).toBe('Первая вкладка');await second.getByRole('button',{name:'Сохранить мои ответы вместо этих'}).click();await expect(second.locator('[data-answer-status]')).toContainText('Ответы сохранены в кабинете');
 expect(await second.evaluate(()=>JSON.parse(localStorage.getItem('mock-intake:'+KEY)).confirmation.answers['f:n'].value)).toBe('Вторая вкладка');await second.close();
});

test('switching accounts never restores another student confirmation answers',async({page})=>{
 await setup(page);await page.evaluate(()=>{cloudSwitchUser('answers-a');window.failAnswerWrites=true;});await knownAnalysis(page,true);await open(page);await page.locator('#intakeFiles').setInputFiles(word);await saved(page,1);await page.locator('[data-answer="f:n"]').selectOption('custom');await page.locator('[data-custom="f:n"]').fill('Приватный ответ первого студента');
 await page.getByRole('button',{name:'Сохранить ответы',exact:true}).click();await expect(page.locator('[data-answer-status]')).toContainText('Ввод сохранён на устройстве');
 await page.evaluate(()=>{cloudSwitchUser('answers-b');window.failAnswerWrites=false;});await expect(page.locator('[data-intake-dialog]')).toHaveCount(0);await open(page);await page.locator('#intakeFiles').setInputFiles(word);await saved(page,1);await expect(page.locator('[data-intake-confirmation]')).not.toContainText('Приватный ответ первого студента');await expect(page.locator('[data-answer="f:n"]')).toHaveValue('');
});
