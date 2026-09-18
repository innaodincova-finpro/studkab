const {test,expect}=require('@playwright/test');
async function setup(page){await page.goto('http://127.0.0.1:4173/reestr.html');await page.evaluate(()=>QA.switchUser('draft-editor'));await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);await page.evaluate(()=>{const x=fromPayload({id:'33333333-3333-4333-8333-333333333333',t:'Анализ финансового состояния предприятия',k:'Курсовая работа',n:'Тест'});x.topic='Анализ финансового состояния предприятия';x.group='Э-1';x.passports=[{id:'11111111-1111-4111-8111-111111111111',revision:1,status:'approved',title:'Требования',summary:'',items:[]}];D.items.push(x);window.draftItem=x;docOf(x);aiReady=()=>true;window.calls=[];window.actualAskAI=askAI;askAI=async(p,s,u)=>{calls.push({s,u});return{text:'Содержательный текст раздела на основе предоставленных материалов.',tokens:1};};Oblako.requestApi=async body=>{if(body.action==='attachment-context')return {attachments:[]};if(body.action!=='passport-ensure')throw Error('Unexpected request action');return {passports:[{id:'11111111-1111-4111-8111-111111111111',revision:1,status:'approved',source_fingerprint:body.sourceFingerprint,title:'Требования',summary:'',items:[]}]};};openDocBuilder(x.id);});}
async function fill(page){await page.getByText('Материалы для подготовки',{exact:true}).click();await page.locator('#draft-organization').fill('Учебная организация');await page.locator('#draft-period').fill('2024–2025');await page.locator('#draft-requirements').fill('Проанализировать ликвидность и структуру финансирования');await page.locator('#draft-materials').fill('Проверенные данные учебного примера. Ограничение: причина изменений неизвестна.');await page.locator('#draft-sources').fill('OpenStax. Financial Statement Analysis. https://openstax.org/books/principles-financial-accounting/pages/a-financial-statement-analysis');await page.locator('#draft-finance').fill('2024;100;60;40;20;40;150;15\n2025;120;70;50;30;40;180;18');}
test('section image survives editor refresh and can be removed',async({page})=>{
 await setup(page);
 const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 await page.locator('[data-sec="ch1"] [data-figfile]').setInputFiles({name:'test-chart.png',mimeType:'image/png',buffer:pixel});
 await page.getByText('Редактировать разделы',{exact:true}).click();
 await page.locator('[data-sec="ch1"] > summary').click();
 await expect(page.locator('#docSecs').getByText('Рисунок 1 — test chart',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>draftItem.doc.structure.ch1.figures.length)).toBe(1);
 await expect(page.locator('#docPreview img[alt="Рисунок 1 — test chart"]')).toBeVisible();
 await page.locator('[data-sec="ch1"] [data-figdel]').click();
 expect(await page.evaluate(()=>draftItem.doc.structure.ch1.figures.length)).toBe(0);
});
test('saved document is shown on the request card after closing the editor',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{openId=draftItem.id;render();});
 await page.getByText('Редактировать разделы',{exact:true}).click();
 await page.locator('[data-sec="ch1"] > summary').click();
 await page.locator('[data-sec="ch1"] .secText').fill('Сохранённый текст документа.');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.locator('.sheet > .sheet-in > .close').click();
 await page.getByText('Документ',{exact:true}).click();
 await expect(page.getByText('Черновик ещё не собирался.',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Открыть документ',exact:true})).toBeVisible();
 await expect(page.getByText(/разделов · 28 знаков · правка/)).toBeVisible();
});
test('one preparation control starts a saved server job',async({page})=>{
 await setup(page);await fill(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{window.preparationActions=[];Oblako.generationApi=async body=>{preparationActions.push(body.action);if(body.action==='history')return {jobs:[]};if(body.action==='estimate')return {estimatedCostMicrousd:18000,maxCostMicrousd:250000,remainingMicrousd:500000};if(body.action==='start')return {job:'22222222-2222-4222-8222-222222222222'};throw Error('Unexpected action');};});
 await expect(page.getByRole('button',{name:'Начать подготовку',exact:true})).toHaveCount(1);
 await expect(page.getByText('Подготовка в облаке',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Начать подготовку',exact:true}).click();
 await expect(page.locator('[data-prepare-message]')).toContainText('Расчётный максимум');
 await page.getByRole('button',{name:/Подтвердить запуск/}).click();
 await expect(page.locator('[data-prepare-message]')).toContainText('Окно можно закрыть');
 await expect(page.getByRole('button',{name:'Продолжить подготовку',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>preparationActions)).toEqual(['history','estimate','history','start']);
 expect(await page.evaluate(()=>draftItem.doc.serverJob.id)).toBe('22222222-2222-4222-8222-222222222222');
});

test('mobile passport is readable and blocks preparation before checking filled sections',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{
  const items=[
   {id:'FORMATTING',category:'measurable',required:true,source:'Заявка студента',text:'Оформление: {"fn":"Times New Roman","mb":20,"ml":30,"mr":15,"mt":20,"sp":1.5,"sz":14,"ind":1.25}'},
   {id:'VOLUME',category:'measurable',required:true,source:'Методические требования',text:'Объём: Не указано — требуется уточнить'}
  ];
  draftItem.requestNumber=draftItem.id;
  draftItem.passports=[{id:'11111111-1111-4111-8111-111111111111',revision:1,status:'draft',title:'Паспорт',summary:'',items}];
  Object.values(draftItem.doc.structure).forEach(part=>part.text='Уже заполненный раздел.');
  Oblako.requestApi=async body=>({passports:[{id:'11111111-1111-4111-8111-111111111111',revision:1,status:'draft',source_fingerprint:body.sourceFingerprint,title:'Паспорт',summary:'',items}]});
  window.preparationActions=[];Oblako.generationApi=async body=>{preparationActions.push(body.action);if(body.action==='history')return {jobs:[]};throw Error('Paid action is forbidden');};
  openId=draftItem.id;render();
 });
 await page.getByText('Требования и материалы',{exact:true}).click();
 await expect(page.getByText('Паспорт не утверждён — платная подготовка запрещена.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Утвердить',exact:true})).toBeDisabled();
 await expect(page.getByText(/шрифт Times New Roman, 14 пт/)).toBeVisible();
 await expect(page.getByText(/\{"fn"/)).toHaveCount(0);
 const passportItem=page.locator('.passport-item').first();
 expect(await passportItem.evaluate(el=>getComputedStyle(el).display)).toBe('block');
 await expect(page.locator('#fab')).toBeHidden();
 await expect(page.locator('.workflow-next')).toContainText('Нужно уточнить требования');
 await page.locator('.workflow-next').getByRole('button',{name:'Уточнить требования',exact:true}).click();
 const passportSheet=page.locator('.sheet');
 await expect(passportSheet.getByRole('heading',{name:'Уточнить требования'})).toBeVisible();
 await expect(passportSheet.locator('textarea')).toHaveCount(1);
 await expect(passportSheet.getByText('Объём · Методические требования',{exact:true})).toBeVisible();
 await expect(passportSheet.getByText('Оформление · Заявка студента',{exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await page.evaluate(()=>openDocBuilder(draftItem.id));
 await page.getByRole('button',{name:'Начать подготовку',exact:true}).click();
 await expect(page.locator('[data-prepare-message]')).toContainText('утвердите паспорт');
 await expect(page.locator('[data-prepare-message]')).not.toContainText('Все разделы уже заполнены');
 expect(await page.evaluate(()=>preparationActions)).toEqual([]);
});

test('request card shows one next action for an approved passport',async({page})=>{
 await setup(page);await page.keyboard.press('Escape');
 await page.evaluate(()=>{draftItem.requestNumber=draftItem.id;openId=draftItem.id;render();});
 await expect(page.locator('#fab')).toBeHidden();
 await expect(page.locator('.workflow-next')).toContainText('Требования утверждены');
 await expect(page.locator('.workflow-next').getByRole('button',{name:'Начать подготовку',exact:true})).toBeVisible();
 await page.locator('.workflow-next').getByRole('button',{name:'Начать подготовку',exact:true}).click();
 await expect(page.getByRole('button',{name:'Начать подготовку',exact:true})).toBeVisible();
});

test('technical aborted fetch is not shown to the user',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{Oblako.generationApi=async()=>{throw Error('Fetch is aborted');};});
 await page.getByRole('button',{name:'Начать подготовку',exact:true}).click();
 await expect(page.locator('[data-prepare-message]')).toContainText('Сервер не ответил вовремя');
 await expect(page.locator('[data-prepare-message]')).not.toContainText('Fetch is aborted');
});

test('server preparation continues after reopening the document',async({page})=>{
 await setup(page);await page.keyboard.press('Escape');await page.evaluate(()=>{draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};Oblako.generationApi=async body=>{if(body.action==='status')return {job:{status:'running'},parts:[{ordinal:0,id:'ch1',section:'ch1',state:'done',text:'Сохранённая часть'}]};throw Error('Unexpected paid action');};openDocBuilder(draftItem.id);});
 await page.getByRole('button',{name:'Продолжить подготовку',exact:true}).click();
 await expect(page.locator('[data-prepare-message]')).toContainText('Выполняется');
 await expect(page.locator('[data-prepare-result]')).toContainText('Сохранённая часть');
});
test('long answer is revised once and an unavailable revision preserves the answer',async({page})=>{
 await setup(page);await fill(page);await page.getByText('Редактировать разделы',{exact:true}).click();for(const summary of await page.locator('[data-sec] > summary').all())await summary.click();for(const field of await page.locator('.secPages').all())await field.fill('1');
 await page.evaluate(()=>{window.edits=0;askAI=async(p,s,u)=>{if(u.includes('Редакторская проверка:')){edits++;throw Error('Редактор недоступен');}return {text:'Достоверный текст. '.repeat(140),tokens:1};};});
 await page.locator('[data-sec="ch1"] [data-secgen]').click();await expect(page.locator('#docStatus')).toContainText('Готово');
 expect(await page.evaluate(()=>edits)).toBe(1);expect(await page.evaluate(()=>draftItem.doc.structure.ch1.text)).toContain('Достоверный текст.');
 await page.getByRole('button',{name:'Проверить готовность',exact:true}).click();await expect(page.getByText('Замечания к объёму и повторам:',{exact:true})).toBeVisible();
});

test('one automatic revision removes flagged recommendations without an extra user action',async({page})=>{
 await setup(page);await fill(page);
 await page.evaluate(()=>{window.edits=0;askAI=async(p,s,u)=>{
  if(u.includes('Редакторская проверка:')){edits++;return{text:'На основании главы 2 следует составить платёжный календарь. Сопоставить сроки ожидаемых поступлений с обязательствами и проверить наличие кассовых разрывов. Эффект заранее не рассчитан.',tokens:1};}
  if(u.startsWith('Подготовь раздел «Глава 3'))return{text:'Ликвидность 1,5, автономия 0,4 и рентабельность 10%. Закрепить нормативы в учётной политике.',tokens:1};
  return{text:'Содержательный текст по предоставленным материалам.',tokens:1};
 };});
 await page.getByText('Редактировать разделы',{exact:true}).click();await page.locator('[data-sec="ch3"] > summary').click();await page.locator('[data-sec="ch3"] [data-secgen]').click();
 await expect(page.locator('#docStatus')).toContainText('Готово');
 expect(await page.evaluate(()=>edits)).toBe(1);
 expect(await page.evaluate(()=>draftItem.doc.structure.ch3.text)).toContain('платёжный календарь');
 expect(await page.evaluate(()=>draftItem.doc.structure.ch3.text)).not.toContain('учётной политике');
});


test('legacy mobile generation control is blocked before network dispatch',async({page})=>{
 await setup(page);await fill(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{window.networkDispatches=0;window.fetch=async()=>{networkDispatches++;throw Error('network must not be reached');};askAI=window.actualAskAI;D.settings.providers.deepseek={on:true,model:'deepseek-chat'};document.querySelector('#docProv').value='deepseek';});
 await page.getByText('Редактировать разделы',{exact:true}).click();await page.locator('[data-sec="ch1"] > summary').click();await page.locator('[data-sec="ch1"] [data-secgen]').click();
 await expect(page.locator('#docStatus')).toContainText('Прямые платные запросы отключены');
 expect(await page.evaluate(()=>networkDispatches)).toBe(0);
 expect(await page.evaluate(()=>D.aiDiagnostics?.length||0)).toBe(0);
});

test('preparation blocks zero budget and preserves edited document',async({page})=>{
 await setup(page);await fill(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{Oblako.generationApi=async body=>{if(body.action==='history')return {jobs:[]};if(body.action==='estimate')throw Error('BUDGET_BLOCKED');throw Error('Unexpected mutation');};});
 await page.getByRole('button',{name:'Начать подготовку',exact:true}).click();
 await expect(page.locator('[data-prepare-message]')).toContainText('денежный потолок');
 await page.evaluate(()=>{draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:'older-version'};draftItem.doc.structure.ch1.text='Мой сохранённый текст';Oblako.generationApi=async()=>({job:{status:'unknown'},parts:[{ordinal:0,id:'ch1',section:'ch1',state:'done',text:'Облачный текст'}]});});
 await page.getByRole('button',{name:'Начать подготовку',exact:true}).click();
 await expect(page.locator('[data-prepare-message]')).toContainText('прежней версии');
 expect(await page.evaluate(()=>draftItem.doc.structure.ch1.text)).toBe('Мой сохранённый текст');
 await page.getByText('Собранный текст и объём',{exact:true}).click();
 await page.getByText(/^Глава 1.*— слов:/).click();
 await expect(page.locator('[data-prepare-result]')).toContainText('Облачный текст');
});

