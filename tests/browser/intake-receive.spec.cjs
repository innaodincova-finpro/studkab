// ROUTE-03, R3-A: окно «Отправьте задание» и карточка новой заявки в реестре.
const {test,expect}=require('@playwright/test');
async function openSecondary(panel){const details=panel.locator('.r3-secondary');if(await details.count()&&!(await details.evaluate(el=>el.open)))await details.locator('summary').click();}
async function reviewAndDeliver(page,panel){
 await panel.locator('[data-act="r3-result-review"]').click();
 const dialog=page.getByRole('dialog',{name:'Проверка готового файла'});
 await expect(dialog.getByRole('button',{name:'Передать студенту',exact:true})).toBeDisabled();
 await dialog.locator('[data-review-confirm]').check();
 await dialog.getByRole('button',{name:'Передать студенту',exact:true}).click();
}
const DETAILS={k:'Практические задания',d:'Математика',u:'Московский международный университет',kf:'Экономики и управления',pr:'38.03.02 Менеджмент',fo:'Очно-заочная',g:'1 курс, 26Т101а',n:'Иванова Мария Петровна'};
const pdf=n=>({name:n+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-'+n)});
const jpg={name:'Страница учебника.jpg',mimeType:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3])};
async function setup(page,{restored=false,withProfile=false}={}){
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  window.receiptCalls=[];window.receiptInputs=[];Oblako.mode='cloud';
  Oblako.requestApi=async input=>{
   receiptCalls.push(input.action);
   let state=JSON.parse(localStorage.getItem('receipt-fixture:'+KEY)||'null')||{draft:{id:crypto.randomUUID(),state:'open',revision:1,receiptMode:true},files:[]};
   function save(){localStorage.setItem('receipt-fixture:'+KEY,JSON.stringify(state));}
   if(input.action==='intake-open'){save();return state;}
   if(input.action==='intake-upload'){
    if(window.failReceiptUpload)throw Error('Нет сети');
    if(!state.files.some(f=>f.file_hash===input.fileHash)){state.files.push({id:crypto.randomUUID(),file_name:input.fileName,content_type:input.contentType,file_hash:input.fileHash,state:'saved',read_status:'idle',size_bytes:input.sizeBytes});state.draft.revision++;save();}
    return {file:state.files.at(-1)};
   }
   if(input.action==='intake-receive-state')return {submission:state.receipt||{revision:state.draft.revision,files:state.files.length,canReceive:true}};
   if(input.action==='intake-receive'){
    receiptInputs.push(input);
    if(!state.receipt){state.receipt={submitted:true,ready:true,id:crypto.randomUUID(),number:15,payload:{route:'r3',id:'intake_'+state.draft.id,t:'',...input.details,lk:input.link,dl:input.deadline,rq:input.description,cn:'student@example.invalid'}};state.writes=(state.writes||0)+1;save();}
    if(window.loseReceiptReply)throw Error('Ответ потерян');return {submission:state.receipt};
   }
   if(input.action==='intake-link-check'){
    if(!window.cloud)throw Error('Нет сети');
    return {link:window.cloud};
   }
   if(input.action==='intake-link-copy'){
    const f=(window.cloud.files||[]).find(x=>x.path===input.path);if(f.fail)throw Error(f.name+': файл больше 5 МБ');
    if(!state.files.some(x=>x.file_name===f.name)){state.files.push({id:crypto.randomUUID(),file_name:f.name,content_type:'application/pdf',file_hash:f.path.length.toString(16).repeat(64).slice(0,64),state:'saved',size_bytes:10});state.draft.revision++;save();}
    return {file:state.files.at(-1)};
   }
   throw Error('Unexpected API: '+input.action);
  };
 });
 if(withProfile)await page.evaluate(()=>{D.settings.name='Петрова Мария Ивановна';D.settings.univ='АНО ВО «Московский международный университет»';D.settings.kafedra='';D.settings.program='38.03.02 Менеджмент';D.settings.form='очно-заочная';D.settings.course='1';D.settings.group='26Т101а';save();});
 await page.evaluate(w=>StudIntake.open({api:d=>Oblako.requestApi(d),openModal,esc,owner:()=>KEY,identity:Oblako.identity,...(w?{profile:intakeProfile,remember:rememberIntakeProfile}:{}),submitted:s=>{window.lastReceipt=s;}}),withProfile);
 if(restored)await expect(page.locator('#intakeFiles')).toBeDisabled();
 else await expect(page.locator('#intakeFiles')).toBeEnabled();
}
async function fill(page,details=DETAILS){
 for(const [k,v] of Object.entries(details)){const el=page.locator('[data-intake-detail="'+k+'"]');if(await el.evaluate(e=>e.tagName)==='SELECT')await el.selectOption(v);else await el.fill(v);}
}
test('R3-A: files and photo are saved without reading; required details are explained; one receipt carries the title-page details',async({page})=>{
 await setup(page);await page.locator('#intakeFiles').setInputFiles([pdf('Практика1'),jpg]);
 await expect(page.locator('[data-intake-status]')).toContainText('Материалы сохранены: 2');
 await expect(page.locator('[data-intake-files]')).toContainText('фото');
 await page.locator('[data-intake-receive]').click();await expect(page.locator('[data-intake-status]')).toContainText('Заполните: вид работы, дисциплина, вуз');
 await fill(page);await page.locator('[data-intake-receive]').click();await expect(page.locator('[data-intake-status]')).toContainText('Укажите, когда нужна работа');
 expect(await page.evaluate(()=>receiptCalls.includes('intake-receive'))).toBe(false);
 await page.locator('#intakeDeadline').fill('2027-01-25');await page.locator('#intakeDescription').fill('Любые 2 задания');
 await page.evaluate(()=>{const b=document.querySelector('[data-intake-receive]');b.click();b.click();});
 await expect(page.locator('[data-intake-status]')).toContainText('Заявка №15 отправлена');
 await expect(page.locator('[data-intake-receive]')).toBeDisabled();await expect(page.locator('#intakeFiles')).toBeDisabled();
 const sent=await page.evaluate(()=>receiptInputs);expect(sent.length).toBe(1);
 expect(sent[0].details).toMatchObject(DETAILS);expect(sent[0].link).toBe('');expect(sent[0].deadline).toBe('2027-01-25');expect(sent[0].description).toBe('Любые 2 задания');
 expect(await page.evaluate(()=>receiptCalls.some(a=>['intake-read','intake-analyze','intake-confirmation-save'].includes(a)))).toBe(false);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('receipt-fixture:'+KEY)).writes)).toBe(1);
});
test('R3-A: link instead of files — only listed cloud services are accepted',async({page})=>{
 await setup(page);await fill(page);await page.locator('#intakeDeadline').fill('2027-01-25');
 await page.locator('[data-intake-receive]').click();await expect(page.locator('[data-intake-status]')).toContainText('Приложите файлы задания или ссылку');
 await page.locator('#intakeLink').fill('https://example.com/folder');await page.locator('[data-intake-receive]').click();
 await expect(page.locator('[data-intake-status]')).toContainText('Яндекс Диск, Google Диск или Облако Mail.ru');
 await page.locator('#intakeLink').fill('https://disk.yandex.ru/d/Mt7abc');await page.locator('[data-intake-receive]').click();
 await expect(page.locator('[data-intake-status]')).toContainText('Заявка №15 отправлена');
 expect(await page.evaluate(()=>receiptInputs[0].link)).toBe('https://disk.yandex.ru/d/Mt7abc');
});
test('R3-A: entered details survive closing the window; pending file blocks sending; lost reply/reopen restores one receipt',async({page})=>{
 await setup(page);await fill(page);await page.locator('#intakeDeadline').fill('2027-01-25');
 await page.locator('[data-intake-dialog] .close').click();
 await page.evaluate(()=>StudIntake.open({api:d=>Oblako.requestApi(d),openModal,esc,owner:()=>KEY,identity:Oblako.identity}));
 await expect(page.locator('[data-intake-detail="n"]')).toHaveValue(DETAILS.n);await expect(page.locator('[data-intake-detail="fo"]')).toHaveValue(DETAILS.fo);
 await page.evaluate(()=>window.failReceiptUpload=true);
 await page.locator('#intakeFiles').setInputFiles(pdf('Задание'));
 await expect(page.locator('[data-intake-status]')).toContainText('Часть файлов');await expect(page.locator('[data-intake-receive]')).toBeDisabled();await expect(page.locator('[data-intake-retry]')).toBeVisible();
 await page.evaluate(()=>{window.failReceiptUpload=false;window.loseReceiptReply=true;});
 await page.locator('[data-intake-retry]').click();await expect(page.locator('[data-intake-receive]')).toBeEnabled();
 await page.locator('[data-intake-receive]').click();await expect(page.locator('[data-intake-status]')).toContainText('Заявка №15 отправлена');
 await setup(page,{restored:true});await expect(page.locator('[data-intake-status]')).toContainText('уже отправлена');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('receipt-fixture:'+KEY)).writes)).toBe(1);
});
test('R3-A: a large photo is reduced to JPEG under 5 MB; narrow screen has no horizontal scroll',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 const r=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=3000;c.height=2200;const x=c.getContext('2d'),img=x.createImageData(3000,2200);
  for(let i=0;i<img.data.length;i++)img.data[i]=(i*2654435761)>>>24;x.putImageData(img,0,0);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));const file=new File([blob],'Снимок.png',{type:'image/png'});
  const out=await StudFilePrep.prepare(file);return {before:file.size,name:out.name,type:out.type,size:out.size};
 });
 expect(r.before).toBeGreaterThan(1572864);expect(r.type).toBe('image/jpeg');expect(r.name).toBe('Снимок.jpg');expect(r.size).toBeLessThanOrEqual(5242880);
 expect(await page.evaluate(()=>document.querySelector('.sheet-in').scrollWidth<=document.querySelector('.sheet-in').clientWidth+1)).toBe(true);
});
test('R3-A: registry card shows title-page details and materials, opens no study and no passport',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 const r=await page.evaluate(async()=>{
  window.cardCalls=[];
  Oblako.requestApi=async d=>{cardCalls.push(d.action);
   if(d.action==='material-revision-state')return {materials:{state:'initial',requestRevision:3}};
   if(d.action==='attachment-context')return {attachments:[{id:'a1',category:'unclassified',file_name:'Практика1.pdf',content_type:'application/pdf',size_bytes:2048,file_hash:'a'.repeat(64)},{id:'a2',category:'unclassified',file_name:'Страница.jpg',content_type:'image/jpeg',size_bytes:4096,file_hash:'b'.repeat(64)}],materialRevision:3};
   if(d.action==='clarification-list')return {questions:[]};
   if(d.action==='r3-state')return {work:{takenAt:null,result:null,delivered:null,downloadedAt:null}};
   throw Error('Unexpected '+d.action);};
  const x=fromPayload({id:'r3-card',route:'r3',t:'',k:'Практические задания',d:'Математика',u:'Московский международный университет',kf:'Экономики и управления',pr:'38.03.02 Менеджмент',fo:'Очно-заочная',g:'1 курс, 26Т101а',n:'Иванова Мария Петровна',s:'',lk:'https://disk.yandex.ru/d/Mt7abc',dl:'2027-01-25',rq:'Любые 2 задания',cn:'student@example.invalid'});x.requestNumber=15;
  D.items=[x];openId=x.id;render();
  return {topic:x.topic,bucket:stageBucket(x),copy:r3TitleText(x)};
 });
 expect(r.topic).toBe('Математика — практические задания');expect(r.bucket).toBe('new');
 expect(r.copy).toContain('Дисциплина: Математика');expect(r.copy).toContain('Преподаватель: не указано');
 await expect(page.locator('.request-action')).toContainText('Новая заявка');
 await expect(page.locator('.request-action [data-act="claude-queue"]')).toHaveText('Сохранить для Claude через чат');await expect(page.locator('.request-action [data-act="r3-take"]')).toHaveText('Взять в работу самостоятельно');
 await expect(page.locator('.request-action [data-act="r3-bundle"]')).toHaveText('Скачать задание (архив)');
 await expect(page.locator('#request-panel-overview')).toContainText('Курс и группа');await expect(page.locator('#request-panel-overview')).toContainText('26Т101а');
 await expect(page.locator('#request-panel-overview a[href="https://disk.yandex.ru/d/Mt7abc"]')).toHaveAttribute('rel','noopener noreferrer');
 await page.locator('#request-tab-materials').click();
 await expect(page.locator('#request-panel-materials')).toContainText('Фото · 4 КБ');
 expect(await page.evaluate(()=>cardCalls.some(a=>/passport|registered-study/.test(a)))).toBe(false);
});
test('R3-B: Yandex folder is checked and its files are copied into the request; closed link blocks sending',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{window.cloud={state:'closed',service:'yandex'};});
 await page.locator('#intakeLink').fill('https://disk.yandex.ru/d/Mt7abc');await page.locator('#intakeLink').blur();
 await expect(page.locator('[data-intake-link-status]')).toContainText('Ссылка закрыта');
 await fill(page);await page.locator('#intakeDeadline').fill('2027-01-25');await page.locator('[data-intake-receive]').click();
 await expect(page.locator('[data-intake-status]')).toContainText('Ссылка закрыта');
 expect(await page.evaluate(()=>receiptCalls.includes('intake-receive'))).toBe(false);
 await page.evaluate(()=>{window.cloud={state:'open',service:'yandex',folders:1,files:[{name:'Практика1.pdf',path:'/Практика1.pdf'},{name:'Практика2.pdf',path:'/Практика2.pdf'},{name:'Большой.pdf',path:'/Большой.pdf',fail:true}]};});
 await page.locator('#intakeLink').fill('https://disk.yandex.ru/d/Mt7abc2');await page.locator('#intakeLink').blur();
 await expect(page.locator('[data-intake-link-status]')).toContainText('скопировано в заявку: 2 из 3');
 await expect(page.locator('[data-intake-link-status]')).toContainText('Большой.pdf: файл больше 5 МБ');
 await expect(page.locator('[data-intake-link-status]')).toContainText('Вложенные папки');
 await expect(page.locator('[data-intake-download]')).toHaveCount(2);
 await page.locator('[data-intake-receive]').click();await expect(page.locator('[data-intake-status]')).toContainText('Заявка №15 отправлена');
 expect(await page.evaluate(()=>receiptInputs[0].link)).toBe('https://disk.yandex.ru/d/Mt7abc2');
});
test('R3-B: Google Drive link is checked without copying; failed check does not block sending',async({page})=>{
 await setup(page);await page.evaluate(()=>{window.cloud={state:'open',service:'google'};});
 await page.locator('#intakeLink').fill('https://drive.google.com/drive/folders/1AbC');await page.locator('#intakeLink').blur();
 await expect(page.locator('[data-intake-link-status]')).toContainText('С этого облака копию сделать нельзя');
 expect(await page.evaluate(()=>receiptCalls.includes('intake-link-copy'))).toBe(false);
 await page.evaluate(()=>{window.cloud=null;});
 await page.locator('#intakeLink').fill('https://cloud.mail.ru/public/x/y');await page.locator('#intakeLink').blur();
 await expect(page.locator('[data-intake-link-status]')).toContainText('Не удалось проверить ссылку');
 await fill(page);await page.locator('#intakeDeadline').fill('2027-01-25');await page.locator('[data-intake-receive]').click();
 await expect(page.locator('[data-intake-status]')).toContainText('Заявка №15 отправлена');
});
// ROUTE-03, R3-C: работа исполнителя в реестре и готовая работа у студента.
test('R3-C: registry card — take, attach result, deliver; new file must be delivered again',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  window.r3={takenAt:null,result:null,delivered:null,downloadedAt:null};window.r3Calls=[];
  Oblako.requestApi=async d=>{r3Calls.push(d.action);
   if(d.action==='material-revision-state')return {materials:{state:'initial',requestRevision:3}};
   if(d.action==='attachment-context')return {attachments:[{id:'a1',category:'unclassified',file_name:'Практика1.pdf',content_type:'application/pdf',size_bytes:2048,file_hash:'a'.repeat(64)}],materialRevision:3};
   if(d.action==='clarification-list')return {questions:[]};
   if(d.action==='r3-state')return {work:structuredClone(r3)};
   if(d.action==='r3-take'){r3.takenAt=r3.takenAt||'2026-10-05T07:40:00Z';return {work:structuredClone(r3)};}
   if(d.action==='r3-result-upload'){r3.result={name:d.fileName,size:d.sizeBytes,at:'2026-10-06T15:12:00Z',hash:d.fileHash};return {work:structuredClone(r3)};}
   if(d.action==='r3-deliver'){if(d.fileHash!==r3.result.hash)throw Error('changed');r3.delivered={name:r3.result.name,size:r3.result.size,at:'2026-10-06T15:15:00Z',hash:r3.result.hash};return {work:structuredClone(r3)};}
   throw Error('Unexpected '+d.action);};
  const x=fromPayload({id:'r3-work',route:'r3',t:'',k:'Практические задания',d:'Математика',u:'ММУ',fo:'Очно-заочная',g:'1 курс, 26Т101а',n:'Иванова Мария Петровна',dl:'2027-01-25',cn:'student@example.invalid'});x.requestNumber=15;
  D.items=[x];openId=x.id;render();
 });
 const panel=page.locator('.request-action');
 await expect(panel).toContainText('Новая заявка');
 await openSecondary(panel);await expect(panel.locator('[data-act="r3-bundle"]')).toBeVisible();await expect(panel.locator('[data-act="registered-study"]')).toHaveCount(0);
 await panel.locator('[data-act="r3-take"]').click();
 await expect(panel).toContainText('Выберите способ подготовки или выполните работу самостоятельно.');
 await expect(panel.locator('[data-act="r3-result-review"]')).toHaveCount(0);
 await panel.locator('input[data-r3-result-file]').setInputFiles({name:'Иванова_Математика.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from([80,75,3,4,9])});
 await expect(panel).toContainText('Иванова Математика.docx');
 await reviewAndDeliver(page,panel);
 await expect(panel).toContainText('Работа передана студенту');await expect(panel).toContainText('Студент ещё не скачал работу');
 await expect(panel.locator('[data-act="r3-result-review"]')).toHaveCount(0);
 await panel.locator('input[data-r3-result-file]').setInputFiles({name:'Версия2.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-2')});
 await expect(panel.locator('[data-act="r3-result-review"]')).toHaveText('Проверить новую версию');
 expect(await page.evaluate(()=>stageBucket(D.items[0]))).toBe('delivered');
});
test('R3-C: «Скачать всё» builds one archive with the student files and the title-page details',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>QA.switchUser('archive-route-synthetic'));
 await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);
 const names=await page.evaluate(async()=>{
  window.fetch=async u=>new Response(String(u).endsWith('a1')?'%PDF-one':'jpeg-two');
  Oblako.requestApi=async d=>{if(d.action==='attachment-download')return {url:'https://storage.example/'+d.attachmentId};throw Error('Unexpected '+d.action);};
  const x=fromPayload({id:'r3-zip',route:'r3',t:'',k:'Практические задания',d:'Математика',u:'ММУ',fo:'Очно-заочная',g:'26Т101а',n:'Иванова М.П.',dl:'2027-01-25',rq:'Любые 2',lk:'https://disk.yandex.ru/d/x',cn:'s@e'});
  x.requestNumber=15;x.attachments=[];
  for(const [id,text] of [['a1','%PDF-one'],['a2','jpeg-two']]){
   const bytes=new TextEncoder().encode(text),file_hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
   x.attachments.push({id,file_name:'Задание.pdf',size_bytes:bytes.length,file_hash});
  }
  D.items=[x];
  let blob;const real=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return 'blob:x';};
  await r3Bundle(x);URL.createObjectURL=real;
  const bytes=new Uint8Array(await blob.arrayBuffer()),dec=new TextDecoder(),out=[];
  for(let i=0;i<bytes.length-4;i++)if(bytes[i]===0x50&&bytes[i+1]===0x4b&&bytes[i+2]===1&&bytes[i+3]===2){const n=bytes[i+28]|(bytes[i+29]<<8);out.push(dec.decode(bytes.slice(i+46,i+46+n)));}
  const text=dec.decode(bytes);return {out,hasInfo:text.includes('Дисциплина: Математика')&&text.includes('https://disk.yandex.ru/d/x')};
 });
 expect(names.out).toEqual(['Задание.pdf','Задание (2).pdf','Сведения для титульного листа.txt','Перечень оригиналов.json']);expect(names.hasInfo).toBe(true);
});
test('R3-C: student sees «Работа готова» with one download button; the old result block is hidden',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  Oblako.mode='cloud';window.dl=[];window.opened=[];HTMLAnchorElement.prototype.click=function(){opened.push(this.download);};
  Oblako.requestApi=async d=>{
   if(d.action==='student-progress')return {stage:'r3_ready',openQuestions:0,route:'r3',result:{name:'Иванова_Математика.docx',size:49152,at:'2026-10-06T15:15:00Z',downloadedAt:null}};
   if(d.action==='r3-download'){dl.push(d.id);return {url:new URL('/storage/v1/object/sign/x?token=t',OBLAKO_CONFIG.url).href,fileName:'Иванова_Математика.docx'};}
   if(d.action==='clarification-unread')return {question:0};
   throw Error('Unexpected '+d.action);};
  change(function(){D.works.push({id:'w-r3',topic:'Математика — практические задания',created:today(),deadline:'2027-01-25',status:'draft',format:{workType:'Практические задания',discipline:'Математика'},structure:emptyStructure(),tasks:[],req:{id:'intake_x',serverId:'11111111-1111-4111-8111-111111111111',number:15}});});
  tab='works';openWorkId='w-r3';render();
 });
 await expect(page.locator('[data-student-progress]')).toHaveText('Работа готова.');
 await expect(page.locator('[data-r3-ready]')).toContainText('Иванова Математика.docx · 48 КБ');
 // Replacing the view must mount the same confirmed file while a new read
 // is still pending; equal responses must not leave the route empty.
 await page.evaluate(()=>{
  const api=Oblako.requestApi;Oblako.requestApi=d=>d.action==='student-progress'?new Promise(()=>{}):api(d);render();
 });
 await expect(page.locator('[data-r3-ready]')).toContainText('Иванова Математика.docx · 48 КБ');
 await expect(page.locator('[data-legacy-result]')).toBeHidden();
 await page.locator('[data-act="r3-download"]').click();
 await expect.poll(()=>page.evaluate(()=>opened)).toEqual(['Иванова_Математика.docx']);expect(await page.evaluate(()=>dl)).toEqual(['11111111-1111-4111-8111-111111111111']);
});
test('R3-D: registry shows hand-in, then the return with remarks; corrected file is delivered as a new version',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  const v1={name:'Иванова_26Т101а_Математика_Практические_задания.docx',size:49152,at:'2026-10-06T15:15:00Z',hash:'a'.repeat(64)};
  window.r3={takenAt:'2026-10-05T07:40:00Z',result:{...v1,at:'2026-10-06T15:12:00Z'},delivered:v1,downloadedAt:'2026-10-07T09:00:00Z',handedAt:'2026-10-08T08:30:00Z',returns:0,returnedAt:null,versions:[{n:1,name:v1.name,size:v1.size,at:v1.at}],returnList:[],pendingFiles:[]};
  window.r3Calls=[];
  Oblako.requestApi=async d=>{r3Calls.push(d.action+(d.fileId?':'+d.fileId:''));
   if(d.action==='material-revision-state')return {materials:{state:'initial',requestRevision:3}};
   if(d.action==='attachment-context')return {attachments:[],materialRevision:3};
   if(d.action==='clarification-list')return {questions:[]};
   if(d.action==='r3-state')return {work:structuredClone(r3)};
   if(d.action==='r3-return-file-download')return {url:'about:blank',fileName:'Замечания.jpg'};
   if(d.action==='r3-result-upload'){r3.result={name:d.fileName,size:d.sizeBytes,at:'2026-10-09T17:05:00Z',hash:d.fileHash};return {work:structuredClone(r3)};}
   if(d.action==='r3-deliver'){r3.delivered={...r3.result,at:'2026-10-09T17:10:00Z'};r3.returnedAt=null;r3.handedAt=null;r3.downloadedAt=null;r3.versions.push({n:2,name:r3.result.name,size:r3.result.size,at:r3.delivered.at});return {work:structuredClone(r3)};}
   throw Error('Unexpected '+d.action);};
  window.open=()=>null;
  const x=fromPayload({id:'r3-d',route:'r3',t:'',k:'Практические задания',d:'Математика',u:'ММУ',fo:'Очно-заочная',g:'1 курс, 26Т101а',n:'Иванова Мария Петровна',dl:'2027-01-25',cn:'student@example.invalid'});x.requestNumber=15;
  D.items=[x];openId=x.id;render();
 });
 const panel=page.locator('.request-action');
 await expect(panel).toContainText('Студент отметил сдачу');await expect(panel).toContainText('Шаг 5 из 5');
 expect(await page.evaluate(()=>stageBucket(D.items[0]))).toBe('delivered');
 // Длинное имя файла не выходит за край карточки.
 expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.evaluate(()=>{const x=D.items[0];Object.assign(r3,{handedAt:null,returns:1,returnedAt:'2026-10-09T06:00:00Z',returnList:[{n:1,comment:'Задание 3: показать решение подробно.',at:'2026-10-09T06:00:00Z',files:[{id:'f1',name:'Замечания.jpg',size:819200,type:'image/jpeg'}]}]});x.r3=structuredClone(r3);render();});
 await expect(panel).toContainText('Шаг 3 из 5 · Работа возвращена на доработку · доработка № 1');await expect(panel).toContainText('Работу вернули на доработку');
 await expect(panel.locator('.r3-quote')).toContainText('Задание 3: показать решение подробно.');
 await expect(panel).toContainText('Версия 1 передана');await expect(panel).toContainText('Прикрепите исправленную работу');
 expect(await page.evaluate(()=>stageBucket(D.items[0]))).toBe('new');
 await panel.locator('[data-act="r3-return-file-download"]').click();
 await expect.poll(()=>page.evaluate(()=>r3Calls.includes('r3-return-file-download:f1'))).toBe(true);
 await panel.locator('input[data-r3-result-file]').setInputFiles({name:'Исправленная.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 v2')});
 await expect(panel.locator('[data-act="r3-result-review"]')).toHaveText('Проверить новую версию');
 expect(await page.evaluate(()=>stageBucket(D.items[0]))).toBe('preparation');
 await reviewAndDeliver(page,panel);
 await expect(panel).toContainText('Работа передана студенту');await expect(page.locator('.r3head')).toContainText('Возвратов на доработку: 1');
});
test('R3-D: student hands in, then sends the teacher remarks with a photo; the card shows the rework',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  Oblako.mode='cloud';window.calls=[];window.st={stage:'r3_ready',openQuestions:0,route:'r3',returns:0,result:{name:'Иванова_Математика.docx',size:49152,at:'2026-10-06T15:15:00Z',downloadedAt:'2026-10-07T09:00:00Z',handedAt:null}};window.pending=[];
  Oblako.requestApi=async d=>{calls.push(d);
   if(d.action==='student-progress')return structuredClone(st);
   if(d.action==='assistant-state')return {job:null};
   if(d.action==='clarification-unread')return {question:0};
   if(d.action==='r3-hand'){st.stage='r3_handed';st.result.handedAt='2026-10-08T08:30:00Z';return {work:{}};}
   if(d.action==='r3-state')return {work:{pendingFiles:pending}};
   if(d.action==='r3-return-upload'){pending.push({id:'p'+pending.length,name:d.fileName,size:d.sizeBytes,type:d.contentType});return {work:{pendingFiles:pending},fileId:'p0'};}
   if(d.action==='r3-return-file-remove'){pending=pending.filter(f=>f.id!==d.fileId);return {work:{pendingFiles:pending}};}
   if(d.action==='r3-return'){st={stage:'r3_in_work',openQuestions:0,route:'r3',returns:1,lastReturn:{n:1,comment:d.comment,at:'2026-10-09T06:00:00Z',files:pending.map(f=>f.name)}};return {work:{},n:1};}
   throw Error('Unexpected '+d.action);};
  change(function(){D.works.push({id:'w-r3',topic:'Математика — практические задания',created:today(),deadline:'2027-01-25',status:'draft',format:{workType:'Практические задания',discipline:'Математика'},structure:emptyStructure(),tasks:[],req:{id:'intake_x',serverId:'11111111-1111-4111-8111-111111111111',number:15}});});
  tab='works';openWorkId='w-r3';render();
 });
 const box=page.locator('[data-r3-ready]');
 await expect(box).toContainText('Сдайте работу преподавателю');
 await box.locator('[data-act="r3-hand"]').click();
 await expect(box).toContainText('Работа сдана');await expect(page.locator('[data-student-progress]')).toHaveText('Работа сдана.');
 await box.locator('[data-act="r3-return-open"]').click();
 await box.locator('[data-act="r3-return-send"]').click();
 await expect(box.locator('[data-r3-form-status]')).toHaveText('Напишите, что сказал преподаватель.');
 await box.locator('[data-r3-comment]').fill('Задание 3: показать решение подробно.');
 await box.locator('input[data-r3-return-file]').setInputFiles([{name:'Замечания.png',mimeType:'image/png',buffer:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])},{name:'Лишний.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')}]);
 await expect(box.locator('.r3-files li')).toHaveCount(2);
 // Набранный текст сохраняется, пока форма перерисовывается.
 await expect(box.locator('[data-r3-comment]')).toHaveValue('Задание 3: показать решение подробно.');
 await box.locator('[data-act="r3-return-file-remove"]').nth(1).click();
 await expect(box.locator('.r3-files li')).toHaveCount(1);
 await box.locator('[data-act="r3-return-send"]').click();
 await expect(box).toContainText('Работа возвращена на доработку');await expect(box).toContainText('доработка № 1');await expect(box).toContainText('Приложено: Замечания.png');
 await expect(page.locator('[data-student-progress]')).toHaveText('Работа возвращена на доработку');
 expect(await page.evaluate(()=>calls.find(c=>c.action==='r3-return').comment)).toBe('Задание 3: показать решение подробно.');
});
test('R3-E1: the work page shows the five-step route; passed steps fold into one line on a phone',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  Oblako.mode='cloud';window.st={stage:'r3_received',openQuestions:0,route:'r3',returns:0};
  Oblako.requestApi=async d=>{if(d.action==='student-progress')return structuredClone(st);if(d.action==='clarification-unread')return {question:0};throw Error('Unexpected '+d.action);};
  // Работа без отметки маршрута (созданная до этой версии) переключается на маршрут по ответу сервера.
  change(function(){D.works.push({id:'w-r3',topic:'Математика — практические задания',created:today(),deadline:'2027-01-25',status:'draft',format:{workType:'Практические задания',discipline:'Математика'},structure:emptyStructure(),tasks:[],req:{id:'intake_x',serverId:'11111111-1111-4111-8111-111111111111',number:15,sent:'2026-10-05'}});});
  tab='works';openWorkId='w-r3';render();
 });
 const route=page.locator('[data-r3-route]');
 await expect(route.locator('.r3s.cur')).toContainText('Шаг 2 из 5 · Вопросы');await expect(route.locator('.r3s.cur')).toContainText('Задание получено');
 await expect(route.locator('.r3s.fut')).toHaveCount(3);await expect(route.locator('.r3passed')).toContainText('Пройдено: Задание');
 await expect(route.locator('.r3s.done').first()).toBeHidden();
 expect(await page.evaluate(()=>work('w-r3').req.route)).toBe('r3');
 await expect(page.locator('#fab')).toBeHidden();
 await page.evaluate(()=>{st={stage:'needs_answer',openQuestions:2,route:'r3',returns:0};refreshStudentProgress();});
 await expect(route.locator('.r3s.cur')).toContainText('Ответьте на вопрос по заданию');await expect(route.locator('[data-act="student-clarifications"]')).toBeVisible();
 await page.evaluate(()=>{st={stage:'r3_in_work',openQuestions:0,route:'r3',returns:0};refreshStudentProgress();});
 await expect(route.locator('.r3s.cur')).toContainText('Шаг 3 из 5 · В работе');await expect(route.locator('.r3passed')).toContainText('Задание, Вопросы');
 await page.setViewportSize({width:1280,height:900});
 await expect(route.locator('.r3s.done')).toHaveCount(2);await expect(route.locator('.r3s.done').first()).toBeVisible();await expect(route.locator('.r3passed')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('R3-E2: home shows one card per form request with the route strip and one action; the works list shows the step',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  Oblako.mode='cloud';window.calls=[];
  const st={'11111111-1111-4111-8111-111111111111':{stage:'needs_answer',openQuestions:2,route:'r3',returns:0},'22222222-2222-4222-8222-222222222222':{stage:'r3_ready',openQuestions:0,route:'r3',returns:0,result:{name:'Работа.docx',size:49152,at:'2026-10-06T15:15:00Z',downloadedAt:null,handedAt:null}},'33333333-3333-4333-8333-333333333333':{stage:'r3_in_work',openQuestions:0,route:'r3',returns:0}};
  Oblako.requestApi=async d=>{calls.push(d.action+':'+d.id);if(d.action==='student-progress')return st[d.id];if(d.action==='clarification-unread')return {question:0};throw Error('Unexpected '+d.action);};
  const base=(id,topic,dl,sid,n,extra)=>({id,topic,created:today(),deadline:dl,status:'draft',format:{workType:'Работа'},structure:emptyStructure(),tasks:[],req:{id:'i'+n,serverId:sid,number:n,sent:'2026-10-05',...extra}});
  change(function(){
   D.works.push(base('w-1','Математика — практические задания','2027-01-25','11111111-1111-4111-8111-111111111111',15,{route:'r3',intake:true}));
   D.works.push(base('w-2','Экономика — контрольная работа','2026-12-20','22222222-2222-4222-8222-222222222222',16,{route:'r3',intake:true}));
   // Работа из формы без отметки маршрута — маршрут определяется по ответу сервера.
   D.works.push(base('w-3','История — реферат','2026-12-01','33333333-3333-4333-8333-333333333333',17,{intake:true}));
   D.works.push({id:'w-own',topic:'Своя курсовая',created:today(),deadline:'2026-11-30',status:'draft',format:{workType:'Курсовая'},structure:emptyStructure(),tasks:[]});
  });
  tab='today';openWorkId=null;render();
 });
 await expect(page.locator('[data-r3-home]')).toHaveCount(3);
 const econ=page.locator('[data-r3-home="w-2"]');
 await expect(econ.locator('.r3strip li.cur')).toContainText('Готово');await expect(econ.locator('[data-act="r3-download"]')).toHaveText('Скачать работу');
 const math=page.locator('[data-r3-home="w-1"]');
 await expect(math.locator('[data-act="student-clarifications"]')).toHaveText('Ответить на вопросы');
 await expect(page.locator('[data-r3-home="w-3"] .r3strip li.cur')).toContainText('В работе');
 expect(await page.evaluate(()=>work('w-3').req.route)).toBe('r3');
 // «Ближайшая сдача» показывает только работу без заявки по форме.
 await expect(page.locator('.card.now')).toContainText('Своя курсовая');
 // Кнопка «Отправить задание» — в приветствии, плавающая на главной скрыта.
 await expect(page.locator('.greeting [data-act="intake-materials"]')).toBeVisible();await expect(page.locator('#fab')).toBeHidden();
 await page.evaluate(()=>{tab='works';render();});
 await expect(page.locator('[data-r3-row="w-1"]')).toContainText('Шаг 2 из 5 · Ответьте на вопрос по заданию');
 await expect(page.locator('[data-r3-row="w-2"]')).toContainText('Шаг 4 из 5 · Работа готова');
 // Повторный показ не дёргает сервер чаще раза в 30 секунд.
 const before=await page.evaluate(()=>calls.length);await page.evaluate(()=>{tab='today';render();});await page.waitForTimeout(300);
 expect(await page.evaluate(()=>calls.length)).toBe(before);
});
test('R3-E3: registry card shows the route on the left and title-page details on the right; tabs and history work',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  const v1={name:'Работа.docx',size:49152,at:'2026-10-06T15:15:00Z',hash:'a'.repeat(64)};
  window.r3={takenAt:'2026-10-05T07:40:00Z',result:{...v1,at:'2026-10-06T15:12:00Z'},delivered:v1,downloadedAt:'2026-10-07T09:00:00Z',handedAt:null,returns:1,returnedAt:'2026-10-09T06:00:00Z',versions:[{n:1,name:v1.name,size:v1.size,at:v1.at}],returnList:[{n:1,comment:'Задание 3 подробно.',at:'2026-10-09T06:00:00Z',files:[]}]};
  window.qcalls=0;
  Oblako.requestApi=async d=>{if(d.action==='material-revision-state')return {materials:{state:'initial',requestRevision:3}};if(d.action==='attachment-context')return {attachments:[{id:'a1',category:'unclassified',file_name:'Практика1.pdf',content_type:'application/pdf',size_bytes:2048,file_hash:'a'.repeat(64)}],materialRevision:3};if(d.action==='clarification-list'){qcalls++;return {questions:[]};}if(d.action==='r3-state')return {work:structuredClone(r3)};throw Error('Unexpected '+d.action);};
  const x=fromPayload({id:'r3-e3',route:'r3',t:'',k:'Практические задания',d:'Математика',u:'ММУ',fo:'Очно-заочная',g:'1 курс, 26Т101а',n:'Иванова Мария Петровна',dl:'2027-01-25',cn:'student@example.invalid'});x.requestNumber=15;
  D.items=[x];openId=x.id;render();
 });
 const route=page.locator('.r3route');
 await expect(route.locator('.r3s.done')).toHaveCount(2);await expect(route.locator('.r3s.cur')).toContainText('Шаг 3 из 5 · Работа возвращена на доработку · доработка № 1');
 await expect(route.locator('.r3s.fut').first()).toHaveText('4Передана');
 await expect(page.locator('.r3head')).toContainText('Возвратов на доработку: 1');await expect(page.locator('.r3due')).toContainText('25 января');
 const box=await route.boundingBox(),side=await page.locator('.r3side').boundingBox();expect(box.x).toBeLessThan(side.x);expect(box.width).toBeGreaterThan(side.width);
 await page.locator('#request-tab-history').click();
 await expect(page.locator('#request-panel-history')).toContainText('Версия 1');await expect(page.locator('#request-panel-history')).toContainText('Задание 3 подробно.');
 await page.locator('#request-tab-materials').click();await expect(page.locator('#request-panel-materials')).toContainText('Практика1.pdf');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('R3-E4: registry list shows route dots and whose turn; «Сегодня» groups requests by who acts next',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  const z={takenAt:null,resultAt:null,deliveredAt:null,downloadedAt:null,handedAt:null,returns:0,returnedAt:null,openQuestions:0};
  const mk=(n,dl,sum)=>{const x=fromPayload({id:'00000000-0000-4000-8000-00000000000'+n,route:'r3',t:'Тема '+n,k:'Реферат',d:'Предмет',u:'ВУЗ',fo:'Очная',g:'1 курс',n:'Студент '+n,dl:dl,cn:'s@example.invalid'});x.requestNumber=n;x.r3Summary=sum;return x;};
  const soon=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  D.items=[mk(1,'2027-01-25',{...z}),mk(2,soon,{...z,takenAt:'2026-10-03T09:00:00Z',resultAt:'2026-10-05T09:00:00Z'}),mk(3,'2027-02-01',{...z,openQuestions:1}),
   mk(4,'2027-03-01',{...z,takenAt:'2026-09-20T09:00:00Z',resultAt:'2026-09-25T09:00:00Z',deliveredAt:'2026-09-25T10:00:00Z',downloadedAt:'2026-09-26T10:00:00Z',handedAt:'2026-09-27T10:00:00Z'})];
  tab='today';openId=null;render();
 });
 await expect(page.locator('#tabbar [data-tab="today"]')).toContainText('2');
 const you=page.locator('.r3ts').filter({hasText:'Ваш ход'});
 await expect(you.locator('.r3tl')).toHaveCount(2);await expect(you.locator('.r3tact').first()).toHaveText('Открыть');
 await expect(page.locator('.r3ts').filter({hasText:'Ждём студента'}).locator('.r3tl')).toHaveCount(1);
 await you.locator('.r3tact').first().click();
 await expect.poll(()=>page.evaluate(()=>[tab,openId])).toEqual(['list','00000000-0000-4000-8000-000000000002']);
 await page.evaluate(()=>{openId=null;render();});
 const rows=page.locator('tr.r3-row');await expect(rows).toHaveCount(4);
 await expect(rows.filter({hasText:'№ 3'}).locator('.r3turn')).toHaveText('Студент');
 await expect(rows.filter({hasText:'№ 4'}).locator('.r3turn')).toHaveText('Сдана');await expect(rows.filter({hasText:'№ 4'}).locator('.r3dots i.done')).toHaveCount(5);
 await expect(rows.filter({hasText:'№ 2'})).toContainText('Состояние не подтверждено');
});

