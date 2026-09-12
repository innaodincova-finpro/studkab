const {test,expect}=require('@playwright/test');
async function setup(page){await page.goto('http://127.0.0.1:4173/reestr.html');await page.evaluate(()=>QA.switchUser('draft-editor'));await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);await page.evaluate(()=>{const x=fromPayload({id:'33333333-3333-4333-8333-333333333333',t:'Анализ финансового состояния предприятия',k:'Курсовая работа',n:'Тест'});x.topic='Анализ финансового состояния предприятия';x.group='Э-1';D.items.push(x);window.draftItem=x;docOf(x);aiReady=()=>true;window.calls=[];window.actualAskAI=askAI;askAI=async(p,s,u)=>{calls.push({s,u});return{text:'Содержательный текст раздела на основе предоставленных материалов.',tokens:1};};openDocBuilder(x.id);});}
async function fill(page){await page.getByText('Материалы для подготовки',{exact:true}).click();await page.locator('#draft-organization').fill('Учебная организация');await page.locator('#draft-period').fill('2024–2025');await page.locator('#draft-requirements').fill('Проанализировать ликвидность и структуру финансирования');await page.locator('#draft-materials').fill('Проверенные данные учебного примера. Ограничение: причина изменений неизвестна.');await page.locator('#draft-sources').fill('OpenStax. Financial Statement Analysis. https://openstax.org/books/principles-financial-accounting/pages/a-financial-statement-analysis');await page.locator('#draft-finance').fill('2024;100;60;40;20;40;150;15\n2025;120;70;50;30;40;180;18');}
test('one action prepares linked sections and incomplete quality blocks approval',async({page})=>{await setup(page);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Подготовить весь черновик',exact:true}).click();await expect(page.locator('#docStatus')).toContainText('Добавьте');expect(await page.evaluate(()=>calls.length)).toBe(0);await fill(page);await page.getByRole('button',{name:'Подготовить весь черновик',exact:true}).click();await expect(page.locator('#docStatus')).toContainText('Текст подготовлен');expect(await page.evaluate(()=>calls.length)).toBe(5);expect(await page.evaluate(()=>calls[1].u)).toContain('Содержательный текст');expect(await page.evaluate(()=>draftItem.doc.structure.ch2.text)).toContain('Таблица 2');await expect(page.locator('[data-sec="refs"] .secStat')).toContainText('Предоставленные источники');const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать Word',exact:true}).click();await (await dl).saveAs('test-results/grounded-draft.docx');await page.screenshot({path:'test-results/drafting-mobile.png'});await page.getByRole('button',{name:'Проверить готовность',exact:true}).click();await expect(page.getByText('Передача пока недоступна:',{exact:true})).toBeVisible();await expect(page.getByRole('checkbox')).toHaveCount(0);expect(await page.evaluate(()=>draftItem.doc.review)).toBeFalsy();});
test('failed section resumes without repeating saved sections or erasing backup',async({page})=>{await setup(page);await fill(page);await page.evaluate(()=>{window.failOnce=true;askAI=async(p,s,u)=>{calls.push(u);if(failOnce&&u.startsWith('Подготовь раздел «Глава 2')){failOnce=false;throw Error('Тестовый сбой');}return{text:'Проверенный текст.',tokens:1};};});await page.getByRole('button',{name:'Подготовить весь черновик',exact:true}).click();await expect(page.locator('#docStatus')).toContainText('Остановился');expect(await page.evaluate(()=>calls.length)).toBe(2);await page.getByRole('button',{name:'Подготовить весь черновик',exact:true}).click();await expect(page.locator('#docStatus')).toContainText('Текст подготовлен');expect(await page.evaluate(()=>calls.filter(u=>u.startsWith('Подготовь раздел «Глава 1')).length)).toBe(1);expect(await page.evaluate(()=>draftItem.doc.previous.structure.ch1.text)).toBe('');});
test('stale AI response never writes to another account',async({page})=>{await setup(page);await fill(page);await page.evaluate(()=>askAI=()=>new Promise(r=>window.resolveDraft=r));await page.getByRole('button',{name:'Подготовить весь черновик',exact:true}).click();await expect.poll(()=>page.evaluate(()=>!!window.resolveDraft)).toBe(true);await page.evaluate(()=>QA.switchUser('other-draft'));await expect.poll(()=>page.evaluate(()=>Oblako.email)).toBe('other-draft@example.test');await page.evaluate(()=>resolveDraft({text:'Запоздалый текст',tokens:1}));await expect.poll(()=>page.evaluate(()=>genBusy)).toBe(false);expect(await page.evaluate(()=>JSON.stringify(D))).not.toContain('Запоздалый текст');});
test('long answer is revised once and an unavailable revision preserves the answer',async({page})=>{
 await setup(page);await fill(page);await page.getByText('Редактировать разделы',{exact:true}).click();for(const summary of await page.locator('[data-sec] > summary').all())await summary.click();for(const field of await page.locator('.secPages').all())await field.fill('1');
 await page.evaluate(()=>{window.edits=0;askAI=async(p,s,u)=>{if(u.includes('Редакторская проверка:')){edits++;throw Error('Редактор недоступен');}return {text:'Достоверный текст. '.repeat(140),tokens:1};};});
 await page.getByRole('button',{name:'Подготовить весь черновик',exact:true}).click();await expect(page.locator('#docStatus')).toContainText('Текст подготовлен');
 expect(await page.evaluate(()=>edits)).toBe(5);expect(await page.evaluate(()=>draftItem.doc.structure.ch1.text)).toContain('Достоверный текст.');
 await page.getByRole('button',{name:'Проверить готовность',exact:true}).click();await expect(page.getByText('Замечания к объёму и повторам:',{exact:true})).toBeVisible();
});

test('one automatic revision removes flagged recommendations without an extra user action',async({page})=>{
 await setup(page);await fill(page);
 await page.evaluate(()=>{window.edits=0;askAI=async(p,s,u)=>{
  if(u.includes('Редакторская проверка:')){edits++;return{text:'На основании главы 2 следует составить платёжный календарь. Сопоставить сроки ожидаемых поступлений с обязательствами и проверить наличие кассовых разрывов. Эффект заранее не рассчитан.',tokens:1};}
  if(u.startsWith('Подготовь раздел «Глава 3'))return{text:'Ликвидность 1,5, автономия 0,4 и рентабельность 10%. Закрепить нормативы в учётной политике.',tokens:1};
  return{text:'Содержательный текст по предоставленным материалам.',tokens:1};
 };});
 await page.getByRole('button',{name:'Подготовить весь черновик',exact:true}).click();
 await expect(page.locator('#docStatus')).toContainText('Текст подготовлен');
 expect(await page.evaluate(()=>edits)).toBe(1);
 expect(await page.evaluate(()=>draftItem.doc.structure.ch3.text)).toContain('платёжный календарь');
 expect(await page.evaluate(()=>draftItem.doc.structure.ch3.text)).not.toContain('учётной политике');
});


test('generation failure appears in journal and can be copied on mobile',async({page})=>{
 await setup(page);await fill(page);await page.setViewportSize({width:390,height:844});
 await page.route('http://127.0.0.1:4173/diagnostic-mock',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({error:'INCOMPLETE:deepseek',detail:{reason:'length',completion_tokens:8000,limit_tokens:8000,request_id:'test-provider-1'}})}));
 await page.evaluate(()=>{askAI=window.actualAskAI;D.settings.proxyUrl='http://127.0.0.1:4173/diagnostic-mock';D.settings.proxyToken='test-only';D.settings.providers.deepseek={on:true,model:'deepseek-chat'};document.querySelector('#docProv').value='deepseek';});
 await page.getByRole('button',{name:'Подготовить весь черновик',exact:true}).click();
 await expect(page.locator('#docStatus')).toContainText('Остановился');
 const record=await page.evaluate(()=>D.aiDiagnostics.at(-1));
 expect(record.section).toBe('ch1');expect(record.stage).toBe('draft');expect(record.reason).toBe('length');expect(record.client_request_id).toBeTruthy();
 await page.keyboard.press('Escape');await page.locator('[data-tab="more"]').click();
 // Open the actual journal UI; replace only the OS clipboard boundary.
 await page.getByText(/Журнал подготовки \(1\)/).click();
 await expect(page.getByText(/ответ обрезан по пределу длины/)).toBeVisible();
 await page.evaluate(()=>copyText=value=>{window.copiedJournal=value;});
 await page.getByRole('button',{name:'Скопировать журнал',exact:true}).click();
 expect(await page.evaluate(()=>window.copiedJournal)).toContain(record.client_request_id);
 await page.screenshot({path:'test-results/diagnostics-mobile.png'});
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Очистить',exact:true}).click();
 expect(await page.evaluate(()=>D.aiDiagnostics.length)).toBe(0);
});