test('over-limit estimate shows exact amount without sending start',async({page})=>{
 await setup(page);await fill(page);
 await page.evaluate(()=>{window.generationActions=[];Oblako.generationApi=async body=>{
  generationActions.push(body.action);if(body.action==='history')return {jobs:[]};
  if(body.action==='estimate')return {canStart:false,estimatedCostMicrousd:321456,maxCostMicrousd:250000,remainingMicrousd:250000};
  throw Error('Start must remain blocked');
 };});
 await page.getByRole('button',{name:'Начать подготовку',exact:true}).click();
 await expect(page.locator('[data-prepare-message]')).toContainText('0.321 USD');
 await expect(page.locator('[data-prepare-message]')).toContainText('Запуск заблокирован');
 await expect(page.getByRole('button',{name:'Начать подготовку',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>generationActions)).toEqual(['history','estimate']);
});

test('preparation copies provided references without sending them to generation',async({page})=>{
 await setup(page);await fill(page);
 await page.evaluate(()=>{window.sentParts=[];Oblako.generationApi=async body=>{
  if(body.action==='history')return {jobs:[]};
  if(body.action==='estimate'){sentParts=body.parts;return {canStart:false,estimatedCostMicrousd:190000,maxCostMicrousd:250000,remainingMicrousd:250000};}
  throw Error('Start must remain blocked');
 };});
 await page.getByRole('button',{name:'Начать подготовку',exact:true}).click();
 expect(await page.evaluate(()=>sentParts.some(part=>part.id==='refs'))).toBe(false);
 expect(await page.evaluate(()=>draftItem.doc.structure.refs.text)).toContain('OpenStax');
 await expect(page.locator('[data-sec="refs"] .secStat')).toContainText('Предоставленные источники');
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
 await page.getByRole('button',{name:'Начать подготовку',exact:true}).click();
 await expect(page.locator('[data-recover-job]')).toHaveCount(2);
 await page.locator('[data-recover-job]').first().click();
 await expect(page.locator('[data-prepare-message]')).toContainText('не подтверждена');
 expect(await page.evaluate(()=>draftItem.doc.serverJob.id)).toBe('22222222-2222-4222-8222-222222222222');
 expect(await page.evaluate(()=>draftItem.doc.structure.ch1.text)).toBe('Мой текст');
 expect(await page.evaluate(()=>recoveryActions)).toEqual(['history','status']);
 await page.getByText('Собранный текст и объём',{exact:true}).click();
 await page.getByText(/^Глава 1.*— слов:/).click();
 await expect(page.locator('[data-prepare-result]')).toContainText('Сохранённый ответ');
});

test('known output limit is shown instead of a generic unknown result',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};Oblako.generationApi=async()=>({job:{status:'unknown'},parts:[{ordinal:0,id:'ch2__part_1',state:'unknown',text:null,failure:{code:'OUTPUT_LIMIT',completion_tokens:2500}}]});});
 await page.locator('[data-prepare]').click();
 await expect(page.locator('[data-prepare-message]')).toContainText('достигнут предел длины ответа');
 await expect(page.locator('[data-prepare-message]')).toContainText('Автоматический повтор заблокирован');
 await expect(page.locator('[data-prepare-message]')).not.toContainText('Результат последнего запроса неизвестен');
});