test('Title-page details come from the profile and the sent details go back to the profile',async({page})=>{
 await setup(page,{withProfile:true});
 await expect(page.locator('[data-intake-detail="n"]')).toHaveValue('Петрова Мария Ивановна');
 await expect(page.locator('[data-intake-detail="u"]')).toHaveValue('АНО ВО «Московский международный университет»');
 await expect(page.locator('[data-intake-detail="pr"]')).toHaveValue('38.03.02 Менеджмент');
 await expect(page.locator('[data-intake-detail="fo"]')).toHaveValue('Очно-заочная');
 await expect(page.locator('[data-intake-detail="g"]')).toHaveValue('1 курс, 26Т101а');
 await expect(page.locator('[data-intake-detail="kf"]')).toHaveValue('');
 await page.locator('#intakeFiles').setInputFiles([pdf('Практика1')]);await expect(page.locator('[data-intake-status]')).toContainText('Материалы сохранены: 1');
 await page.locator('[data-intake-detail="k"]').selectOption('Практические задания');await page.locator('[data-intake-detail="d"]').fill('Математика');
 await page.locator('[data-intake-detail="kf"]').fill('экономики и управления');await page.locator('[data-intake-detail="g"]').fill('2 курс, 26Т201а');
 await page.locator('#intakeDeadline').fill('2027-01-25');await page.locator('[data-intake-receive]').click();
 await expect(page.locator('[data-intake-status]')).toContainText('Заявка №15 отправлена');
 expect(await page.evaluate(()=>({k:D.settings.kafedra,c:D.settings.course,g:D.settings.group,f:D.settings.form,n:D.settings.name}))).toEqual({k:'экономики и управления',c:'2',g:'26Т201а',f:'очно-заочная',n:'Петрова Мария Ивановна'});
});
test('«Передать Claude»: registry copies the materials for Claude, then the file prepared by Claude appears as the finished work',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  window.r3={takenAt:null,result:null,delivered:null,downloadedAt:null};window.cl=null;window.calls=[];
  Oblako.requestApi=async d=>{calls.push(d.action);
   if(d.action==='material-revision-state')return {materials:{state:'initial',requestRevision:3}};
   if(d.action==='attachment-context')return {attachments:[{id:'a1',category:'unclassified',file_name:'Практика1.pdf',content_type:'application/pdf',size_bytes:2048,file_hash:'a'.repeat(64)}],materialRevision:3};
   if(d.action==='clarification-list')return {questions:[]};
   if(d.action==='claude-state'){if(cl&&cl.readyAt&&!cl.attachedAt){cl.attachedAt='2026-10-07T10:05:00Z';r3.result={name:'Иванова_Математика.docx',size:40960,at:cl.attachedAt,hash:'b'.repeat(64)};}return {claude:cl&&structuredClone(cl)};}
   if(d.action==='claude-queue'){r3.takenAt='2026-10-07T09:00:00Z';cl={queuedAt:'2026-10-07T09:00:00Z',startedAt:null,readyAt:null,attachedAt:null,error:null,files:1};return {claude:structuredClone(cl)};}
   if(d.action==='r3-state')return {work:structuredClone(r3)};
   throw Error('Unexpected '+d.action);};
  const x=fromPayload({id:'r3-claude',route:'r3',t:'',k:'Практические задания',d:'Математика',u:'ММУ',fo:'Очно-заочная',g:'1 курс, 26Т101а',n:'Иванова Мария Петровна',dl:'2027-01-25',cn:'student@example.invalid'});x.requestNumber=3;
  D.items=[x];openId=x.id;render();
 });
 const panel=page.locator('.request-action');
 await openSecondary(panel);await expect(panel.locator('[data-act="claude-queue"]')).toHaveText('Сохранить для Claude через чат');
 await expect(panel).toContainText('Студент прислал 1 файл.');
 await panel.locator('[data-act="claude-queue"]').click();
 await expect(panel.locator('.r3h')).toHaveText('Ожидается запуск');await expect(panel).toContainText('Начало подготовки ещё не подтверждено.');await expect(panel.locator('.r3eyebrow')).toContainText('Ожидается запуск');expect(await page.evaluate(()=>D.items[0].claude.startedAt)).toBeNull();
 await expect(panel).not.toContainText('Claude готовит работу');
 await page.evaluate(async()=>{cl.startedAt='2026-10-07T09:05:00Z';await loadR3(D.items[0]);});
 await expect(panel.locator('.r3h')).toHaveText('Подготовка начата');await expect(panel).toContainText('Готовый файл появится здесь.');expect(await page.evaluate(()=>D.items[0].claude.startedAt)).toBe('2026-10-07T09:05:00Z');
 await expect(panel).not.toContainText('Напишите Claude');
 await expect(panel.locator('[data-act="claude-queue"]')).toHaveCount(0);
 // Claude положил файл: при следующем открытии он прикреплён как готовая работа.
 await page.evaluate(async()=>{cl.readyAt='2026-10-07T10:00:00Z';await loadR3(D.items[0]);});
 await expect(panel).toContainText('Иванова Математика.docx');await expect(panel).toContainText('Проверьте работу перед передачей студенту.');expect(await page.evaluate(()=>D.items[0].r3.delivered)).toBeNull();
 await expect(panel.locator('[data-act="r3-result-review"]')).toHaveText('Проверить работу');
 await expect(panel.locator('[data-act="claude-queue"]')).toHaveText('Попросить Claude переделать');
});