test('cloud preparation blocks zero budget and preserves edited document',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{Oblako.generationApi=async body=>{if(body.action==='capabilities')return {enabled:true,budgetAvailable:false};throw Error('Unexpected mutation');};});
 await page.getByText('Подготовка в облаке',{exact:true}).click();
 await page.getByRole('button',{name:'Проверить доступность',exact:true}).click();
 await expect(page.locator('[data-cloud-message]')).toContainText('бюджет');
 await expect(page.locator('[data-cloud-start]')).toBeDisabled();
 await page.evaluate(()=>{draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:'older-version'};draftItem.doc.structure.ch1.text='Мой сохранённый текст';Oblako.generationApi=async()=>({job:{status:'unknown'},parts:[{ordinal:0,id:'ch1',section:'ch1',state:'done',text:'Облачный текст'}]});});
 await page.getByRole('button',{name:'Проверить результат',exact:true}).click();
 await expect(page.locator('[data-cloud-message]')).toContainText('прежней версии');
 expect(await page.evaluate(()=>draftItem.doc.structure.ch1.text)).toBe('Мой сохранённый текст');
 await page.getByText('Собранный текст и объём',{exact:true}).click();
 await page.getByText(/^Глава 1.*— слов:/).click();
 await expect(page.locator('[data-cloud-result]')).toContainText('Облачный текст');
});

