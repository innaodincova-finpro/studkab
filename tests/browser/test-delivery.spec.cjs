const {test,expect}=require('@playwright/test');
async function setup(page,{student=false,eligible=true,reset=true}={}){
 await page.goto('http://127.0.0.1:4173/'+(student?'index.html':'reestr.html'));
 await page.evaluate(async({student,eligible,reset})=>{
  window.testIdentity='test-user';Oblako.identity=()=>testIdentity;window.testCalls=[];window.testEligible=eligible;
  const bytes=new TextEncoder().encode('synthetic exact test Word bytes');
  window.testBinding={versionId:'22222222-2222-4222-8222-222222222222',recipientId:'33333333-3333-4333-8333-333333333333',fileHash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join(''),documentHash:'b'.repeat(64),passportId:'44444444-4444-4444-8444-444444444444',sourceFingerprint:'c'.repeat(64)};
  window.testBytes=btoa(String.fromCharCode(...bytes));
  if(reset)sessionStorage.removeItem('C099-test-delivery');
  window.testItem={id:'11111111-1111-4111-8111-111111111111',requestNumber:1,student:'Тестовый студент',status:'progress',req:{serverId:'11111111-1111-4111-8111-111111111111'},testDeliveryState:{eligible:true}};
  // Product cards mount inside #page, whose layout accounts for the fixed navigation.
  window.testHost=document.createElement('section');testHost.hidden=true;document.getElementById('page').prepend(testHost);
  Oblako.requestApi=async body=>{
   testCalls.push(body);
   if(window.deferTestRead&&body.action==='test-result'&&body.includeFile===true)await new Promise(resolve=>window.releaseTestRead=resolve);
   if(body.action==='test-delivery-state')return {testDeliveryState:{...testBinding,eligible:testEligible,reason:'TEST_NOT_ALLOWED'}};
   if(body.action==='test-deliver'){if(!testEligible)throw Error('Нет разрешения');const old=JSON.parse(sessionStorage.getItem('C099-test-delivery')||'null');if(old&&old.deliveryId===body.deliveryId&&old.versionId!==body.versionId)throw Error('TEST_OPERATION_CONFLICT');const value={...testBinding,deliveryId:body.deliveryId,createdAt:'2026-09-23T00:00:00Z',qualityStatus:'incomplete',label:'Тестовый файл — проверка качества не завершена'};sessionStorage.setItem('C099-test-delivery',JSON.stringify(value));return {testDelivery:value};}
   if(body.action==='test-result'){const value=JSON.parse(sessionStorage.getItem('C099-test-delivery')||'null');if(value&&value.versionId!==testBinding.versionId){if(!student&&!body.includeFile)return {testDelivery:null};throw Error('TEST_VERSION_CHANGED');}if(value&&body.includeFile)value.docxBase64=testBytes;return {testDelivery:value};}
   throw Error('Unexpected action '+body.action);
  };
  await StudResults.mountTestDelivery(testItem,testHost,student);
 },{student,eligible,reset});
}
async function send(page){
 await page.locator('[data-test-open]').click();
 await expect(page.locator('[data-test-confirm]')).toBeEnabled();
 await expect(page.locator('[data-test-send]')).toBeDisabled();
 await page.locator('[data-test-confirm]').check();
 await page.locator('[data-test-send]').click();
 await expect(page.locator('.sheet [data-test-status]')).toContainText('Эта версия доступна студенту');
}

test('C099 forged local eligibility cannot reveal test delivery',async({page})=>{
 await setup(page,{eligible:false});
 await expect(page.locator('[data-test-open]')).toHaveCount(0);
 await page.evaluate(()=>StudResults.testDeliver(testItem));
 await expect(page.locator('.sheet [data-test-status]')).toContainText('Нет разрешения');
 await expect(page.locator('[data-test-send]')).toBeDisabled();
 expect(await page.evaluate(()=>testCalls.some(c=>c.action==='test-deliver'))).toBe(false);
});

