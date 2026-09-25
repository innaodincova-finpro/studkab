const {test,expect}=require('@playwright/test');
test('cabinet request roundtrip, hostile link rejection, repeat preserves work',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 const sent=await page.evaluate(()=>{
  const w={topic:'Контрольная заявка',requirements:'Первый пункт\nТема: это часть требований\nТретий пункт',deadline:'2026-10-15',student:'Тестовый студент',format:{workType:'Курсовая',univ:'Тестовый вуз',mLeft:30,mRight:15,mTop:20,mBottom:20,font:'Times New Roman',size:14,spacing:1.5,indent:1.25},req:{id:'rq-audit',org:'Организация\nВторая строка',notes:'Примечание\nПродолжение',contact:'test'}};
  return {payload:requestPayload(w),text:requestText(w,false)};
 });
 await page.goto('http://127.0.0.1:4173/reestr.html');
 const result=await page.evaluate(({payload,text})=>{
  const parsed=parseText(text),direct=fromPayload(payload);
  D.items=[];D.refs=[];
  function accept(p){location.hash='z='+btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');return intake();}
  const first=accept(payload);first.rec.status='done';first.rec.note='Моя заметка';first.rec.doc={marker:'Сохранённый документ'};
  const second=accept({...payload,t:'Уточнённая тема'});
  const before=JSON.stringify(D);const bad=accept({...payload,id:'rq" data-audit="bad'});
  const unchanged=before===JSON.stringify(D);
  return {parsed,direct,second,count:D.items.length,bad,unchanged};
 },sent);
 expect(result.parsed.requirements).toBe(sent.payload.rq);
 expect(result.parsed.org).toBe(sent.payload.org);
 expect(result.parsed.methodNotes).toBe(sent.payload.mn);
 expect(result.direct.topic).toBe(sent.payload.t);
 expect(result.count).toBe(1);expect(result.second.updated).toBe(true);
 expect(result.second.rec.note).toBe('Моя заметка');expect(result.second.rec.status).toBe('done');expect(result.second.rec.doc.marker).toBe('Сохранённый документ');
 expect(result.bad.error).toBe(true);expect(result.unchanged).toBe(true);
 const malformed=await page.evaluate(()=>[null,[],{t:{bad:true}},{t:'x',fm:[]},{t:'x',dl:'not-date'},{t:'x',fm:{sz:-1}}].map(p=>{try{fromPayload(p);return false}catch(e){return true}}));
 expect(malformed.every(Boolean)).toBe(true);
});
test('registry document edited, saved, downloaded and keeps derived stage',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{const x=fromPayload({id:'rq-doc',t:'Проверка документа',n:'Тестовый студент',fm:{ml:30,mr:15,mt:20,mb:20,fn:'Times New Roman',sz:14,sp:1.5,ind:1.25}});D.items=[x];save();openDocBuilder(x.id);});
 await page.getByText('Редактировать разделы',{exact:true}).click();
 await page.locator('[data-sec] > summary').first().click();
 await page.locator('.secText').first().fill('Контрольный текст раздела. Проверка сохранения.');
 await page.locator('[data-docsave]').click();
 await page.reload();
 await page.evaluate(()=>openDocBuilder('rq-doc'));
 await expect(page.locator('.secText').first()).toHaveValue('Контрольный текст раздела. Проверка сохранения.');
 const waiting=page.waitForEvent('download');await page.locator('[data-docx]').click();const download=await waiting;
 const file=await download.path();
 const {execFileSync}=require('node:child_process');
 const result=execFileSync('python3',['-c','import zipfile,sys,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); [E.fromstring(z.read(n)) for n in z.namelist() if n.endswith(".xml")]; t=z.read("word/document.xml").decode(); assert "Контрольный текст раздела" in t; print("DOCX XML valid")',file],{encoding:'utf8'});
 expect(result).toContain('DOCX XML valid');
 await page.locator('[data-x]').first().click();
 await page.evaluate(()=>{openId='rq-doc';render();});
 await page.getByRole('tab',{name:'Обзор',exact:true}).click();
 await expect(page.locator('[data-act="status"]')).toHaveCount(0);
 await page.locator('#note').fill('Проверяется по фактическому этапу');await page.getByRole('button',{name:'Сохранить заметку'}).click();await page.reload();
 expect(await page.evaluate(()=>item('rq-doc').note)).toBe('Проверяется по фактическому этапу');
});
test('direct request confirms only server acknowledgement and keeps retry ID',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  D.works=[{id:'w-direct',topic:'Тест прямой заявки',format:{},req:{id:'rq-direct',contact:'test',org:'',notes:''}}];
  window.requestsSeen=[];
  Oblako.requestApi=async body=>{requestsSeen.push(body);if(body.action==='attachment-list')return {attachments:[]};if(body.action==='request-publish')return {ready:true,number:42};return {saved:true,id:'11111111-1111-4111-8111-111111111111',number:42};};
  openRequest('w-direct');
 });
 for(const category of ['assignment','methodology','data','sources'])await page.locator('[data-request-file="'+category+'"]').setInputFiles({name:category+'.txt',mimeType:'text/plain',buffer:Buffer.from('Checked '+category)});
 await page.getByRole('button',{name:'Отправить заявку исполнителю',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>D.works[0].req.sentBy)).toBe('direct');
 expect(await page.evaluate(()=>D.works[0].req.number)).toBe(42);
 await page.evaluate(()=>{Oblako.requestApi=async body=>{requestsSeen.push(body);throw Error('Сеть недоступна');};openRequest('w-direct');});
 await page.getByRole('button',{name:'Отправить заявку исполнителю',exact:true}).click();
 await expect(page.getByRole('button',{name:'Отправить заявку исполнителю',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>requestsSeen.map(x=>x.action))).toEqual(['submit','request-state','attachment-list','attachment-upload','attachment-upload','attachment-upload','attachment-upload','request-publish','request-state']);
 expect(await page.evaluate(()=>requestsSeen.filter(x=>x.action==='submit').map(x=>x.payload.id))).toEqual(['rq-direct']);
 expect(await page.evaluate(()=>D.works[0].req.number)).toBe(42);
});
test('cloud inbox repeated load preserves executor document and notes',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 const result=await page.evaluate(async()=>{
  D.items=[];D.refs=[];
  const id='11111111-1111-4111-8111-111111111111';
  Oblako.requestApi=async()=>({rows:[{id,number:42,payload:{id:'student-request',t:'Тема',cn:'test'}}],next:null});
  await receiveInbox();
  item(id).note='Заметка исполнителя';item(id).doc={marker:'doc'};item(id).status='done';
  Oblako.requestApi=async()=>({rows:[{id,number:42,revision:1,payload:{id:'student-request',t:'Новая тема',cn:'test'}}],next:null});
  await receiveInbox();
  return {count:D.items.length,item:item(id)};
 });
 expect(result.item.topic).toBe('Новая тема');expect(result.count).toBe(1);expect(result.item.note).toBe('Заметка исполнителя');
 expect(result.item.doc.marker).toBe('doc');expect(result.item.status).toBe('done');
});
test('password entry and logged-out notifications are usable on a narrow screen',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{Oblako.ready=true;Oblako.mode='local';Oblako.signInPassword=async(email,password)=>{window.loginArgs={email,password};Oblako.mode='cloud';};tab='more';render();openCloud();});
 await page.locator('#clEmail').fill('student@example.test');await page.locator('#clPassword').fill('password123');
 await page.locator('#clForm button[type=submit]').click();
 expect(await page.evaluate(()=>window.loginArgs)).toEqual({email:'student@example.test',password:'password123'});
 await page.evaluate(()=>{Oblako.mode='local';tab='more';render();});
 expect(await page.locator('[data-act="push-enable"]').count()).toBe(0);
 await page.getByText('Уведомления',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Войти, чтобы включить уведомления'})).toBeVisible();
});
test('invitation verifies once, retries password save and uses cabinet session storage',async({page})=>{
 await page.route('**/vendor/supabase-2.57.4.js',route=>route.fulfill({contentType:'application/javascript',body:`window.supabase={createClient:(url,key,options)=>{window.storageKey=options.auth.storageKey;window.verifyCount=0;window.updateCount=0;return {auth:{getSession:async()=>({data:{session:null}}),verifyOtp:async()=>{window.verifyCount++;return {data:{user:{email:'student@example.test'}}}},updateUser:async()=>{window.updateCount++;return {error:{message:'temporary'}}}}}}};`}));
 await page.goto('http://127.0.0.1:4173/activate.html#token=test&email=student%40example.test');
 await page.locator('#password').fill('password123');await page.locator('#repeat').fill('password123');await page.locator('#submit').click();
 await expect(page.locator('#status')).toContainText('пароль не сохранён');
 await page.locator('#submit').click();await expect(page.locator('#status')).toContainText('пароль не сохранён');
 expect(await page.evaluate(()=>({verify:verifyCount,update:updateCount,key:storageKey,hash:location.hash}))).toEqual({verify:1,update:2,key:'oblako-kabinet',hash:''});
});
test('storage mode remains consistent when reopening profile after cloud login',async({page})=>{
 for(const file of ['index.html','reestr.html']){
  await page.goto('http://127.0.0.1:4173/'+file);
  await page.evaluate(()=>{Oblako.mode='cloud';Oblako.statusText=()=> 'Сохранено в облаке в 17:06';tab='more';render();});
  await expect(page.locator('#cloudBadge')).toHaveText('Облачное хранение');
  await expect(page.locator('#cloudLine')).toHaveText('Сохранено в облаке в 17:06');
  await page.evaluate(()=>{tab='more';render();});
  await expect(page.locator('#cloudBadge')).toHaveText('Облачное хранение');
  await page.evaluate(()=>{Oblako.statusText=()=> 'Нет связи с облаком';cloudPaint();});
  await expect(page.locator('#cloudLine')).toHaveText('Нет связи с облаком');
  await page.evaluate(()=>{Oblako.mode='local';Oblako.statusText=()=> 'только на этом устройстве';render();});
  await expect(page.locator('#cloudBadge')).toHaveText('Хранение на устройстве');
 }
});
test('existing request updates server fields and explicitly replaces assignment',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  D.works=[{id:'w-revise',topic:'Исправленная тема',format:{univ:'Тестовый вуз'},req:{id:'rq-revise',serverId:'11111111-1111-4111-8111-111111111111',number:9,contact:'test'}}];
  window.requestsSeen=[];
  Oblako.requestApi=async body=>{
   requestsSeen.push(body);
   if(body.action==='request-state')return {payload:{id:'rq-revise',t:'Старая тема'}};
   if(body.action==='attachment-list')return {attachments:[{id:'22222222-2222-4222-8222-222222222222',category:'assignment',file_hash:'a'.repeat(64)}]};
   if(body.action==='update-request')return {saved:true,id:body.id,number:9};
   if(body.action==='request-publish')return {ready:true,number:9};
   return {attachment:{id:'33333333-3333-4333-8333-333333333333'}};
  };
  openRequest('w-revise');
 });
 await page.locator('[data-request-file="assignment"]').setInputFiles({name:'assignment.txt',mimeType:'text/plain',buffer:Buffer.from('New assignment')});
 await page.getByRole('button',{name:'Отправить заявку исполнителю',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>D.works[0].req.sentBy)).toBe('direct');
 const calls=await page.evaluate(()=>requestsSeen);
 expect(calls.map(x=>x.action)).toEqual(['request-state','update-request','request-state','attachment-list','attachment-upload','request-publish']);
 expect(calls[1].payload.t).toBe('Исправленная тема');expect(calls[1].payload.u).toBe('Тестовый вуз');
 expect(calls[4].replacesId).toBe('22222222-2222-4222-8222-222222222222');
 expect(await page.evaluate(()=>D.works[0].req.attachments)).toBe(1);
});