// UX-RECOVERY-01 stage 1: isolated fault checks, not production acceptance.
for(const width of [390,1440])test('UX-R01 unknown receipt can be checked without resending at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);
 await page.locator('#intakeFiles').setInputFiles(pdf('Receipt recovery'));await fill(page);await page.locator('#intakeDeadline').fill('2027-01-25');
 await page.evaluate(()=>{const original=Oblako.requestApi;window.receiptStateFails=true;window.loseReceiptReply=true;Oblako.requestApi=async d=>{if(d.action==='intake-receive-state'&&receiptStateFails)throw Error('Нет сети');return original(d);};});
 await page.locator('[data-intake-receive]').click();
 await expect(page.locator('[data-intake-status]')).toContainText('Не удалось подтвердить отправку');
 await expect(page.locator('[data-intake-status]')).not.toContainText('Задание не отправлено');
 await expect(page.locator('[data-intake-receive]')).toBeDisabled();
 await expect(page.locator('[data-intake-check]')).toBeVisible();
 await page.locator('[data-x]').click();
 await page.evaluate(()=>StudIntake.open({api:d=>Oblako.requestApi(d),openModal,esc,owner:()=>KEY,identity:Oblako.identity,submitted:s=>{window.lastReceipt=s;}}));
 await expect(page.locator('[data-intake-check]')).toBeVisible();await expect(page.locator('[data-intake-receive]')).toBeDisabled();
 await page.evaluate(()=>{receiptStateFails=false;const original=Oblako.requestApi;Oblako.requestApi=async d=>{if(d.action==='intake-receive-state')await new Promise(r=>{window.finishReceiptCheck=r;});return original(d);};const b=document.querySelector('[data-intake-check]');b.click();b.click();});
 await expect(page.locator('[data-intake-check]')).toHaveText('Проверяем отправку…');await expect(page.locator('[data-intake-check]')).toBeDisabled();
 await page.evaluate(()=>finishReceiptCheck());
 await expect(page.locator('[data-intake-status]')).toContainText('Заявка №15 отправлена');
 await expect(page.locator('[data-intake-check]')).toBeHidden();
 expect(await page.evaluate(()=>receiptCalls.filter(a=>a==='intake-receive').length)).toBe(1);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('receipt-fixture:'+KEY)).writes)).toBe(1);
});
test('UX-R01 confirmed unsubmitted receipt unlocks the preserved form',async({page})=>{
 await setup(page);await page.locator('#intakeFiles').setInputFiles(pdf('Unsubmitted'));await fill(page);await page.locator('#intakeDeadline').fill('2027-01-25');
 await page.evaluate(()=>{const original=Oblako.requestApi;window.checkFails=true;window.sendFails=true;Oblako.requestApi=async d=>{if(d.action==='intake-receive'&&sendFails||d.action==='intake-receive-state'&&checkFails)throw Error('Нет сети');return original(d);};});
 await page.locator('[data-intake-receive]').click();await expect(page.locator('[data-intake-check]')).toBeVisible();
 await page.evaluate(()=>{checkFails=false;sendFails=false;});await page.locator('[data-intake-check]').click();
 await expect(page.locator('[data-intake-status]')).toContainText('заявка пока не получена');await expect(page.locator('[data-intake-receive]')).toBeEnabled();
 await expect(page.locator('[data-intake-detail="n"]')).toHaveValue(DETAILS.n);
 await page.locator('[data-intake-receive]').click();await expect(page.locator('[data-intake-status]')).toContainText('Заявка №15 отправлена');
});
for(const width of [390,1440])test('UX-R02 failed registry load has a persistent retry at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  window.loadAttempts=0;Oblako.requestApi=async d=>{
   if(d.action==='material-revision-state')return {materials:{state:'initial',requestRevision:1}};
   if(d.action==='attachment-context')return {attachments:[],materialRevision:1};
   if(d.action==='clarification-list')return {questions:[]};
   if(d.action==='claude-state')return {claude:null};
   if(d.action==='r3-state'){loadAttempts++;if(loadAttempts===1)throw Error('Нет сети');await new Promise(r=>window.finishCardLoad=r);return {work:{takenAt:null}};}
   throw Error('Unexpected '+d.action);
  };
  const x=fromPayload({id:'ux-local-card',route:'r3',k:'Практические задания',d:'Математика',u:'ММУ',fo:'Очно-заочная',g:'1 курс',n:'Локальная проверка',dl:'2027-01-25',cn:'local@example.invalid'});x.requestNumber=15;D.items=[x];tab='list';openId=null;render();
 });
 await page.locator('button[data-act="open"][data-id="ux-local-card"]').click();
 await expect.poll(()=>page.evaluate(()=>({attempts:loadAttempts,error:!!D.items[0].r3LoadError,route3:D.items[0].route3,loaded:D.items[0].r3Loaded,tab,openId,text:document.querySelector('.request-action')?.textContent}))).toMatchObject({error:true});
 console.log('UX-R02 observed',await page.evaluate(()=>({attempts:loadAttempts,error:!!D.items[0].r3LoadError,route3:D.items[0].route3,loaded:D.items[0].r3Loaded,tab,openId,id:D.items[0].id,text:document.querySelector('.request-action')?.textContent})));
 await expect(page.getByRole('heading',{name:'Не удалось загрузить заявку'})).toBeVisible();
 await expect(page.locator('[data-act="back"]')).toBeVisible();
 await page.evaluate(()=>render());await expect(page.locator('[data-act="r3-retry-load"]')).toBeVisible();expect(await page.evaluate(()=>loadAttempts)).toBe(1);
 await page.evaluate(()=>{const b=document.querySelector('[data-act="r3-retry-load"]');b.click();b.click();});
 await expect(page.getByText('Загружаем заявку…',{exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>loadAttempts)).toBe(2);
 await page.evaluate(()=>finishCardLoad());await expect(page.locator('[data-act="r3-retry-load"]')).toHaveCount(0);await openSecondary(page.locator('.request-action'));await expect(page.locator('[data-act="r3-take"]')).toBeVisible();
 expect(await page.evaluate(()=>loadAttempts)).toBe(2);
});

