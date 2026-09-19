const {test,expect}=require('@playwright/test');
const base='http://127.0.0.1:4173/';
async function account(page,file){await page.goto(base+file);await page.evaluate(()=>QA.switchUser('result-test'));await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);}
async function setupReview(page){
 await account(page,'reestr.html');
 await page.evaluate(()=>{
  window.calls=[];window.remote={state:'none'};window.failRead=false;window.loseReview=false;window.loseDelivery=false;
  Oblako.requestApi=async body=>{
   calls.push(body);
   if(body.action==='result-review-state'){if(failRead)throw Error('Сервер недоступен');if(remote.document&&JSON.stringify(remote.document)!==JSON.stringify(body.document))return {state:'stale'};return JSON.parse(JSON.stringify(remote));}
   if(body.action==='prepare-result'){
    const bytes=Uint8Array.from(atob(body.docxBase64),c=>c.charCodeAt(0));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
    remote={state:'prepared',document:body.document,docxBase64:body.docxBase64,receipt:{versionId:body.versionId,recipientId:'55555555-5555-4555-8555-555555555555',fileHash:hash,documentHash:'b'.repeat(64)}};return remote.receipt;
   }
   if(body.action==='review-result'){remote.state='reviewed';remote.review={reviewId:body.reviewId,versionId:body.versionId,criteria:body.criteria};if(loseReview){loseReview=false;throw Error('Ответ на сохранение потерян');}return remote.review;}
   if(body.action==='deliver'){remote.state='delivered';remote.delivery={deliveryId:body.deliveryId,createdAt:'2026-09-19'};if(loseDelivery){loseDelivery=false;throw Error('Ответ на передачу потерян');}return {saved:true,deliveryId:body.deliveryId};}
   throw Error('Unexpected action '+body.action);
  };
  window.candidate={id:'11111111-1111-4111-8111-111111111111',requestNumber:1,topic:'Проверка документа',student:'Тестовый студент',format:{},passports:[{id:'77777777-7777-4777-8777-777777777777',status:'approved',revision:1,source_fingerprint:'c'.repeat(64),items:[]}],doc:{inputs:{requirements:'Методические требования кафедры менеджмента'},order:[{id:'intro',name:'Введение'}],structure:{intro:{text:'Проверенный черновик'}}}};
  candidate.doc.review=DraftQuality.stamp(candidate);StudResults.deliver(candidate);
 });
 await expect(page.locator('[data-save-review]')).toBeEnabled();
}
async function fillReview(page){
 const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Открыть точный Word'}).click();const download=await waiting;
 await page.locator('details').filter({has:page.locator('[data-criterion]')}).evaluate(el=>el.open=true);
 for(const status of await page.locator('[data-criterion-status]').all())await status.selectOption('pass');
 for(const field of await page.locator('[data-criterion]').all())await field.fill('Synthetic evidence at page 1');
 await page.locator('[data-criterion-status="C08"]').selectOption('not_applicable');
 await page.locator('[data-reviewed]').check();return download;
}
test('C-071 saving review never delivers; reopening restores exact bytes and separate delivery',async({page})=>{
 await setupReview(page);await page.setViewportSize({width:390,height:844});
 await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверьте документ');
 const downloaded=await fillReview(page);
 await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(0);
 const fs=require('fs');expect(fs.readFileSync(await downloaded.path()).toString('base64')).toBe(await page.evaluate(()=>remote.docxBase64));
 await page.locator('.sheet .close').click();await page.evaluate(()=>StudResults.deliver(candidate));
 await expect(page.locator('[data-result-status]')).toContainText('Результат ещё не передан');
 await expect(page.locator('[data-criterion="C01"]')).toHaveValue('Synthetic evidence at page 1');
 await expect(page.locator('[data-criterion="C01"]')).toBeDisabled();
 await page.waitForTimeout(2200); // Let the existing modal animation and sync toast settle for visual QA.
 await page.screenshot({path:'test-results/review-saved-not-delivered.png'});
 await page.locator('[data-deliver]').click();await expect(page.locator('[data-result-status]')).toContainText('доступна студенту');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').map(c=>c.deliveryId))).toEqual([await page.evaluate(()=>remote.receipt.versionId)]);
 await expect(page.locator('[data-deliver]')).toBeDisabled();
 await page.screenshot({path:'test-results/separate-review-mobile.png'});
});
test('C-071 lost review and delivery responses recover without duplicate writes',async({page})=>{
 await setupReview(page);await fillReview(page);await page.evaluate(()=>loseReview=true);
 await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Ответ на сохранение потерян');
 await page.locator('[data-result-refresh]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='review-result').length)).toBe(1);
 await page.evaluate(()=>loseDelivery=true);await page.locator('[data-deliver]').click();await expect(page.locator('[data-result-status]')).toContainText('Ответ на передачу потерян');
 await page.locator('.sheet .close').click();await page.evaluate(()=>StudResults.deliver(candidate));
 await expect(page.locator('[data-result-status]')).toContainText('доступна студенту');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(1);
});
test('C-071 unavailable state never opens delivery and failed/manual criteria never save',async({page})=>{
 await setupReview(page);await fillReview(page);
 for(const value of ['fail','manual']){await page.locator('[data-criterion-status="C01"]').selectOption(value);await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('заблокирована');}
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='prepare-result').length)).toBe(0);
 await page.evaluate(()=>failRead=true);await page.locator('[data-result-refresh]').click();await expect(page.locator('[data-result-status]')).toContainText('Сервер недоступен');
 await expect(page.locator('[data-save-review]')).toBeDisabled();await expect(page.locator('[data-deliver]')).toBeHidden();
});
test('student receives Word without overwriting own work; changed account cannot download',async({page})=>{
 await account(page,'index.html');await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{
  window.originalData=JSON.stringify(D);
  Oblako.requestApi=async()=>({result:{created_at:'2026-09-09T00:00:00Z',document:{topic:'Результат',student:'Тест',group:'',format:{font:'Times New Roman',size:14},chapters:[{id:'intro',name:'Введение'}],structure:{intro:{text:'Текст исполнителя'}}}}});
  StudResults.receive({req:{serverId:'11111111-1111-4111-8111-111111111111'}});
 });
 await expect(page.getByRole('button',{name:'Скачать черновик Word'})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать черновик Word'}).click();expect((await download).suggestedFilename()).toMatch(/\.docx$/);
 expect(await page.evaluate(()=>JSON.stringify(D)===originalData)).toBe(true);
 await page.screenshot({path:'test-results/result-student-mobile.png'});
 await page.evaluate(()=>QA.switchUser('other'));
 await expect.poll(()=>page.evaluate(()=>Oblako.email)).toBe('other@example.test');
 // Account switching closes sheets in the application; no old result can be downloaded.
 await expect(page.getByRole('button',{name:'Скачать черновик Word'})).toHaveCount(0);
});

