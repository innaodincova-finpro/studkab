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
   if(['intake-submission-state','intake-submit'].includes(body.action)){
    if(state.submission)return {submission:state.submission};
    const c=state.confirmation;if(!c||c.state!=='confirmed')throw Error('Подтвердите актуальную карточку');
    const missing=Object.keys(c.answers).filter(k=>['f:t','f:k','f:u','f:n','f:d','f:dl'].includes(k)&&c.answers[k].type==='unknown');
    const preview={state:'confirmed',analysisId:c.analysisId,revision:c.revision,files:state.files.length,contact:'student@example.invalid',canSubmit:!missing.length&&!window.blockSubmit,error:missing.length?'Заполните перед отправкой: срок':window.blockSubmit?'Материалы изменились':undefined};
    if(body.action==='intake-submission-state')return {submission:preview};
    if(window.failSubmission)throw Error('Нет сети');if(!preview.canSubmit||body.revision!==c.revision)throw Error('Материалы изменились');
    state.submission={submitted:true,ready:true,id:crypto.randomUUID(),number:1,payload:{id:'intake_'+state.draft.id,t:analysisResult.fields.t.values[0].value,k:'Курсовая работа',u:'Учебный вуз',n:'Учебный студент',d:'Менеджмент',dl:'2026-10-30',cn:preview.contact,rq:'',org:'',mn:'',g:'',fc:'',kf:'',ct:'',s:'',pr:'',fo:'',co:''}};state.submissionWrites=(state.submissionWrites||0)+1;localStorage.setItem(key,JSON.stringify(state));
    if(window.loseSubmissionResponse)throw Error('Ответ потерян');return {submission:state.submission};
   }
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
async function saved(page,n){await expect(page.locator('[data-intake-download]')).toHaveCount(n);await expect(page.locator('[data-intake-status]')).toContainText(n?'Материалы сохранены':'Приложите файлы задания');}
test('one choice saves DOCX/PDF/XLSX before work creation; reopening/reload retain originals without publishing',async({page})=>{
 await setup(page);await page.evaluate(()=>{tab='works';render();});
 await page.getByRole('button',{name:'Отправить задание',exact:true}).first().click();await expect(page.locator('#intakeFiles')).toBeEnabled();
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
// ROUTE-03 (05.10.2026): автоматическое чтение, подтверждение карточки и отправка через подтверждение
// из окна убраны; заявка регистрируется по форме — см. tests/browser/intake-receive.spec.cjs.