test('cloud review assembles one response with visible gaps and preserves local draft',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{draftItem.doc.structure.ch1.text='Мой исходный текст';draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};
 window.cloudActions=[];Oblako.generationApi=async body=>{cloudActions.push(body.action);if(body.action!=='status')throw Error('Unexpected paid call');return {job:{status:'unknown'},parts:[
 {ordinal:2,id:'ch2__part_3',section:'ch2',state:'done',text:'Третий абзац.'},
 {ordinal:0,id:'ch2__part_1',section:'ch2',state:'done',text:'Первый абзац. <img src=x onerror="window.injected=true">'},
 {ordinal:1,id:'ch2__part_2',section:'ch2',state:'unknown',text:null}]};};});
 await page.locator('[data-prepare]').click();
 await page.getByText('Собранный текст и объём',{exact:true}).click();
 await expect(page.locator('[data-prepare-result]')).toContainText('2 из 3 частей');
 await page.getByText(/^Глава 2.*— слов:/).click();
 await expect(page.locator('[data-prepare-result]')).toContainText('[Часть 2 не сохранена]');
 expect(await page.locator('[data-prepare-result] img').count()).toBe(0);
 expect(await page.evaluate(()=>draftItem.doc.structure.ch1.text)).toBe('Мой исходный текст');
 expect(await page.evaluate(()=>cloudActions)).toEqual(['status']);
 expect(await page.evaluate(()=>window.injected)).toBeUndefined();
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