// UX-RECOVERY-01 stage 2: delayed replies, explicit navigation and retained position.
for(const width of [390,1440])test('UX-R04/05 sending feedback and explicit receipt navigation at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);
 await page.locator('[data-x]').click();
 await page.locator('[data-start-send]').click();
 await expect(page.locator('#intakeFiles')).toBeEnabled();
 await page.locator('#intakeFiles').setInputFiles(pdf('Explicit receipt'));
 await expect(page.locator('[data-intake-status]')).toContainText('Материалы сохранены: 1');
 await fill(page);await page.locator('#intakeDeadline').fill('2027-01-25');
 await page.evaluate(()=>{
  const original=Oblako.requestApi;window.sendAttempts=0;
  Oblako.requestApi=async d=>{if(d.action==='intake-receive'){sendAttempts++;await new Promise(r=>window.finishSend=r);}return original(d);};
  // Reopen with the real application handler so its API is the delayed dispatcher.
 });
 await page.locator('[data-x]').click();await page.locator('[data-start-send]').click();
 await expect(page.locator('[data-intake-receive]')).toBeEnabled();
 await page.evaluate(()=>{const b=document.querySelector('[data-intake-receive]');b.click();b.click();});
 await expect(page.locator('[data-intake-receive]')).toHaveText('Отправляем задание…');
 await expect(page.locator('[data-intake-receive]')).toBeDisabled();
 await expect.poll(()=>page.evaluate(()=>sendAttempts)).toBe(1);
 expect(await page.evaluate(()=>openWorkId)).toBeNull();
 await page.evaluate(()=>finishSend());
 const open=page.locator('[data-intake-open-receipt]');
 await expect(open).toHaveText('Открыть заявку № 15');await expect(open).toBeInViewport();
 expect(await page.evaluate(()=>D.works.length)).toBe(1);
 expect(await page.evaluate(()=>openWorkId)).toBeNull();
 await open.click();await expect(page.locator('[data-intake-dialog]')).toHaveCount(0);
 expect(await page.evaluate(()=>work(openWorkId).req.number)).toBe(15);
 await page.locator('[data-act="back"]').click();
 expect(await page.evaluate(()=>({tab,openWorkId}))).toEqual({tab:'today',openWorkId:null});
 expect(await page.evaluate(()=>sendAttempts)).toBe(1);
});

