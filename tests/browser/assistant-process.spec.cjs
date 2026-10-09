const {test,expect}=require('@playwright/test');
const stamp='2026-10-09T09:00:00Z';
for(const width of [390,1440])test('unread originals open all three chats and export a verified complete kit at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await seed(page);
 await page.evaluate(async()=>{
  window.open=()=>null;copyText=async()=>true;
  const x=item('assistant-process');x.materialRevision={state:'locked'};
  const bytes=new Uint8Array([80,75,3,4]);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  x.attachments=[{id:'synthetic-original',file_name:'Original.docx',size_bytes:4,file_hash:hash,category:'unclassified'}];
  const api=Oblako.requestApi;Oblako.requestApi=async input=>input.action==='attachment-download'?{url:'https://original.test/file'}:api(input);
  const oldFetch=window.fetch;window.fetch=async(url,opts)=>url==='https://original.test/file'?new Response(bytes):oldFetch(url,opts);
  render();
 });
 for(const provider of ['claude','chatgpt','deepseek']){
  await page.locator('[data-act="r3-assistant-chat"][data-method="'+provider+'"]').click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('комментарием');
  await expect(dialog.locator('textarea')).toContainText('Original.docx');
  const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'Скачать комплект и запрос',exact:true}).click();
  const download=await downloaded;expect(await download.failure()).toBeNull();
  const archive=require('node:fs').readFileSync(await download.path());
  expect(archive.includes(Buffer.from('Original.docx'))).toBe(true);
  expect(archive.includes(Buffer.from('Перечень оригиналов.json'))).toBe(true);
  expect(archive.includes(Buffer.from([80,75,3,4]))).toBe(true);
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 }
 expect(await page.evaluate(()=>assistantCalls.some(c=>['assistant-start','passport-approve','reading-start'].includes(c.action)))).toBe(false);
});
async function seed(page){
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>QA.switchUser('assistant-process-synthetic'));
 await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy&&!!window.StudAssistantExecutor&&!!window.StudViewState)).toBe(true);
 await page.evaluate(stamp=>{
  window.assistantCalls=[];window.preparationMode='normal';window.observedJob=null;window.operationAccepted=false;
  Oblako.requestApi=async body=>{
   assistantCalls.push(body);
   if(body.action==='assistant-capabilities')return {providers:['claude','chatgpt','deepseek'].map(provider=>({provider,available:false,reason:'not_connected'}))};
   if(body.action==='assistant-state')return {job:observedJob,accepted:operationAccepted};
   if(body.action==='assistant-prepare')return new Promise((resolve,reject)=>{window.pendingPrepare={resolve,reject,operation:body.operation,provider:body.provider};});
   if(body.action==='material-revision-state')return {materials:{state:'locked',requestRevision:1}};
   if(body.action==='attachment-context')return {attachments:[],materialRevision:1};
   if(body.action==='clarification-list')return {questions:[]};
   if(body.action==='claude-state')return {claude:null};
   if(body.action==='r3-state')return {work:{takenAt:stamp}};
   return {question:0,questions:[],files:[]};
  };
  const x={id:'assistant-process',requestNumber:101,route3:true,r3Loaded:true,r3ConfirmedAt:stamp,r3:{takenAt:stamp},student:'Учебный студент',topic:'Демонстрационное задание',univ:'Учебный университет',status:'work',format:{},attachments:[],passports:[],note:'Исходная заметка'};
  D.items=[x];r3Seen.add(x);tab='list';openId=x.id;render();
 },stamp);
 await expect(page.locator('.r3-assistant-option small').first()).toHaveText('API не подключён');
}
for(const width of [390,1440])test('rich R3 route keeps context and equal unavailable providers at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await seed(page);
 await expect(page.locator('.request-head')).toContainText('Демонстрационное задание');
 await expect(page.locator('.r3route .r3mk')).toHaveCount(5);
 const buttons=page.locator('[data-act="r3-assistant-run"]');
 await expect(buttons).toHaveCount(3);expect(await buttons.allTextContents()).toEqual(['Через API','Через API','Через API']);
 for(let i=0;i<3;i++)await expect(buttons.nth(i)).toBeEnabled();
 await expect(page.locator('.r3h')).not.toContainText('Claude');
 await expect(page.locator('[data-act="r3-assistant-chat"]')).toHaveCount(3);
 await expect(page.locator('.r3-assistant')).toContainText('отдельной оплатой');
 await expect(page.getByRole('tab',{name:'Материалы',exact:true})).toBeVisible();
 await expect(page.getByRole('tab',{name:'История',exact:true})).toBeVisible();
 await expect(page.locator('[data-act="executor-clarifications"]').first()).toBeVisible();
 await page.locator('.r3-secondary summary').click();
 for(const act of ['r3-bundle','r3-chatgpt','r3-assistant-document','r3-assistant-prepare'])await expect(page.locator('.r3-secondary [data-act="'+act+'"]').first()).toBeVisible();
 await expect(page.locator('#page input[data-r3-result-file]')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.evaluate(()=>assistantCalls.some(c=>c.action==='assistant-start'))).toBe(false);
});