for(const change of ['recipient','document','passport','account'])test('C-071 '+change+' change blocks a saved review',async({page})=>{
 await setupReview(page);await fillReview(page);await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 await page.evaluate(change=>{if(change==='recipient')candidate.student='Другой получатель';if(change==='document')candidate.doc.structure.intro.text='Изменённый текст';if(change==='passport')candidate.passports[0].items=[{text:'Изменённые требования'}];if(change==='account')D={};},change);
 await page.locator('[data-deliver]').click();await expect(page.locator('[data-result-status]')).toContainText(change==='account'?'Аккаунт изменился':'изменились');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(0);
});

test('student downloads the exact reviewed bytes and rejects a corrupted file',async({page})=>{
 await account(page,'index.html');
 await page.evaluate(async()=>{
  var doc={topic:'Exact file',chapters:[{id:'a',name:'Section'}],structure:{a:{text:'Exact reviewed text'}}};
  var blob=ResultDocx(doc,doc.chapters),bytes=new Uint8Array(await blob.arrayBuffer()),bin='';for(var b of bytes)bin+=String.fromCharCode(b);
  window.file64=btoa(bin);window.expectedHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  Oblako.requestApi=async()=>({result:{version_id:'v',created_at:'2026-09-12',document:doc,docxBase64:file64,fileHash:expectedHash}});
  StudResults.receive({req:{serverId:'11111111-1111-4111-8111-111111111111'}});
 });
 const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать черновик Word'}).click();const down=await wait;
 const fs=require('node:fs'),crypto=require('node:crypto');expect(crypto.createHash('sha256').update(fs.readFileSync(await down.path())).digest('hex')).toBe(await page.evaluate(()=>expectedHash));
 await page.locator('[data-x]').click();
 await page.evaluate(()=>{expectedHash='0'.repeat(64);StudResults.receive({req:{serverId:'11111111-1111-4111-8111-111111111111'}});});
 await expect(page.locator('[data-result-status]')).toContainText('Контрольная сумма');await expect(page.locator('[data-download]')).toBeHidden();
});

test('C-071 full page reload restores server review without local flags',async({page})=>{
 await setupReview(page);await fillReview(page);await page.locator('[data-save-review]').click();
 await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 const stored=await page.evaluate(()=>({server:JSON.parse(JSON.stringify(remote)),candidate:JSON.parse(JSON.stringify(candidate))}));
 await page.reload();
 expect(await page.evaluate(()=>typeof window.remote)).toBe('undefined');
 await setupReview(page);
 await page.locator('.sheet .close').click();
 await page.evaluate(stored=>{remote=stored.server;candidate=stored.candidate;StudResults.deliver(candidate);},stored);
 await expect(page.locator('[data-result-status]')).toContainText('Результат ещё не передан');
 await expect(page.locator('[data-deliver]')).toBeEnabled();
 expect(await page.evaluate(()=>calls.filter(c=>['prepare-result','review-result','deliver'].includes(c.action)).length)).toBe(0);
});
test('C-071 changed saved document and corrupt saved bytes cannot reuse review',async({page})=>{
 await setupReview(page);await fillReview(page);await page.locator('[data-save-review]').click();
 await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 await page.locator('.sheet .close').click();
 await page.evaluate(()=>{remote.receipt.fileHash='0'.repeat(64);StudResults.deliver(candidate);});
 await expect(page.locator('[data-result-status]')).toContainText('Контрольная сумма');
 await expect(page.locator('[data-deliver]')).toBeDisabled();
 await page.locator('.sheet .close').click();
 await page.evaluate(()=>{candidate.doc.structure.intro.text='Другой проверенный текст';candidate.doc.review=DraftQuality.stamp(candidate);StudResults.deliver(candidate);});
 await expect(page.locator('[data-save-review]')).toBeEnabled();await expect(page.locator('[data-deliver]')).toBeHidden();
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(0);
});