test('C090 partial upload survives reopened form and retries only missing materials',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  D.works=[{id:'w-recover',topic:'Проверка восстановления',format:{},req:{id:'rq-recover',contact:'test'}}];
  window.requestsSeen=[];window.savedFiles=[];window.failUpload=true;
  Oblako.requestApi=async body=>{
   requestsSeen.push(body);
   if(body.action==='request-state')return {payload:{id:'rq-recover',t:'Проверка восстановления'}};
   if(body.action==='submit'||body.action==='update-request')return {saved:true,id:'11111111-1111-4111-8111-111111111111',number:12};
   if(body.action==='attachment-list')return {attachments:savedFiles};
   if(body.action==='request-publish')return {ready:true,number:12};
   if(body.action==='attachment-upload'){
    if(body.category==='sources'&&failUpload){failUpload=false;throw Error('Сеть недоступна');}
    savedFiles.push({id:body.category,category:body.category,file_hash:body.fileHash});return {attachment:{id:body.category}};
   }
  };
  openRequest('w-recover');
 });
 const assignment={name:'assignment.txt',mimeType:'text/plain',buffer:Buffer.from('Assignment')};
 const methodology={name:'methodology.txt',mimeType:'text/plain',buffer:Buffer.from('Methodology')};
 const data={name:'data.txt',mimeType:'text/plain',buffer:Buffer.from('Data')};
 const sources={name:'sources.txt',mimeType:'text/plain',buffer:Buffer.from('Sources')};
 await page.locator('[data-request-file="assignment"]').setInputFiles(assignment);
 await page.locator('[data-request-file="methodology"]').setInputFiles(methodology);
 await page.locator('[data-request-file="data"]').setInputFiles(data);
 await page.locator('[data-request-file="sources"]').setInputFiles(sources);
 await page.getByRole('button',{name:'Отправить заявку исполнителю',exact:true}).click();
 await expect(page.locator('[data-request-status]')).toContainText('Черновик заявки №12 ожидает полный комплект');
 expect(await page.evaluate(()=>D.works[0].req.filesPending)).toBe(true);
 expect(await page.evaluate(()=>requestsSeen.some(x=>x.action==='request-publish'))).toBe(false);
 await page.getByRole('button',{name:'Закрыть',exact:true}).last().click();
 await page.evaluate(()=>openRequest('w-recover'));
 await page.getByRole('button',{name:'Отправить заявку исполнителю',exact:true}).click();
 await expect(page.locator('[data-request-status]')).toContainText('Не все выбранные ранее материалы загружены');
 expect(await page.evaluate(()=>D.works[0].req.sent)).toBeUndefined();
 await page.locator('[data-request-file="assignment"]').setInputFiles(assignment);
 await page.locator('[data-request-file="methodology"]').setInputFiles(methodology);
 await page.locator('[data-request-file="data"]').setInputFiles(data);
 await page.locator('[data-request-file="sources"]').setInputFiles(sources);
 await page.getByRole('button',{name:'Отправить заявку исполнителю',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>D.works[0].req.filesPending)).toBe(false);
 expect(await page.evaluate(()=>requestsSeen.filter(x=>x.action==='submit').length)).toBe(1);
 expect(await page.evaluate(()=>requestsSeen.filter(x=>x.action==='attachment-upload'&&x.category==='assignment').length)).toBe(1);
 expect(await page.evaluate(()=>savedFiles.length)).toBe(4);
 expect(await page.evaluate(()=>requestsSeen.filter(x=>x.action==='request-publish').length)).toBe(1);
});