test('C-051: running preparation can be stopped and a new one started',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};
  window.stopActions=[];Oblako.generationApi=async body=>{stopActions.push(body);
   if(body.action==='status')return {job:{id:'22222222-2222-4222-8222-222222222222',status:'running'},parts:[{ordinal:0,id:'ch1',section:'ch1',state:'done',text:'Сохранённая часть'},{ordinal:1,id:'ch2',section:'ch2',state:'queued',text:null}]};
   if(body.action==='cancel')return {job:body.job,status:'cancelled'};
   throw Error('Unexpected paid call');};});
 await page.locator('[data-prepare]').click();
 await expect(page.getByRole('button',{name:'Остановить подготовку',exact:true})).toBeVisible();
 await page.evaluate(()=>{window.confirmAsked=0;window.confirm=()=>{confirmAsked++;return true;};});
 await page.getByRole('button',{name:'Остановить подготовку',exact:true}).click();
 await expect(page.locator('[data-prepare-message]')).toContainText('Подготовка остановлена');
 await expect(page.locator('[data-prepare]')).toHaveText('Начать подготовку');
 expect(await page.evaluate(()=>confirmAsked)).toBe(1);
 expect(await page.evaluate(()=>draftItem.doc.serverJob)).toBeNull();
 expect(await page.evaluate(()=>stopActions.map(a=>a.action))).toEqual(['status','cancel']);
 expect(await page.evaluate(()=>stopActions[1].job)).toBe('22222222-2222-4222-8222-222222222222');
});

