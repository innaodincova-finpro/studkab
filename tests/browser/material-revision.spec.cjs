const {test,expect}=require('@playwright/test');

async function student(page){
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(async()=>{
  D.works=[{id:'materials-work',topic:'Дополнение учебных материалов',format:{},req:{id:'local-request',serverId:'11111111-1111-4111-8111-111111111111',number:1}}];
  window.materialCalls=[];window.materialFiles=[];window.rejectSecond=true;
  window.materialState={state:'open',requestRevision:5,cycleId:'22222222-2222-4222-8222-222222222222',reason:'Добавьте задание и исходные данные.',canUpload:true,canReopen:false,canComplete:true,blockingReason:null};
  Oblako.requestApi=async body=>{
   materialCalls.push(body);
   if(body.action==='material-revision-state')return {materials:{...materialState}};
   if(body.action==='attachment-list')return {attachments:materialFiles.map(x=>({...x}))};
   if(body.action==='attachment-upload'){
    if(body.cycleId!==materialState.cycleId)throw Error('Запрос дополнения изменился. Откройте материалы заново.');
    if(body.category==='data'&&rejectSecond)throw Error('Связь временно недоступна');
    materialFiles.push({id:crypto.randomUUID(),file_name:body.fileName,category:body.category,file_hash:body.fileHash});materialState.requestRevision++;return {attachment:materialFiles.at(-1)};
   }
   if(body.action==='material-revision-complete'){materialState.state='locked';materialState.canUpload=false;materialState.canComplete=false;materialState.requestRevision++;return {materials:{...materialState}};}
   throw Error('Unexpected '+body.action);
  };
  await openStudentMaterials('materials-work');
 });
}