test('lost cloud job link is recovered by selection without another paid start',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{
  draftItem.doc.structure.ch1.text='Мой текст';delete draftItem.doc.serverJob;
  window.recoveryActions=[];
  Oblako.generationApi=async body=>{
   recoveryActions.push(body.action);
   if(body.action==='history')return {jobs:[{id:'22222222-2222-4222-8222-222222222222',created_at:'2026-09-12T06:00:00Z'},{id:'33333333-3333-4333-8333-333333333333',created_at:'2026-09-12T05:00:00Z'}]};
   if(body.action==='status')return {job:{status:'complete'},parts:[{ordinal:0,id:'ch1',section:'ch1',state:'done',text:'Сохранённый ответ'}]};
   throw Error('Paid Start is forbidden in recovery');
  };
 });
 await page.getByText('Подготовка в облаке',{exact:true}).click();
 await page.getByRole('button',{name:'Проверить результат',exact:true}).click();
 await expect(page.locator('[data-recover-job]')).toHaveCount(2);
 await page.locator('[data-recover-job]').first().click();
 await expect(page.locator('[data-cloud-message]')).toContainText('не подтверждена');
 expect(await page.evaluate(()=>draftItem.doc.serverJob.id)).toBe('22222222-2222-4222-8222-222222222222');
 expect(await page.evaluate(()=>draftItem.doc.structure.ch1.text)).toBe('Мой текст');
 expect(await page.evaluate(()=>recoveryActions)).toEqual(['history','status']);
 await page.getByText('Собранный текст и объём',{exact:true}).click();
 await page.getByText(/^Глава 1.*— слов:/).click();
 await expect(page.locator('[data-cloud-result]')).toContainText('Сохранённый ответ');
});

test('known output limit is shown instead of a generic unknown result',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};Oblako.generationApi=async()=>({job:{status:'unknown'},parts:[{ordinal:0,id:'ch2__part_1',state:'unknown',text:null,failure:{code:'OUTPUT_LIMIT',completion_tokens:2500}}]});});
 await page.getByText('Подготовка в облаке',{exact:true}).click();
 await page.getByRole('button',{name:'Проверить результат',exact:true}).click();
 await expect(page.locator('[data-cloud-message]')).toContainText('достигнут предел длины ответа');
 await expect(page.locator('[data-cloud-message]')).toContainText('Автоматический повтор заблокирован');
 await expect(page.locator('[data-cloud-message]')).not.toContainText('Результат последнего запроса неизвестен');
});