test('C-051: declining the confirmation sends nothing',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};
  window.stopActions=[];Oblako.generationApi=async body=>{stopActions.push(body.action);
   if(body.action==='status')return {job:{id:'22222222-2222-4222-8222-222222222222',status:'queued'},parts:[]};
   throw Error('Nothing else may be called');};});
 await page.locator('[data-prepare]').click();
 // Проверочная среда подтверждает все окна; здесь явно выбираем «Отмена».
 await page.evaluate(()=>{window.confirmAsked=0;window.confirm=()=>{confirmAsked++;return false;};});
 await page.getByRole('button',{name:'Остановить подготовку',exact:true}).click();
 expect(await page.evaluate(()=>confirmAsked)).toBe(1);
 expect(await page.evaluate(()=>stopActions)).toEqual(['status']);
 expect(await page.evaluate(()=>draftItem.doc.serverJob.id)).toBe('22222222-2222-4222-8222-222222222222');
});

test('C-051: stopped and outdated runs are not offered for continuation',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{delete draftItem.doc.serverJob;
  Oblako.generationApi=async body=>{
   if(body.action==='history')return {jobs:[{id:'22222222-2222-4222-8222-222222222222',status:'cancelled',created_at:'2026-09-15T06:00:00Z'},{id:'33333333-3333-4333-8333-333333333333',status:'stale',created_at:'2026-09-15T05:00:00Z'},{id:'44444444-4444-4444-8444-444444444444',status:'complete',created_at:'2026-09-15T04:00:00Z'}]};
   throw Error('Paid Start is forbidden here');};});
 await page.evaluate(()=>{draftItem.passports=[{id:'p',status:'approved',items:[]}];});
 await page.getByRole('button',{name:'Начать подготовку',exact:true}).click();
 await expect(page.locator('[data-recover-job]')).toHaveCount(1);
 await expect(page.locator('[data-recover-job]')).toHaveAttribute('data-recover-job','44444444-4444-4444-8444-444444444444');
});