test('C096 student retries partial files and explicitly completes the visible set',async({page})=>{
 await student(page);
 await page.locator('[data-request-file="assignment"]').setInputFiles({name:'assignment.txt',mimeType:'text/plain',buffer:Buffer.from('Задание')});
 await page.locator('[data-request-file="data"]').setInputFiles({name:'data.txt',mimeType:'text/plain',buffer:Buffer.from('Исходные данные')});
 await expect(page.getByRole('button',{name:'Завершить дополнение',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Сохранить выбранные файлы',exact:true}).click();
 await expect(page.locator('[data-material-status]')).toContainText('Загрузка не завершена');
 await expect(page.getByRole('button',{name:'Завершить дополнение',exact:true})).toBeDisabled();
 await page.locator('.sheet [data-x]').click();
 await page.evaluate(async()=>{rejectSecond=false;await openStudentMaterials('materials-work');});
 await expect(page.getByRole('button',{name:'Завершить дополнение',exact:true})).toBeDisabled();
 await page.locator('[data-request-file="data"]').setInputFiles({name:'data.txt',mimeType:'text/plain',buffer:Buffer.from('Исходные данные')});
 await page.getByRole('button',{name:'Сохранить выбранные файлы',exact:true}).click();
 await expect(page.locator('[data-material-status]')).toContainText('Файлы сохранены');
 await expect(page.locator('[data-material-files]')).toContainText('data.txt');
 expect(await page.evaluate(()=>materialCalls.filter(x=>x.action==='attachment-upload'&&x.category==='assignment').length)).toBe(1);
 expect(await page.evaluate(()=>materialCalls.filter(x=>x.action==='material-revision-complete').length)).toBe(0);
 await page.getByRole('button',{name:'Завершить дополнение',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>materialState.state)).toBe('locked');
 expect(await page.evaluate(()=>materialCalls.find(x=>x.action==='material-revision-complete').expectedRevision)).toBe(7);
});

test('C096 initial draft explains that the original request can still receive files',async({page})=>{
 await student(page);await page.locator('.sheet [data-x]').click();
 await page.evaluate(async()=>{materialState={...materialState,state:'initial',cycleId:null,reason:null,canUpload:true,canComplete:false};await openStudentMaterials('materials-work');});
 await expect(page.getByRole('dialog')).toContainText('Первичный комплект ещё можно дополнить');
 await expect(page.getByRole('dialog')).toContainText('откройте «Отправить заявку»');
 await expect(page.getByRole('dialog')).not.toContainText('Изменения закрыты');
 await expect(page.getByRole('button',{name:'Завершить дополнение',exact:true})).toHaveCount(0);
});

test('C096 student refuses completion after another tab changes the materials',async({page})=>{
 await student(page);await page.evaluate(()=>materialState.requestRevision++);
 await page.getByRole('button',{name:'Завершить дополнение',exact:true}).click();
 await expect(page.locator('[data-material-status]')).toContainText('Состав материалов изменился');
 expect(await page.evaluate(()=>materialCalls.some(x=>x.action==='material-revision-complete'))).toBe(false);
});

test('C096 old upload window cannot add a file to a later supplement cycle',async({page})=>{
 await student(page);
 await page.evaluate(()=>{materialState.cycleId='33333333-3333-4333-8333-333333333333';materialState.requestRevision+=2;});
 await page.locator('[data-request-file="assignment"]').setInputFiles({name:'old-window.txt',mimeType:'text/plain',buffer:Buffer.from('Файл прежнего запроса дополнения')});
 await page.getByRole('button',{name:'Сохранить выбранные файлы',exact:true}).click();
 await expect(page.locator('[data-material-status]')).toContainText('Запрос дополнения изменился');
 expect(await page.evaluate(()=>materialCalls.find(x=>x.action==='attachment-upload').cycleId)).toBe('22222222-2222-4222-8222-222222222222');
 expect(await page.evaluate(()=>materialFiles.length)).toBe(0);
 await expect(page.getByRole('button',{name:'Завершить дополнение',exact:true})).toBeDisabled();
});

test('C096 lost completion response is reconciled without another mutation',async({page})=>{
 await student(page);
 await page.evaluate(()=>{const api=Oblako.requestApi;Oblako.requestApi=async body=>{const result=await api(body);if(body.action==='material-revision-complete')throw Error('Ответ потерян');return result;};});
 await page.getByRole('button',{name:'Завершить дополнение',exact:true}).click();
 await expect(page.locator('[data-material-status]')).toContainText('Ответ потерян');
 await page.getByRole('button',{name:'Завершить дополнение',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>materialCalls.filter(x=>x.action==='material-revision-complete').length)).toBe(1);
});

test('C096 completion does not claim success when the response is a later open cycle',async({page})=>{
 await student(page);
 await page.evaluate(()=>{const api=Oblako.requestApi;Oblako.requestApi=async body=>{if(body.action==='material-revision-complete')return {materials:{...materialState,cycleId:'33333333-3333-4333-8333-333333333333'}};return api(body);};});
 await page.getByRole('button',{name:'Завершить дополнение',exact:true}).click();
 await expect(page.locator('[data-material-status]')).toContainText('Состояние материалов изменилось');
 await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('C096 upload stops before the next file when the account changes',async({page})=>{
 await student(page);
 await page.evaluate(()=>{const api=Oblako.requestApi;Oblako.requestApi=async body=>{const result=await api(body);if(body.action==='attachment-upload')D={...D};return result;};});
 await page.locator('[data-request-file="assignment"]').setInputFiles({name:'assignment.txt',mimeType:'text/plain',buffer:Buffer.from('Задание')});
 await page.locator('[data-request-file="data"]').setInputFiles({name:'data.txt',mimeType:'text/plain',buffer:Buffer.from('Исходные данные')});
 await page.getByRole('button',{name:'Сохранить выбранные файлы',exact:true}).click();
 await expect(page.getByRole('button',{name:'Сохранить выбранные файлы',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>materialCalls.filter(x=>x.action==='attachment-upload').length)).toBe(1);
 expect(await page.evaluate(()=>materialCalls.some(x=>x.action==='material-revision-complete'))).toBe(false);
});

for(const width of [390,1440])test('C096 executor return preserves old passport and refresh creates draft at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(async()=>{
  const x=fromPayload({id:'11111111-1111-4111-8111-111111111111',t:'Проверка дополнения',k:'Курсовая'});x.requestNumber=1;
  x.passports=[{id:'old-passport',revision:1,status:'approved',items:[]}];D.items=[x];window.materialItem=x;window.materialCalls=[];
  window.materialState={state:'locked',requestRevision:5,cycleId:null,reason:null,canUpload:false,canReopen:true,canComplete:false,blockingReason:null};
  Oblako.requestApi=async body=>{
   materialCalls.push(body);
   if(body.action==='material-revision-state')return {materials:{...materialState}};
   if(body.action==='material-revision-open'){materialState={...materialState,state:'open',cycleId:body.cycleId,reason:body.reason,requestRevision:6,canReopen:false};x.passports[0].status='stale';return {materials:{...materialState}};}
   if(body.action==='attachment-context')return {attachments:[],materialRevision:materialState.requestRevision};
   if(body.action==='clarification-list')return {questions:[]};
   if(body.action==='passport-get')return {passports:x.passports,materialRevision:materialState.requestRevision};
   if(body.action==='passport-ensure'){if(materialState.state==='open')throw Error('No creation while open');if(body.expectedRevision!==materialState.requestRevision)throw Error('Stale material revision');return {materialRevision:materialState.requestRevision,passports:[{id:'new-passport',revision:2,status:'draft',items:[],source_fingerprint:body.sourceFingerprint},...x.passports]};}
   throw Error('Unexpected '+body.action);
  };
  openId=x.id;await openMaterialRevision(x);
 });
 await page.getByRole('button',{name:'Открыть дополнение студенту',exact:true}).click();
 await expect(page.locator('[data-material-status]')).toContainText('от 10 до 500');
 await page.locator('[data-material-reason]').fill('Добавьте недостающие исходные данные и методические указания.');
 await page.getByRole('button',{name:'Открыть дополнение студенту',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.workflow-next')).toContainText('Ожидаются дополнительные материалы');
 expect(await page.evaluate(()=>materialCalls.some(x=>x.action==='passport-ensure'))).toBe(false);
 expect(await page.evaluate(()=>preparationBlockers(materialItem).join(' '))).toContain('дополняет материалы');
 await page.getByRole('tab',{name:'Документ',exact:true}).click();
 await expect(page.getByRole('button',{name:'Прикрепить готовый Word',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(async()=>{materialState={...materialState,state:'locked',requestRevision:8};await loadPassports(materialItem);});
 expect(await page.evaluate(()=>materialItem.passports.map(x=>x.status))).toEqual(['draft','stale']);
 expect(await page.evaluate(()=>materialCalls.filter(x=>x.action==='passport-ensure').length)).toBe(1);
});