test('busy feedback is immediate; lost acceptance blocks repeats until operation receipt is read',async({page})=>{
 await seed(page);await page.locator('.r3-secondary summary').click();
 await page.locator('[data-act="r3-assistant-prepare"]').click();
 const dialog=page.locator('[role="dialog"]');
 await dialog.locator('[data-kit-confirm]').click();
 await expect(dialog.locator('[data-kit-confirm]')).toBeDisabled();
 await expect(dialog.locator('[data-kit-confirm]')).toHaveText('Проверяем комплект…');
 await expect.poll(()=>page.evaluate(()=>assistantCalls.filter(c=>c.action==='assistant-prepare').length)).toBe(1);
 await page.evaluate(()=>r3AutomaticSession(item('assistant-process')).prepare('deepseek'));
 expect(await page.evaluate(()=>assistantCalls.filter(c=>c.action==='assistant-prepare').length)).toBe(1);
 await page.evaluate(()=>pendingPrepare.reject(Error('synthetic lost response')));
 await expect(page.locator('.r3-assistant-state')).toContainText('Не удалось подтвердить получение');
 await page.evaluate(()=>r3AutomaticSession(item('assistant-process')).prepare('deepseek'));
 expect(await page.evaluate(()=>assistantCalls.filter(c=>c.action==='assistant-prepare').length)).toBe(1);
 await page.evaluate(stamp=>{operationAccepted=true;observedJob={id:'11111111-1111-4111-8111-111111111111',operationId:'original-aliased-operation',state:'prepared',acceptedAt:stamp,provider:'claude',bindingCurrent:true};},stamp);
 await page.locator('[data-act="r3-assistant-refresh"]').first().click();
 await expect.poll(()=>page.evaluate(()=>r3AutomaticSession(item('assistant-process')).state.unknown)).toBe(false);
 await expect(page.locator('.r3h')).toHaveText('Комплект принят системой');
 await expect(page.locator('.r3h')).not.toContainText('Подготовка начата');
 expect(await page.evaluate(()=>assistantCalls.filter(c=>c.action==='assistant-prepare').length)).toBe(1);
});

test('same-owner refresh keeps dirty note, open details, focus and scroll without saving',async({page})=>{
 await seed(page);await page.locator('.request-maintenance summary').click();
 const note=page.locator('#note');await note.fill('Несохранённый черновик');await note.focus();
 const before=await page.evaluate(()=>({scroll:scrollY,note:item('assistant-process').note}));
 await page.evaluate(()=>render());
 await expect(note).toHaveValue('Несохранённый черновик');await expect(note).toBeFocused();
 await expect(page.locator('.request-maintenance')).toHaveAttribute('open','');
 expect(await page.evaluate(()=>item('assistant-process').note)).toBe(before.note);
 expect(await page.evaluate(scroll=>Math.abs(scrollY-scroll),before.scroll)).toBeLessThan(3);
});

for(const width of [390,1440])test('access screen keeps the shared visual shell and password controls at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4173/activate.html');
 await expect(page.locator('.access-brand')).toContainText('Кабинет студента');
 await expect(page.getByRole('heading',{name:'Добро пожаловать в «Кабинет студента»'})).toBeVisible();
 await expect(page.locator('#submit')).toBeDisabled();
 await expect(page.locator('#status')).toContainText('Приглашение недоступно');
 const password=page.getByLabel('Придумайте пароль',{exact:true});await password.fill('Synthetic-demo-123');
 await page.getByRole('button',{name:'Показать пароль: Придумайте пароль',exact:true}).click();
 await expect(password).toHaveAttribute('type','text');await expect(password).toHaveValue('Synthetic-demo-123');
 await page.getByRole('button',{name:'Скрыть пароль: Придумайте пароль',exact:true}).click();await expect(password).toHaveAttribute('type','password');
 expect(await page.locator('.access-header').evaluate(e=>getComputedStyle(e).backgroundImage)).toContain('linear-gradient');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const file of ['index.html','reestr.html'])test('notification settings confirm Telegram only after actual server binding in '+file,async({page})=>{
 await page.goto('http://127.0.0.1:4173/'+file);
 await page.evaluate(()=>QA.switchUser('notification-channels-synthetic'));
 await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy&&!!window.StudNotificationChannels)).toBe(true);
 await page.evaluate(()=>{
  window.channelCalls=[];window.telegramBound=false;window.telegramWindows=[];window.open=url=>{telegramWindows.push(url);return null;};
  Oblako.requestApi=async input=>{channelCalls.push(input.action);if(input.action==='notification-state')return {push:{configured:false},telegram:{configured:telegramBound},email:{configured:true},deliveries:[]};if(input.action==='telegram-link')return {url:'https://t.me/example_bot?start=synthetic',expiresAt:new Date(Date.now()+3600000).toISOString()};throw Error('Unexpected channel action');};
  tab='more';render();
 });
 const summary=page.getByText(file==='index.html'?'Уведомления и напоминания':'Уведомления на этом устройстве',{exact:true});await summary.click();
 const channels=page.locator('[data-notification-settings]');
 await expect(channels.getByRole('button',{name:'Подключить Telegram',exact:true})).toBeVisible();
 await channels.getByRole('button',{name:'Подключить Telegram',exact:true}).click();
 await expect(channels.getByRole('link',{name:'Открыть Telegram',exact:true})).toHaveAttribute('href','https://t.me/example_bot?start=synthetic');
 await expect(channels).toContainText('нажмите «Старт»');await expect(channels.getByRole('button',{name:'Отключить Telegram',exact:true})).toHaveCount(0);
 await page.evaluate(()=>telegramBound=true);await channels.getByRole('button',{name:'Проверить подключения',exact:true}).click();
 await expect(channels.getByRole('button',{name:'Отключить Telegram',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>channelCalls.includes('push-test')||channelCalls.includes('notification-test'))).toBe(false);
});

