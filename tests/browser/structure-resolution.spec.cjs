const {test,expect}=require('@playwright/test');

test('numbering conflict is visible and a verified version clears the UI blocker',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(async()=>{
  const x=fromPayload({id:'11111111-1111-4111-8111-111111111111',t:'Тест нумерации',k:'Курсовая работа',rq:'Учебное задание'});
  const file={id:'22222222-2222-4222-8222-222222222222',category:'methodology',file_name:'method.pdf',file_hash:'a'.repeat(64),size_bytes:50,extracted_text:'2.3 Калькуляция\n2.3 Финансовые результаты\n2.5 Оборотные средства'};
  const original={fileName:file.file_name,fileHash:file.file_hash,number:'2.3',first:'Калькуляция',second:'Финансовые результаты'};
  const items=StudClarifications.requiredIds.map(id=>({id,category:'method',required:true,verified:true,text:id==='STRUCTURE'?'Структура: нумерацию следует уточнить; калькуляция, финансовые результаты':'Подтверждённое требование',source:'Методичка',answer_ids:[]}));
  x.requestNumber=1;x.materialRevision={state:'locked',requestRevision:2,cycleId:null,canReopen:true};x.passportMaterialRevision=2;x.attachments=[file];x.clarifications=[];
  x.passports=[{id:'44444444-4444-4444-8444-444444444444',revision:1,status:'draft',title:'Требования',items,material_manifest:{basis:'Методичка',requirements:[{id:'M1',label:'Методичка',required:true,attachment_ids:[file.id],answer_ids:[],payload_fields:[],not_applicable_reason:''}]}}];
  D.items=[x];window.structureItem=x;window.structureCalls=[];
  Oblako.requestApi=async body=>{
   structureCalls.push(body);
   if(body.action==='material-revision-state')return {materials:x.materialRevision};
   if(body.action==='attachment-context')return {attachments:[file],materialRevision:2};
   if(body.action==='passport-ensure'){x.passports[0].source_fingerprint=body.sourceFingerprint;return {passports:x.passports,materialRevision:2};}
   if(body.action==='passport-structure-audit'){const q=x.passports[0].items.find(i=>i.id==='STRUCTURE'),resolved=!!q.structure_resolutions?.[0]?.verified;return {findings:[{...original,resolved}]};}
   if(body.action==='clarification-list')return {questions:[]};
   if(body.action==='passport-save'){x.passports=[{...body.passport,id:crypto.randomUUID(),status:'draft',revision:2,source_fingerprint:body.sourceFingerprint}];return {passport:x.passports[0],materialRevision:2};}
   throw Error('Unexpected action '+body.action);
  };
  openId=x.id;render();await loadPassports(x);
 });
 await page.getByRole('tab',{name:'Требования',exact:true}).click();
 await expect(page.locator('.warnbar')).toContainText('Повтор номера 2.3');
 await expect(page.getByRole('button',{name:'Утвердить',exact:true})).toBeDisabled();
 await page.evaluate(()=>editPassport(structureItem,true));
 const dialog=page.getByRole('dialog',{name:'Проверка требований'});
 await expect(dialog).toContainText('Калькуляция');
 await expect(dialog).toContainText('Финансовые результаты');
 await dialog.locator('[data-number-chosen]').fill('2.4');
 await dialog.locator('[data-number-reason]').fill('В учебной методичке после второго 2.3 следует 2.5; принимаю номер 2.4 для теста.');
 await dialog.locator('[data-number-confirm]').check();
 await dialog.getByLabel('Основание новой версии').fill('Уточнена нумерация разделов учебной методички.');
 await dialog.getByRole('button',{name:'Сохранить уточнения'}).click();
 await expect(dialog).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>structureItem.structureFindings?.[0]?.resolved)).toBe(true);
 await expect(page.getByRole('button',{name:'Утвердить',exact:true})).toBeEnabled();
 const saved=await page.evaluate(()=>structureCalls.find(c=>c.action==='passport-save').passport.items.find(q=>q.id==='STRUCTURE'));
 expect(saved.structure_resolutions[0].chosenNumber).toBe('2.4');
 expect(saved.text).toContain('2.4 Финансовые результаты');
});