test('cloud review assembles one response with visible gaps and preserves local draft',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{draftItem.doc.structure.ch1.text='Мой исходный текст';draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};
 window.cloudActions=[];Oblako.generationApi=async body=>{cloudActions.push(body.action);if(body.action!=='status')throw Error('Unexpected paid call');return {job:{status:'unknown'},parts:[
 {ordinal:2,id:'ch2__part_3',section:'ch2',state:'done',text:'Третий абзац.'},
 {ordinal:0,id:'ch2__part_1',section:'ch2',state:'done',text:'Первый абзац. <img src=x onerror="window.injected=true">'},
 {ordinal:1,id:'ch2__part_2',section:'ch2',state:'unknown',text:null}]};};});
 await page.getByText('Подготовка в облаке',{exact:true}).click();
 await page.getByRole('button',{name:'Проверить результат',exact:true}).click();
 await page.getByText('Собранный текст и объём',{exact:true}).click();
 await expect(page.locator('[data-cloud-result]')).toContainText('2 из 3 частей');
 await page.getByText(/^Глава 2.*— слов:/).click();
 await expect(page.locator('[data-cloud-result]')).toContainText('[Часть 2 не сохранена]');
 expect(await page.locator('[data-cloud-result] img').count()).toBe(0);
 expect(await page.evaluate(()=>draftItem.doc.structure.ch1.text)).toBe('Мой исходный текст');
 expect(await page.evaluate(()=>cloudActions)).toEqual(['status']);
 expect(await page.evaluate(()=>window.injected)).toBeUndefined();
});

test('download incomplete cloud Word uses captured version without changing local text',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{draftItem.doc.structure.ch1.text='Локальный текст не для экспорта';draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};
 window.exportCalls=[];Oblako.generationApi=async b=>{exportCalls.push(b.action);return {job:{id:'22222222-2222-4222-8222-222222222222',version:'version1',status:'unknown'},parts:[{ordinal:0,id:'ch2',section:'ch2',state:'done',text:'Облачный текст для проверки.'},{ordinal:1,id:'ch2b',section:'ch2',state:'unknown',text:null}]};};});
 await page.getByText('Подготовка в облаке',{exact:true}).click();await page.getByRole('button',{name:'Проверить результат',exact:true}).click();await page.getByText('Собранный текст и объём',{exact:true}).click();
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать неполный Word',exact:true}).click();const file=await pending;await file.saveAs('test-results/cloud-incomplete.docx');
 const zip=require('node:fs').readFileSync('test-results/cloud-incomplete.docx').toString('utf8');expect(zip).toContain('Неполный черновик');expect(zip).toContain('version1');expect(zip).toContain('Часть 2 не сохранена');expect(zip).not.toContain('Локальный текст не для экспорта');
 expect(await page.evaluate(()=>draftItem.doc.structure.ch1.text)).toBe('Локальный текст не для экспорта');expect(await page.evaluate(()=>exportCalls)).toEqual(['status']);
});


test('FIN-UAT original criteria prevent approval through the general checkbox',async({page})=>{
 await setup(page);await fill(page);
 await page.locator('#draft-requirements').fill('УЧЕБНАЯ МЕТОДИЧКА FIN-UAT-01\nАвторские критерии приёмки версии 1.0.');
 await page.getByRole('button',{name:'Проверить готовность',exact:true}).click();
 await expect(page.getByText(/Основной текст: 0 слов/)).toBeVisible();
 await expect(page.getByText(/Общая галочка не разрешает передачу/)).toBeVisible();
 await expect(page.locator('[data-approve]')).toHaveCount(0);
});

test('extended financial calculation uses existing materials without AI calls',async({page})=>{
 await setup(page);await page.keyboard.press('Escape');
 const f=require('../fixtures/financial-synthetic.cjs'),materials=f.material(f.fixture());
 await page.evaluate(text=>{draftItem.doc.inputs={requirements:'УЧЕБНАЯ МЕТОДИЧКА FIN-UAT-01\nАвторские критерии приёмки версии 1.0.',materials:text,finance:''};openDocBuilder(draftItem.id);},materials);
 await page.getByText('Материалы для подготовки',{exact:true}).click();
 await page.getByRole('button',{name:'Рассчитать 20 показателей',exact:true}).click();
 await expect(page.getByText('Финансовые расчёты',{exact:true})).toBeVisible();
 await expect(page.getByText('Арифметическая проверка пройдена.',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>calls.length)).toBe(0);
 await expect(page.getByRole('cell',{name:'25,00',exact:true})).toHaveCount(3);
});