for(const width of [390,1440])test('UX-R03/06 background refresh and back retain the student list position at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{D.works=Array.from({length:35},(_,i)=>({id:'ux-scroll-'+i,topic:'Учебная работа '+i,student:'Проверка интерфейса',created:today(),status:'draft',format:{},structure:emptyStructure(),tasks:[]}));workFilter='all';render();});
 await page.locator('#tabbar [data-tab="works"]').click();
 const row=page.locator('[data-act="open-work"][data-id="ux-scroll-20"]');await row.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>({page:document.getElementById('page').scrollTop,window:scrollY}));
 expect(before.page+before.window).toBeGreaterThan(100);
 await page.evaluate(()=>{D=structuredClone(D);render();});
 const after=await page.evaluate(()=>({page:document.getElementById('page').scrollTop,window:scrollY}));
 expect(Math.abs(after.page-before.page)).toBeLessThan(3);expect(Math.abs(after.window-before.window)).toBeLessThan(3);
 await row.click();await page.locator('[data-act="back"]').click();await expect.poll(()=>page.evaluate(()=>openWorkId)).toBeNull();
 const returned=await page.evaluate(()=>({page:document.getElementById('page').scrollTop,window:scrollY,tab,openWorkId}));
 expect(returned.tab).toBe('works');expect(returned.openWorkId).toBeNull();
 expect(Math.abs(returned.page-before.page)).toBeLessThan(3);expect(Math.abs(returned.window-before.window)).toBeLessThan(3);
 await page.locator('#tabbar [data-tab="today"]').click();expect(await page.locator('#page').evaluate(p=>p.scrollTop)).toBe(0);
});