for(const provider of ['claude','chatgpt','deepseek'])test('manual '+provider+' is available with disconnected API and retains requirement gate',async({page})=>{
 await seed(page);
 await page.evaluate(()=>{window.chatWindows=[];window.open=u=>chatWindows.push(u);});
 await page.locator('[data-act="r3-assistant-chat"][data-method="'+provider+'"]').click();
 await expect(page.locator('[role="dialog"]')).toContainText('Перед подготовкой');
 expect(await page.evaluate(()=>chatWindows.length)).toBe(0);
 expect(await page.evaluate(()=>assistantCalls.some(c=>['assistant-start','assistant-preflight','claude-queue'].includes(c.action)))).toBe(false);
});

for(const provider of ['claude','chatgpt','deepseek'])test('approved manual '+provider+' opens correct chat and offers export and return without launching API',async({page})=>{
 await seed(page);await page.evaluate(()=>{window.chatWindows=[];window.open=u=>chatWindows.push(u);preparationBlockers=()=>[];buildChatgptPrompt=()=> 'Approved requirements and structure';copyText=async()=>true;});
 await page.locator('[data-act="r3-assistant-chat"][data-method="'+provider+'"]').click();
 const dialog=page.locator('[role="dialog"]');await expect(dialog.locator('textarea')).toHaveValue('Approved requirements and structure');await expect(dialog.locator('[data-chat-bundle]')).toBeVisible();await expect(dialog.locator('input[data-r3-result-file]')).toHaveCount(1);
 expect(await page.evaluate(()=>chatWindows)).toEqual([{claude:'https://claude.ai/',chatgpt:'https://chatgpt.com/',deepseek:'https://chat.deepseek.com/'}[provider]]);
 expect(await page.evaluate(()=>assistantCalls.some(c=>['assistant-start','assistant-preflight','claude-queue'].includes(c.action)))).toBe(false);
});

for(const width of [390,1440])test('legacy saved copy restores chat choice without enabling duplicate API at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await seed(page);
 await page.evaluate(stamp=>{item('assistant-process').claude={queuedAt:stamp,startedAt:null,readyAt:null,attachedAt:null,error:null};const s=r3AutomaticSession(item('assistant-process'));s.state.capabilities.forEach(p=>p.available=true);render();},stamp);
 await expect(page.locator('.r3h')).toHaveText('Материалы получены');
 const chats=page.locator('[data-act="r3-assistant-chat"]');await expect(chats).toHaveCount(3);for(let i=0;i<3;i++)await expect(chats.nth(i)).toBeEnabled();
 const api=page.locator('[data-act="r3-assistant-run"]');await expect(api).toHaveCount(3);for(let i=0;i<3;i++)await expect(api.nth(i)).toBeEnabled();
 await api.nth(2).click();await expect(page.getByRole('dialog')).toContainText('Прежняя передача требует проверки');await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 expect(await page.evaluate(()=>assistantCalls.some(c=>['assistant-start','assistant-preflight'].includes(c.action)))).toBe(false);
 await page.evaluate(stamp=>{observedJob={id:'active-job',provider:'claude',state:'queued',acceptedAt:stamp,queuedAt:stamp};return r3AutomaticSession(item('assistant-process')).refresh();},stamp);
 await expect(chats).toHaveCount(0);await expect(page.locator('.r3h')).toHaveText('Ожидается запуск');
 expect(await page.evaluate(()=>item('assistant-process').claude.queuedAt)).toBe(stamp);
});