test('C099 explicit separate delivery preserves ordinary status and survives reopen and reload',async({page})=>{
 await setup(page);const before=await page.evaluate(()=>JSON.stringify(D));await send(page);
 expect(await page.evaluate(()=>JSON.stringify(D))).toBe(before);
 expect(await page.evaluate(()=>testItem.status)).toBe('progress');
 expect(await page.evaluate(()=>testCalls.filter(c=>['deliver','review-result','prepare-result'].includes(c.action)))).toEqual([]);
 await page.locator('.sheet .close').click();await page.evaluate(()=>StudResults.testDeliver(testItem));
 await expect(page.locator('.sheet [data-test-status]')).toContainText('уже доступна студенту');
 expect(await page.evaluate(()=>testCalls.filter(c=>c.action==='test-deliver').length)).toBe(1);
 await setup(page,{student:true,reset:false});
 await expect(page.locator('[data-test-receive]')).toBeVisible();
 await expect(page.locator('section').filter({has:page.locator('[data-test-receive]')})).toContainText('Тестовый файл — проверка качества не завершена');
 const pending=page.waitForEvent('download');await page.locator('[data-test-receive]').click();const file=await pending;
 expect(file.suggestedFilename()).toBe('Тестовый файл — качество не подтверждено.docx');
 const fs=require('node:fs');expect(fs.readFileSync(await file.path()).toString('base64')).toBe(await page.evaluate(()=>testBytes));
 await setup(page,{student:true,reset:false});await expect(page.locator('[data-test-receive]')).toBeVisible();
 await expect(page.locator('section').filter({has:page.locator('[data-test-receive]')})).toContainText('проверка качества не завершена');
});

test('C099 server version change invalidates an executor confirmation',async({page})=>{
 await setup(page);await page.locator('[data-test-open]').click();await expect(page.locator('[data-test-confirm]')).toBeEnabled();
 await page.locator('[data-test-confirm]').check();await page.evaluate(()=>testBinding.versionId='55555555-5555-4555-8555-555555555555');
 await page.locator('[data-test-send]').click();await expect(page.locator('.sheet [data-test-status]')).toContainText('изменились');
 expect(await page.evaluate(()=>testCalls.some(c=>c.action==='test-deliver'))).toBe(false);
});

test('C099 account switch prevents sending from an old confirmation',async({page})=>{
 await setup(page);await page.locator('[data-test-open]').click();await expect(page.locator('[data-test-confirm]')).toBeEnabled();await page.locator('[data-test-confirm]').check();
 await page.evaluate(()=>testIdentity='other-user');await page.locator('[data-test-send]').click();
 await expect(page.locator('.sheet [data-test-status]')).toContainText('Аккаунт');
 expect(await page.evaluate(()=>testCalls.some(c=>c.action==='test-deliver'))).toBe(false);
});

test('C099 account switch during file fetch prevents download',async({page})=>{
 await setup(page);await send(page);await setup(page,{student:true,reset:false});
 await page.evaluate(()=>deferTestRead=true);let downloads=0;page.on('download',()=>downloads++);
 await page.locator('[data-test-receive]').click();await expect.poll(()=>page.evaluate(()=>typeof releaseTestRead)).toBe('function');
 await page.evaluate(()=>{testIdentity='other-user';releaseTestRead();});
 await expect(page.locator('[data-test-status]')).toContainText('Аккаунт');await expect(page.locator('[data-test-receive]')).toBeDisabled();expect(downloads).toBe(0);
});

test('C099 hash mismatch blocks test file download',async({page})=>{
 await setup(page);await send(page);await setup(page,{student:true,reset:false});let downloads=0;page.on('download',()=>downloads++);
 await page.evaluate(()=>testBytes=btoa('corrupted'));await page.locator('[data-test-receive]').click();
 await expect(page.locator('[data-test-status]')).toContainText('Контрольная сумма');expect(downloads).toBe(0);
});


test('C099 a new version can be test-delivered from the same window with a new operation',async({page})=>{
 await setup(page);await send(page);
 await page.evaluate(()=>testBinding.versionId='55555555-5555-4555-8555-555555555555');
 await page.locator('[data-test-refresh]').click();await expect(page.locator('[data-test-confirm]')).toBeEnabled();
 await page.locator('[data-test-confirm]').check();await page.locator('[data-test-send]').click();
 await expect(page.locator('.sheet [data-test-status]')).toContainText('Эта версия доступна студенту');
 const calls=await page.evaluate(()=>testCalls.filter(c=>c.action==='test-deliver'));
 expect(calls).toHaveLength(2);expect(calls[0].deliveryId).not.toBe(calls[1].deliveryId);expect(calls[0].versionId).not.toBe(calls[1].versionId);
 expect(await page.evaluate(()=>testItem.status)).toBe('progress');
});
