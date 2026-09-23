const {test,expect}=require('@playwright/test');

async function setup(page){
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  const x=fromPayload({id:'11111111-1111-4111-8111-111111111111',t:'Учебная проверка состава материалов',k:'Курсовая работа',rq:'Текст задания',org:'Синтетические исходные сведения'});
  const question={id:'33333333-3333-4333-8333-333333333333',item_id:'VOLUME',question:'Каков объём?',answer:'25–30 страниц',answer_source:'Ответ преподавателя'};
  const attachment={id:'22222222-2222-4222-8222-222222222222',file_name:'задание.txt',category:'assignment',size_bytes:50,file_hash:'a'.repeat(64),extracted_text:'Текст учебного задания'};
  x.requestNumber=1;x.materialRevision={state:'locked',requestRevision:2,cycleId:null,canReopen:true};x.passportMaterialRevision=2;
  x.attachments=[attachment];x.clarifications=[question];
  x.passports=[{id:'44444444-4444-4444-8444-444444444444',revision:1,status:'approved',title:'Требования',items:StudClarifications.requiredIds.map(id=>({id,category:'method',required:true,verified:true,text:id==='STRUCTURE'?'Структура: введение, анализ, заключение':'Подтверждённое условие',source:'Задание',answer_ids:id==='VOLUME'?[question.id]:[]}))}];
  D.items=[x];window.manifestItem=x;window.manifestCalls=[];
  Oblako.requestApi=async body=>{
   manifestCalls.push(body);
   if(body.action==='material-revision-state')return {materials:x.materialRevision};
   if(body.action==='attachment-context')return {attachments:[attachment],materialRevision:2};
   if(body.action==='clarification-list')return {questions:[question]};
   if(body.action==='passport-ensure'){x.passports[0].source_fingerprint=body.sourceFingerprint;return {passports:x.passports,materialRevision:2};}
   if(body.action==='passport-save')return {passport:{...body.passport,id:crypto.randomUUID(),status:'draft',revision:2},materialRevision:2};
   if(body.action==='passport-approve')return {passport:{...body.passport,id:body.passportId,status:'approved',revision:2},materialRevision:2};
   throw Error('Unexpected action '+body.action);
  };
  openId=x.id;render();
 });
}

test('C098 legacy approval cannot enable preparation without a material list',async({page})=>{
 await setup(page);
 await expect(page.locator('.workflow-next')).toContainText('Укажите состав обязательных материалов');
 await page.getByRole('tab',{name:'Требования',exact:true}).click();
 await expect(page.locator('[data-material-manifest]')).toContainText('ещё не определён');
 const error=await page.evaluate(async()=>{try{await requireApprovedPassport(manifestItem);return '';}catch(e){return e.message;}});
 expect(error).toContain('состав обязательных материалов');
 await page.evaluate(()=>openDocBuilder(manifestItem.id));
 await expect(page.locator('[data-chatgpt-open]')).toBeDisabled();
 await expect(page.locator('[data-prepare]')).toBeDisabled();
 expect(await page.evaluate(()=>manifestCalls.some(x=>x.action==='passport-approve'))).toBe(false);
});