async function stageTwoRegistry(page){
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  window.takeAttempts=0;window.serverWork={};Oblako.requestApi=async d=>{
   if(d.action==='material-revision-state')return {materials:{state:'initial',requestRevision:1}};
   if(d.action==='attachment-context')return {attachments:[],materialRevision:1};
   if(d.action==='clarification-list')return {questions:[]};
   if(d.action==='claude-state')return {claude:null};
   if(d.action==='r3-state')return {work:structuredClone(serverWork)};
   if(d.action==='r3-take'){takeAttempts++;return await new Promise((resolve,reject)=>{window.finishTake=result=>{serverWork=result.work;resolve(result);};window.failTake=reject;});}
   throw Error('Unexpected '+d.action);
  };
  const x=fromPayload({id:'ux-pending-card',route:'r3',k:'Практические задания',d:'Математика',u:'ММУ',fo:'Очно-заочная',g:'1 курс',n:'Проверка интерфейса',dl:'2027-01-25'});
  x.requestNumber=15;x.r3Loaded=true;x.r3={};x.attachments=[];x.clarifications=[];r3Seen.add(x);
  D.items=[x];tab='list';openId=null;render();
 });
 await page.locator('button[data-act="open"][data-id="ux-pending-card"]').click();
 await openSecondary(page.locator('.request-action'));
}
for(const width of [390,1440])test('UX-R04 registry shows pending action once and persistent failure at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await stageTwoRegistry(page);
 await page.evaluate(()=>{const b=document.querySelector('[data-act="r3-take"]');b.click();b.click();render();});
 await expect(page.getByRole('button',{name:'Берём в работу…',exact:true})).toBeDisabled();
 await expect.poll(()=>page.evaluate(()=>takeAttempts)).toBe(1);
 await page.evaluate(()=>{D=structuredClone(D);render();});
 await expect(page.getByRole('button',{name:'Берём в работу…',exact:true})).toBeDisabled();
 await page.evaluate(()=>failTake(Error('Нет сети')));
 await expect(page.locator('.request-action [data-r3-action-status]')).toContainText('Нет сети');
 await page.evaluate(()=>render());await expect(page.locator('.request-action [data-r3-action-status]')).toContainText('Нет сети');
 await page.locator('[data-act="r3-take"]').click();await expect.poll(()=>page.evaluate(()=>takeAttempts)).toBe(2);
 await page.evaluate(()=>finishTake({work:{takenAt:'2026-10-08T01:00:00Z'}}));
 await expect(page.locator('.request-action')).toContainText('Выберите способ подготовки или выполните работу самостоятельно.');
 await expect(page.locator('.request-action')).not.toContainText('Нет сети');
});
test('UX-R04 a late executor reply cannot modify another account or open its screen',async({page})=>{
 await stageTwoRegistry(page);await page.locator('[data-act="r3-take"]').click();await expect.poll(()=>page.evaluate(()=>takeAttempts)).toBe(1);
 await page.evaluate(()=>{window.previousCard=D.items[0];window.nextAccount={items:[],theme:'light'};D=nextAccount;Oblako.identity=()=> 'next-local-test-identity';openId=null;tab='list';render();finishTake({work:{takenAt:'2026-10-08T01:00:00Z'}});});
 await expect(page.locator('.request-head')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>!!(previousCard.r3||{}).takenAt)).toBe(false);
 expect(await page.evaluate(()=>D===nextAccount&&D.items.length===0&&openId===null)).toBe(true);
});