// UI-03/UI-04: a refused passport must leave a usable route to the originals.
for(const width of [390,1440])test('requirements refusal keeps materials and retry accessible at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await seed(page);
 await page.evaluate(()=>{
  const original=Oblako.requestApi;
  Oblako.requestApi=async body=>{
   if(body.action==='passport-ensure'){assistantCalls.push(body);throw Error('Заявка получена, но изучение оригиналов ещё не завершено. Подготовка не разрешена');}
   return original(body);
  };
 });
 if(width===390){await page.locator('[data-act="r3-assistant-chat"][data-method="claude"]').click();await page.getByRole('button',{name:'Проверить требования и материалы'}).click();}
 else{await page.locator('.r3-secondary summary').click();await page.getByText('Требования и редактор',{exact:true}).click();}
 await expect(page.getByRole('dialog')).toHaveCount(1);
 const dialog=page.getByRole('dialog',{name:'Требования перед подготовкой'});
 await expect(dialog.getByRole('status')).toContainText('изучение оригиналов ещё не завершено');
 await dialog.getByRole('button',{name:'Повторить проверку'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(1);
 await expect(dialog.getByRole('status')).toContainText('Подготовка не разрешена');
 await dialog.getByRole('button',{name:'Открыть материалы'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('tab',{name:'Материалы',exact:true})).toHaveAttribute('aria-selected','true');
 expect(await page.evaluate(()=>assistantCalls.filter(c=>c.action==='passport-ensure').length)).toBe(2);
 expect(await page.evaluate(()=>assistantCalls.some(c=>['assistant-start','assistant-prepare','passport-approve'].includes(c.action)))).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('requirements loading prevents duplicate requests and closing prevents a late editor',async({page})=>{
 await seed(page);
 await page.evaluate(()=>{
  window.documentOpened=0;openDocBuilder=()=>documentOpened++;
  loadPassports=()=>new Promise(resolve=>window.finishRequirements=resolve);
  openR3AssistantDocument(item('assistant-process'));openR3AssistantDocument(item('assistant-process'));
 });
 const dialog=page.getByRole('dialog',{name:'Требования перед подготовкой'});
 await expect(page.getByRole('dialog')).toHaveCount(1);
 await expect(dialog.getByRole('status')).toHaveText('Проверяем требования и материалы…');
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.evaluate(()=>{item('assistant-process').passports=[{status:'approved'}];finishRequirements();});
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>documentOpened)).toBe(0);
});
for(const approved of [false,true])test('requirements success preserves '+(approved?'approved editor':'draft passport'),async({page})=>{
 await seed(page);
 await page.evaluate(approved=>{
  window.documentOpened=0;openDocBuilder=()=>documentOpened++;
  loadPassports=async x=>{x.passports=approved?[{status:'approved'}]:[];};
  openR3AssistantDocument(item('assistant-process'));
 },approved);
 if(approved){await expect.poll(()=>page.evaluate(()=>documentOpened)).toBe(1);await expect(page.getByRole('dialog')).toHaveCount(0);}
 else{await expect(page.getByRole('dialog')).toContainText('Паспорт требований');await expect(page.locator('[data-requirements-body]')).not.toHaveAttribute('aria-busy','true');}
});

for(const width of [390,1440])test('unavailable API explains each provider and recheck never launches work at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await seed(page);
 await page.evaluate(stamp=>{item('assistant-process').claude={queuedAt:stamp,startedAt:null,readyAt:null,attachedAt:null,error:null};render();},stamp);
 await expect(page.locator('.r3h')).toHaveText('Материалы получены');
 await expect(page.locator('.workflow-next')).toContainText('Выберите нейросеть и способ подготовки');
 for(const [provider,name] of [['claude','Claude'],['chatgpt','ChatGPT'],['deepseek','DeepSeek']]){
  await page.locator('[data-act="r3-assistant-run"][data-method="'+provider+'"]').click();
  const dialog=page.getByRole('dialog',{name:'Подготовка через API '+name,exact:true});
  await expect(dialog.getByRole('status')).toHaveText('API не подключён');
  await expect(dialog).toContainText('Для автоматической передачи нужно подключить API');
  await dialog.getByRole('button',{name:'Проверить подключение и состояние',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Подготовка через API '+name,exact:true}).getByRole('status')).toHaveText('API не подключён');
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 }
 expect(await page.evaluate(()=>assistantCalls.some(c=>['assistant-prepare','assistant-preflight','assistant-start','claude-queue'].includes(c.action)))).toBe(false);
 expect(await page.evaluate(()=>item('assistant-process').claude.queuedAt)).toBe(stamp);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