for(const width of [390,1440])test('C098 material editor binds real evidence and keeps explicit exemptions at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page);
 await page.evaluate(()=>editPassport(manifestItem,true));
 const dialog=page.getByRole('dialog',{name:'Проверка требований'});
 await dialog.locator('[data-mm-basis]').fill('Комплект определён заданием и ответом преподавателя.');
 await dialog.getByRole('button',{name:'Добавить материал',exact:true}).click();
 const first=dialog.locator('[data-mm-row]').first();
 await first.locator('[data-mm-label]').fill('Задание и исходные сведения');
 await first.locator('summary').click();
 await first.getByLabel('задание.txt',{exact:true}).check();
 await first.locator('[data-mm-evidence="payload_fields"][value="rq"]').check();
 await first.locator('[data-mm-evidence="answer_ids"]').check();
 await expect(first).not.toContainText('ФИО');
 await dialog.getByRole('button',{name:'Добавить материал',exact:true}).click();
 const second=dialog.locator('[data-mm-row]').nth(1);
 await second.locator('[data-mm-label]').fill('Статистический опрос');
 await second.locator('[data-mm-required]').uncheck();
 await expect(second.locator('[data-mm-reason]')).toBeVisible();
 await second.locator('[data-mm-reason]').fill('Задание содержит готовые синтетические данные, опрос не предусмотрен.');
 await dialog.getByRole('button',{name:'Добавить материал',exact:true}).click();
 await dialog.locator('[data-mm-row]').last().getByRole('button',{name:'Удалить пункт из списка'}).click();
 await expect(dialog.locator('[data-mm-row]')).toHaveCount(2);
 await dialog.getByLabel('Основание новой версии').fill('Определён состав материалов и проверены привязки.');
 await dialog.getByRole('button',{name:'Сохранить уточнения',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 const stored=await page.evaluate(()=>manifestCalls.find(x=>x.action==='passport-save').passport.material_manifest);
 expect(stored.requirements).toHaveLength(2);
 expect(stored.requirements[0].attachment_ids).toEqual(['22222222-2222-4222-8222-222222222222']);
 expect(stored.requirements[0].answer_ids).toEqual(['33333333-3333-4333-8333-333333333333']);
 expect(stored.requirements[0].payload_fields).toEqual(['rq']);
 expect(stored.requirements[1].required).toBe(false);
 expect(stored.requirements[1].not_applicable_reason).toContain('опрос не предусмотрен');
 await expect(page.locator('.workflow-next').getByRole('button',{name:'Утвердить паспорт',exact:true})).toBeEnabled();
 await page.locator('.workflow-next').getByRole('button',{name:'Утвердить паспорт',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>manifestCalls.find(x=>x.action==='passport-approve')?.passport.material_manifest)).toEqual(stored);
 expect(await page.evaluate(()=>manifestItem.passports.at(-1).material_manifest)).toBeUndefined();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('C098 missing evidence and unjustified exemption stay visible and block approval',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{const p=manifestItem.passports[0];p.status='draft';p.material_manifest={basis:'Задание',requirements:[{id:'M1',label:'Исходные данные',required:true,attachment_ids:[],answer_ids:[],payload_fields:[],not_applicable_reason:''},{id:'M2',label:'Методичка',required:false,attachment_ids:[],answer_ids:[],payload_fields:[],not_applicable_reason:''}]};render();});
 await page.getByRole('tab',{name:'Требования',exact:true}).click();
 await expect(page.locator('[data-material-manifest]')).toContainText('Исходные данные: обязательный материал не предоставлен');
 await expect(page.locator('[data-material-manifest]')).toContainText('Методичка: объясните');
 await expect(page.getByRole('button',{name:'Утвердить',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>manifestCalls.some(x=>x.action==='passport-approve'))).toBe(false);
});

test('C098 superseded evidence is not silently dropped from an edited passport',async({page})=>{
 await setup(page);
 await page.evaluate(async()=>{manifestItem.passports[0].material_manifest={basis:'Старое задание',requirements:[{id:'M1',label:'Прежний файл задания',required:true,attachment_ids:['55555555-5555-4555-8555-555555555555'],answer_ids:[],payload_fields:[],not_applicable_reason:''}]};await editPassport(manifestItem,true);});
 const dialog=page.getByRole('dialog',{name:'Проверка требований'});
 await dialog.locator('[data-mm-row] summary').click();
 const obsolete=dialog.locator('[data-mm-evidence="attachment_ids"][value="55555555-5555-4555-8555-555555555555"]');
 await expect(obsolete).toBeChecked();
 await expect(dialog).toContainText('Ранее выбранное основание недоступно');
 await obsolete.uncheck();await dialog.getByLabel('задание.txt',{exact:true}).check();
 await dialog.getByLabel('Основание новой версии').fill('Привязка заменена текущим файлом задания.');
 await dialog.getByRole('button',{name:'Сохранить уточнения',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>manifestItem.passports[0].material_manifest.requirements[0].attachment_ids)).toEqual(['22222222-2222-4222-8222-222222222222']);
});