// UX-R07: prepared file is not a delivery or a teacher submission.
for(const width of [390,1440])test('UX-R07 manual file and self-reported handover at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  const x=fromPayload({id:'ux-status',route:'r3',k:'Практическая работа',d:'Математика',n:'Тестовая студентка',dl:'2027-01-25'});
  x.requestNumber=3;r3Seen.add(x);x.r3Loaded=true;x.r3={takenAt:'2026-10-07T09:00:00Z',result:{name:'Работа.docx',size:2048,hash:'a'.repeat(64),at:'2026-10-07T10:00:00Z'}};x.claude=null;
  D.items=[x];openId=x.id;render();
 });
 const panel=page.locator('.request-action');
 await expect(panel).toContainText('Файл подготовлен');
 await expect(panel).toContainText('Проверьте работу перед передачей студенту.');expect(await page.evaluate(()=>!!D.items[0].r3.delivered||!!D.items[0].r3.handedAt)).toBe(false);
 await expect(panel).not.toContainText('Выберите способ подготовки или выполните работу самостоятельно.');
 await expect(panel.locator('[data-act="r3-result-review"]')).toBeVisible();
 await page.evaluate(()=>{const x=D.items[0];x.r3.delivered={...x.r3.result,at:'2026-10-07T11:00:00Z'};render();});
 await expect(panel).toContainText('Работа передана студенту');
 await expect(panel).not.toContainText('Студент отметил сдачу');
 await page.evaluate(()=>{D.items[0].r3.handedAt='2026-10-07T12:00:00Z';render();});
 await expect(panel).toContainText('Студент отметил сдачу');
 await expect(panel).not.toContainText('Студент сдал работу');
});