test('C-051: outdated run offers exactly one way forward',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};
  Oblako.generationApi=async body=>{if(body.action==='status')return {job:{id:'22222222-2222-4222-8222-222222222222',status:'stale'},parts:[]};throw Error('Unexpected call');};});
 await page.locator('[data-prepare]').click();
 await expect(page.locator('[data-prepare-message]')).toContainText('паспорт требований или материалы изменились');
 await expect(page.getByRole('button',{name:'Остановить подготовку',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Перейти к новой подготовке',exact:true}).click();
 expect(await page.evaluate(()=>draftItem.doc.serverJob)).toBeNull();
 await expect(page.locator('[data-prepare]')).toHaveText('Начать подготовку');
});

test('C-051: unconfirmed result explains the single automatic retry and full cost hold',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{draftItem.doc.serverJob={id:'22222222-2222-4222-8222-222222222222',basis:null};Oblako.generationApi=async body=>{if(body.action!=='status')throw Error('Unexpected call');return {job:{id:'22222222-2222-4222-8222-222222222222',status:'unknown'},parts:[{ordinal:0,id:'ch2__part_1',state:'unknown',text:null,failure:{code:'RESULT_UNKNOWN'}}]};};});
 await page.locator('[data-prepare]').click();
 await expect(page.locator('[data-prepare-message]')).toContainText('повторит эту часть не более одного раза');
 await expect(page.locator('[data-prepare-message]')).toContainText('Расход по ней учтён полностью');
 await expect(page.locator('[data-prepare-message]')).not.toContainText('Автоматический повтор заблокирован');
});