// UX-R06: browser Back/Forward and application Back share the same route.
for(const width of [390,1440])test('UX-R06 browser history restores the student route at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4173/index.html');
 await page.locator('#tabbar [data-tab="works"]').click();
 await page.locator('#tabbar [data-tab="cal"]').click();
 await page.goBack();await expect(page.locator('#tabbar [data-tab="works"]')).toHaveAttribute('aria-selected','true');
 await page.goForward();await expect(page.locator('#tabbar [data-tab="cal"]')).toHaveAttribute('aria-selected','true');
 await page.goBack();await expect.poll(()=>page.evaluate(()=>tab)).toBe('works');
 await page.locator('#tabbar [data-tab="more"]').click();
 await page.goBack();await expect.poll(()=>page.evaluate(()=>tab)).toBe('works');
 await page.goForward();await expect.poll(()=>page.evaluate(()=>tab)).toBe('more');
});
for(const width of [390,1440])test('UX-R06 registry browser history retains materials and filters at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await stageTwoRegistry(page);
 await page.locator('#tabbar [data-tab="more"]').click();
 await page.goBack();await expect.poll(()=>page.evaluate(()=>openId)).toBe('ux-pending-card');
 await expect(page.locator('#request-panel-overview')).toContainText('Математика');
 await page.goForward();await expect.poll(()=>page.evaluate(()=>tab)).toBe('more');
 await page.goBack();await expect.poll(()=>page.evaluate(()=>openId)).toBe('ux-pending-card');
 const snapshot=await page.evaluate(()=>JSON.stringify(D.items[0]));
 await page.locator('[data-act="back"]').click();await expect.poll(()=>page.evaluate(()=>openId)).toBeNull();
 await page.goForward();await expect.poll(()=>page.evaluate(()=>openId)).toBe('ux-pending-card');
 expect(await page.evaluate(()=>JSON.stringify(D.items[0]))).toBe(snapshot);
});
test('UX-R06 prior account history cannot reopen its request',async({page})=>{
 await stageTwoRegistry(page);await page.locator('#tabbar [data-tab="more"]').click();
 await page.evaluate(()=>{KEY+=':other';D={...D,items:[]};openId=null;tab='list';render();});
 await page.goBack();await expect.poll(()=>page.evaluate(()=>openId)).toBeNull();
 await expect(page.locator('#page')).not.toContainText('Проверка интерфейса');
});

for(const width of [390,1440])test('UX-ASSISTANT equal controls retain manual chat, prior files and checked availability at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  window.assistantCalls=[];window.failAssistantCheck=false;
  Oblako.requestApi=async d=>{assistantCalls.push(d.action);if(d.action==='assistant-capabilities'){if(failAssistantCheck)throw Error('network');return {providers:['claude','chatgpt','deepseek'].map(provider=>({provider,available:false,reason:provider==='deepseek'?'budget_exhausted':'not_connected'}))};}if(d.action==='assistant-state')return {job:null};if(d.action==='material-revision-state')return {materials:{state:'locked',requestRevision:1}};if(d.action==='attachment-context')return {attachments:[{id:'source',file_name:'original.pdf',category:'unclassified',content_type:'application/pdf',size_bytes:10,file_hash:'b'.repeat(64)}],materialRevision:1};if(d.action==='clarification-list')return {questions:[]};if(d.action==='claude-state')return {claude:null};if(d.action==='r3-state')return {work:structuredClone(D.items[0].r3)};throw Error('Unexpected '+d.action);};
  const x=fromPayload({id:'assistant-choice',route:'r3',k:'Практические задания',d:'Математика',u:'ММУ',n:'Иванова Мария',dl:'2027-01-25'});x.requestNumber=6;x.r3Loaded=true;x.r3={takenAt:'2026-10-07T09:00:00Z',result:{hash:'a'.repeat(64),name:'previous.docx',size:2048,at:'2026-10-07T10:00:00Z'},versions:[{n:1,at:'2026-10-06T10:00:00Z',name:'original.docx'}]};x.claude=null;x.attachments=[{id:'source',file_name:'original.pdf',size_bytes:10}];
  D.items=[x];r3Seen.add(x);openId=x.id;window.assistantBefore=JSON.stringify({r3:x.r3,claude:x.claude,attachments:x.attachments});render();
 });
 const panel=page.locator('.request-action');
 await expect(panel).toContainText('previous.docx');await expect(panel.locator('[data-act="r3-result-review"]')).toHaveText('Проверить работу');
 await expect(panel.locator('[data-act="r3-deliver"]')).toHaveCount(0);
 await openSecondary(panel);await panel.locator('[data-act="r3-chatgpt"]').click();
 const blocked=page.getByRole('dialog',{name:'Перед подготовкой'});await expect(blocked).toContainText('Сначала обновите состояние материалов заявки.');await blocked.getByRole('button',{name:'Закрыть',exact:true}).click();
 expect(await page.evaluate(()=>JSON.stringify({r3:D.items[0].r3,claude:D.items[0].claude,attachments:D.items[0].attachments})===assistantBefore)).toBe(true);
 // No working file is discarded by choosing a helper. Equal helper controls belong
 // to the preparation stage; the existing file's next action remains review.
 await page.evaluate(()=>{D.items[0].r3.result=null;render();});
 const controls=panel.locator('[data-act="r3-assistant-run"]');await expect(controls).toHaveCount(3);
 expect(await controls.allTextContents()).toEqual(['Через API','Через API','Через API']);
 await expect(panel.locator('[data-act="r3-assistant-chat"]')).toHaveCount(3);
 await expect(panel.locator('.r3-assistant')).toContainText('Лимит подготовки исчерпан');for(let i=0;i<3;i++)await expect(controls.nth(i)).toBeDisabled();
 await expect(panel.locator('[aria-pressed]')).toHaveCount(0);
 await page.evaluate(()=>failAssistantCheck=true);await panel.locator('[data-act="r3-assistant-refresh"]').first().click();
 await expect(panel.locator('.r3-assistant-state')).toContainText('Не удалось проверить подключения');
 expect(await page.evaluate(()=>assistantCalls.filter(x=>x==='assistant-start'||x==='assistant-prepare'||x==='assistant-preflight'))).toEqual([]);
 expect(await page.evaluate(()=>D.items[0].r3.versions[0].name)).toBe('original.docx');expect(await page.evaluate(()=>D.items[0].attachments[0].file_name)).toBe('original.pdf');
});
