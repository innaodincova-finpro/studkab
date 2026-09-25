const {test,expect}=require('@playwright/test');
const base='http://127.0.0.1:4173/';
async function account(page,file){await page.goto(base+file);await page.evaluate(()=>QA.switchUser('result-test'));await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);}
async function readyReview(page){
 await expect(page.locator('[data-quality-start]')).toBeEnabled();
 await page.locator('[data-quality-panel]').evaluate(el=>el.open=true);
 await page.locator('[data-quality-start]').click();
 await expect(page.locator('[data-save-review]')).toBeEnabled();
}
async function setupReview(page){
 await account(page,'reestr.html');
 await page.evaluate(()=>{
  window.calls=[];window.reviewHistory=[];window.remote={state:'none'};window.failRead=false;window.loseNotes=false;window.loseReview=false;window.loseDelivery=false;
  Oblako.requestApi=async body=>{
   calls.push(body);
   if(body.action==='quality-state')return {bindings:{...remote.receipt,passportId:candidate.passports[0].id,sourceFingerprint:candidate.passports[0].source_fingerprint},thresholdRequirement:{itemId:'ANTIPLAGIARISM',text:'Synthetic fixture requirement'},eligible:true,blockingCodes:[],latest:{internal_borrowing:{id:'fixture-internal',payload:{disposition:'pass',notes:'Previously reviewed fixture evidence'}},external_originality:{id:'fixture-external',payload:{disposition:'pass',notes:'Previously reviewed fixture PDF evidence'}}}};
   if(body.action==='result-review-history')return {reviews:reviewHistory,limit:100};
   if(body.action==='result-review-state'){if(failRead)throw Error('Сервер недоступен');if(remote.document&&JSON.stringify(remote.document)!==JSON.stringify(body.document))return {state:'stale'};return JSON.parse(JSON.stringify(remote));}
   if(body.action==='prepare-result'){
    const bytes=Uint8Array.from(atob(body.docxBase64),c=>c.charCodeAt(0));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
    remote={state:'prepared',document:body.document,docxBase64:body.docxBase64,receipt:{versionId:body.versionId,recipientId:'55555555-5555-4555-8555-555555555555',fileHash:hash,documentHash:'b'.repeat(64)}};return remote.receipt;
   }
   if(body.action==='review-notes'){remote.state='changes_requested';remote.review={reviewId:body.reviewId,versionId:body.versionId,criteria:body.criteria};reviewHistory.push({id:body.reviewId,version_id:body.versionId,criteria:body.criteria,created_at:'2026-09-22',studkab_result_versions:{revision:1,file_hash:remote.receipt.fileHash}});if(loseNotes){loseNotes=false;throw Error('Ответ на замечания потерян');}return remote.review;}
   if(body.action==='review-result'){remote.state='reviewed';remote.review={reviewId:body.reviewId,versionId:body.versionId,criteria:body.criteria};if(loseReview){loseReview=false;throw Error('Ответ на сохранение потерян');}return remote.review;}
   if(body.action==='deliver'){remote.state='delivered';remote.delivery={deliveryId:body.deliveryId,createdAt:'2026-09-19'};if(loseDelivery){loseDelivery=false;throw Error('Ответ на передачу потерян');}return {saved:true,deliveryId:body.deliveryId};}
   throw Error('Unexpected action '+body.action);
  };
  window.candidate={id:'11111111-1111-4111-8111-111111111111',requestNumber:1,topic:'Проверка документа',student:'Тестовый студент',format:{},passports:[{id:'77777777-7777-4777-8777-777777777777',status:'approved',revision:1,source_fingerprint:'c'.repeat(64),items:[]}],doc:{inputs:{requirements:'Методические требования кафедры менеджмента'},order:[{id:'intro',name:'Введение'}],structure:{intro:{text:'Проверенный черновик'}}}};
  candidate.doc.review=DraftQuality.stamp(candidate);StudResults.deliver(candidate);
 });
 await expect(page.locator('[data-quality-start]')).toBeEnabled();
 await page.locator('[data-quality-panel]').evaluate(el=>el.open=true);await page.locator('[data-quality-start]').click();
 await readyReview(page);
 await page.evaluate(()=>{calls=[];}); // Scenario begins with a prepared version and prior quality evidence.
}

async function fillReview(page){
 const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать точный Word'}).click();const download=await waiting;
 await expect(page.locator('[data-word-opened]')).toBeEnabled();await page.locator('[data-word-opened]').check();
 await page.locator('details').filter({has:page.locator('[data-criterion]')}).evaluate(el=>el.open=true);
 for(const status of await page.locator('[data-criterion-status]').all())await status.selectOption('pass');
 for(const field of await page.locator('[data-criterion]').all())await field.fill('Synthetic evidence at page 1');
 await page.locator('[data-criterion-section="C01"]').fill('Страница 1, введение');
 await page.locator('[data-criterion-status="C08"]').selectOption('not_applicable');
 await page.locator('[data-reviewed]').check();return download;
}
test('C-071 saving review never delivers; reopening restores exact bytes and separate delivery',async({page})=>{
 await setupReview(page);await page.setViewportSize({width:390,height:844});
 await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Скачайте и проверьте Word');
 const downloaded=await fillReview(page);
 await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(0);
 const fs=require('fs');expect(fs.readFileSync(await downloaded.path()).toString('base64')).toBe(await page.evaluate(()=>remote.docxBase64));
 await page.locator('.sheet .close').click();await page.evaluate(()=>StudResults.deliver(candidate));
 await expect(page.locator('[data-result-status]')).toContainText('Результат ещё не передан');
 await expect(page.locator('[data-criterion="C01"]')).toHaveValue('Synthetic evidence at page 1');
 await expect(page.locator('[data-criterion-section="C01"]')).toHaveValue('Страница 1, введение');
 await expect(page.locator('[data-criterion="C01"]')).toBeDisabled();
 await page.waitForTimeout(2200); // Let the existing modal animation and sync toast settle for visual QA.
 await page.screenshot({path:'test-results/review-saved-not-delivered.png'});
 await page.locator('[data-deliver]').click();await expect(page.locator('[data-result-status]')).toContainText('доступна студенту');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(1);
 await expect(page.locator('[data-deliver]')).toBeDisabled();
 expect(await page.evaluate(()=>StudResults.isCurrentDelivery(candidate))).toBe(true);
 await page.evaluate(()=>candidate.doc.structure.intro.text+=' Изменение после передачи.');
 expect(await page.evaluate(()=>StudResults.isCurrentDelivery(candidate))).toBe(false);
 await page.screenshot({path:'test-results/separate-review-mobile.png'});
});
test('C107 downloading Word without confirming it was opened cannot save remarks',async({page})=>{
 await setupReview(page);
 await expect(page.locator('[data-word-opened]')).toBeDisabled();
 const waiting=page.waitForEvent('download');await page.locator('[data-preview]').click();await waiting;
 await expect(page.locator('[data-result-status]')).toContainText('Файл скачан');
 await page.locator('details').filter({has:page.locator('[data-criterion]')}).evaluate(el=>el.open=true);
 await page.locator('[data-criterion-status="C12"]').selectOption('manual');
 await page.locator('[data-criterion="C12"]').fill('Требуется проверить пагинацию в настольном Word');
 await page.locator('[data-criterion-section="C12"]').fill('Весь документ');
 await page.locator('[data-save-notes]').click();
 await expect(page.locator('[data-result-status]')).toContainText('подтвердите просмотр');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='review-notes').length)).toBe(0);
 await page.locator('[data-word-opened]').check();
 await page.locator('[data-save-notes]').click();
 await expect(page.locator('[data-result-status]')).toContainText('Замечания сохранены');
});
test('C110 restores exact saved Word context only when current source basis matches the passport',async({page})=>{
 await setupReview(page);await page.locator('.sheet .close').click();
 await page.evaluate(async()=>{
  const uploadedWord={name:'saved.docx',fileHash:remote.receipt.fileHash};
  candidate.externalResult={...uploadedWord,chapters:remote.document.chapters,structure:remote.document.structure};
  const basis=new TextEncoder().encode(DraftEditor.basis(candidate));
  candidate.passports[0].source_fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',basis))).map(b=>b.toString(16).padStart(2,'0')).join('');
  remote.document={...remote.document,uploadedWord,reviewContext:{...remote.document.reviewContext,sourceFingerprint:candidate.passports[0].source_fingerprint}};
  window.saved=remote.document;window.recoveryCalls=0;
  const previous=Oblako.requestApi;
  Oblako.requestApi=async body=>{
   if(body.action==='result-review-state'&&++recoveryCalls===1)return {state:'restore_saved',document:saved};
   return previous(body);
  };
  StudResults.deliver(candidate,true);
 });
 await expect(page.locator('[data-preview]')).toBeEnabled();
 await expect(page.locator('[data-result-status]')).toContainText('Проверьте точный Word');
 expect(await page.evaluate(()=>recoveryCalls)).toBe(2);
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='result-review-state').at(-1).document.reviewContext.fingerprint)).toBe(await page.evaluate(()=>saved.reviewContext.fingerprint));
});
test('C109 executor can resume after an idempotent passport binding reply',async({page})=>{
 await setupReview(page);
 await page.locator('.sheet .close').click();
 await page.evaluate(()=>{
  candidate.passports=[{...candidate.passports[0],id:'88888888-8888-4888-8888-888888888888',revision:2,items:[{id:'VOLUME',text:'Новый объём'}]}];
  window.boundToNewPassport=false;
  const original=Oblako.requestApi;
  Oblako.requestApi=async body=>{
   if(body.action==='result-review-state'&&!boundToNewPassport){calls.push(body);return {state:'passport_changed',receipt:remote.receipt,docxBase64:remote.docxBase64,changedItems:['VOLUME']};}
   if(body.action==='rebind-result'){
    calls.push(body);boundToNewPassport=true;remote.state='prepared';remote.document=body.document;remote.review=null;
    // An earlier accepted request may have lost its response; the RPC then returns duplicate:true.
    return {versionId:remote.receipt.versionId,fileHash:remote.receipt.fileHash,bindingId:'99999999-9999-4999-8999-999999999999',duplicate:true};
   }
   return original(body);
  };
  calls=[];StudResults.deliver(candidate);
 });
 await expect(page.locator('[data-passport-rebind]')).toBeVisible();
 await expect(page.locator('[data-passport-changes]')).toContainText('VOLUME');
 await expect(page.locator('[data-save-review]')).toBeDisabled();
 await page.locator('[data-passport-reuse]').click();
 await expect(page.locator('[data-result-status]')).toContainText('Скачайте и проверьте Word');
 const waiting=page.waitForEvent('download');await page.locator('[data-preview]').click();await waiting;
 await page.locator('[data-word-opened]').check();
 await page.locator('[data-passport-confirm]').check();
 await page.locator('[data-passport-explanation]').fill('Сверены новые требования к объёму, текст Word исправлять не требуется.');
 await page.locator('[data-passport-reuse]').click();
 await expect(page.locator('[data-passport-rebind]')).toBeHidden();
 await expect(page.locator('[data-result-status]')).toContainText('Проверьте точный Word');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='rebind-result').length)).toBe(1);
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='prepare-result').length)).toBe(0);
});
test('C109 refreshing an open delivered review resets its confirmation, criteria and delivery operation',async({page})=>{
 await setupReview(page);await fillReview(page);
 await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 await page.locator('[data-deliver]').click();await expect(page.locator('[data-result-status]')).toContainText('доступна студенту');
 const oldId=await page.evaluate(()=>remote.delivery.deliveryId);
 await page.evaluate(()=>{document.querySelector('[data-passport-confirm]').checked=true;document.querySelector('[data-passport-explanation]').value='Прежнее объяснение нельзя переносить на новый паспорт.';});
 await page.evaluate(()=>{
  window.boundToNewPassport=false;
  const original=Oblako.requestApi;
  Oblako.requestApi=async body=>{
   if(body.action==='result-review-state'&&!boundToNewPassport){calls.push(body);return {state:'passport_changed',receipt:remote.receipt,docxBase64:remote.docxBase64,changedItems:['VOLUME']};}
   if(body.action==='rebind-result'){
    calls.push(body);boundToNewPassport=true;remote.state='prepared';remote.review=null;remote.delivery=null;remote.document=body.document;
    return {versionId:remote.receipt.versionId,fileHash:remote.receipt.fileHash};
   }
   return original(body);
  };
 });
 await page.locator('[data-result-refresh]').click();
 await expect(page.locator('[data-passport-rebind]')).toBeVisible();
 await expect(page.locator('[data-word-opened]')).not.toBeChecked();
 await expect(page.locator('[data-passport-confirm]')).not.toBeChecked();
 await expect(page.locator('[data-passport-explanation]')).toHaveValue('');
 expect(await page.locator('[data-criterion-status],[data-criterion],[data-criterion-section]').evaluateAll(fields=>fields.length===48&&fields.every(field=>field.value===''))).toBe(true);
 await expect(page.locator('[data-reviewed]')).not.toBeChecked();
 await page.locator('[data-passport-reuse]').click();
 await expect(page.locator('[data-result-status]')).toContainText('Скачайте и проверьте Word');
 const waiting=page.waitForEvent('download');await page.locator('[data-preview]').click();await waiting;
 await page.locator('[data-word-opened]').check();await page.locator('[data-passport-confirm]').check();
 await page.locator('[data-passport-explanation]').fill('Сверил требования новой редакции с этим Word, исправления не требуются.');
 await page.locator('[data-passport-reuse]').click();await expect(page.locator('[data-passport-rebind]')).toBeHidden();
 await fillReview(page);await page.locator('[data-save-review]').click();
 await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 await page.locator('[data-deliver]').click();await expect(page.locator('[data-result-status]')).toContainText('доступна студенту');
 const deliveryIds=await page.evaluate(()=>calls.filter(c=>c.action==='deliver').map(c=>c.deliveryId));
 expect(deliveryIds).toHaveLength(2);expect(deliveryIds[0]).toBe(oldId);expect(deliveryIds[1]).not.toBe(oldId);
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='prepare-result').length)).toBe(0);
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
 await readyReview(page);await expect(page.locator('[data-deliver]')).toBeHidden();
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(0);
});

async function externalFixture(page,text='Проверяемый учебный документ с таблицами и выводами'){
 const b64=await page.evaluate(async text=>{
  const d={topic:'Учебный файл',chapters:[{id:'intro',name:'Введение'}],structure:{intro:{text}}};
  const bytes=new Uint8Array(await ResultDocx(d,d.chapters).arrayBuffer());return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
 },text);return Buffer.from(b64,'base64');
}
async function attachExternal(page,buffer){
 await page.evaluate(()=>StudResults.attach(candidate));
 await page.locator('[data-word-file]').setInputFiles({name:'reviewed.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer});
 await expect(page.locator('[data-word-save]')).toBeEnabled();
 await page.locator('[data-word-save]').click();
 await expect(page.locator('[data-word-status]')).toContainText('Word сохранён');
 await page.locator('.sheet .close').click();
}
test('C083 external Word saves without delivery, reviews independently, student gets identical bytes',async({page})=>{
 await setupReview(page);await page.locator('.sheet .close').click();
 const original=await page.evaluate(()=>JSON.stringify(candidate.doc)),bytes=await externalFixture(page);
 await attachExternal(page,bytes);
 expect(await page.evaluate(()=>JSON.stringify(candidate.doc))).toBe(original);
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver'||c.action==='review-result').length)).toBe(0);
 await page.evaluate(()=>StudResults.deliver(candidate,true));
 await expect(page.locator('[data-result-status]')).toContainText('Проверьте точный Word');
 const preview=await fillReview(page);
 const fs=require('node:fs');expect(fs.readFileSync(await preview.path())).toEqual(bytes);
 await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 await page.locator('[data-deliver]').click();await expect(page.locator('[data-result-status]')).toContainText('доступна студенту');
 const stored=await page.evaluate(()=>JSON.parse(JSON.stringify(remote)));
 await page.locator('.sheet .close').click();
 await page.evaluate(stored=>{
  Oblako.requestApi=async()=>({result:{version_id:stored.receipt.versionId,created_at:'2026-09-21',document:stored.document,docxBase64:stored.docxBase64,fileHash:stored.receipt.fileHash}});
  StudResults.receive({req:{serverId:candidate.id}});
 },stored);
 const wait=page.waitForEvent('download');await page.locator('[data-download]').click();expect(fs.readFileSync(await (await wait).path())).toEqual(bytes);
});
test('C083 replacement requires new review and failed criterion prevents transmission',async({page})=>{
 await setupReview(page);await page.locator('.sheet .close').click();
 await attachExternal(page,await externalFixture(page));
 await page.evaluate(()=>StudResults.deliver(candidate,true));await fillReview(page);
 await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 await page.locator('.sheet .close').click();
 await attachExternal(page,await externalFixture(page,'Новая версия — другие выводы.'));
 await page.evaluate(()=>StudResults.deliver(candidate,true));
 await expect(page.locator('[data-deliver]')).toBeHidden();await expect(page.locator('[data-reviewed]')).not.toBeChecked();
 await fillReview(page);await page.locator('[data-criterion-status="C01"]').selectOption('fail');
 await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('заблокирована');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(0);
});
test('C083 invalid file and unapproved passport never write a result',async({page})=>{
 await setupReview(page);await page.locator('.sheet .close').click();
 await page.evaluate(()=>StudResults.attach(candidate));
 await page.locator('[data-word-file]').setInputFiles({name:'fake.docx',mimeType:'application/octet-stream',buffer:Buffer.from('This is not a Word document')});
 await expect(page.locator('[data-word-status]')).toContainText('Не удалось прочитать');
 await expect(page.locator('[data-word-save]')).toBeDisabled();
 await page.locator('.sheet .close').click();
 await page.evaluate(()=>{candidate.passports[0].status='draft';StudResults.attach(candidate);});
 await expect(page.locator('[data-word-file]')).toHaveCount(0);
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='prepare-result').length)).toBe(0);
});
test('C083 account or passport change while selecting prevents saving',async({page})=>{
 await setupReview(page);await page.locator('.sheet .close').click();
 const buffer=await externalFixture(page);
 await page.evaluate(()=>StudResults.attach(candidate));
 await page.locator('[data-word-file]').setInputFiles({name:'test.docx',mimeType:'application/octet-stream',buffer});
 await expect(page.locator('[data-word-save]')).toBeEnabled();
 await page.evaluate(()=>candidate.passports[0].revision++);
 await page.locator('[data-word-save]').click();
 await expect(page.locator('[data-word-status]')).toContainText('изменились');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='prepare-result').length)).toBe(0);
});

test('C087 approximate volume permits review but manual or failed C12 cannot save',async({page})=>{
 await setupReview(page);
 await page.locator('.sheet .close').click();
 await page.evaluate(()=>{
  candidate.doc.order[0].pages=1;
  candidate.doc.structure.intro.text='слово '.repeat(300);
  candidate.doc.review=DraftQuality.stamp(candidate);
  StudResults.deliver(candidate);
 });
 await readyReview(page);
 await fillReview(page);
 await expect(page.locator('[data-criterion="C12"]').locator('..')).toContainText('фактические страницы точного Word');
 for(const state of ['manual','fail']){
  await page.locator('[data-criterion-status="C12"]').selectOption(state);
  await page.locator('[data-save-review]').click();
  await expect(page.locator('[data-result-status]')).toContainText('заблокирована');
  expect(await page.evaluate(()=>calls.filter(c=>c.action==='review-result'||c.action==='deliver').length)).toBe(0);
 }
});

test('C088 arithmetic blocks review; source meaning requires C10 evidence',async({page})=>{
 await setupReview(page);await page.locator('.sheet .close').click();
 await page.evaluate(()=>{candidate.doc.structure.intro.text='Доля: 9/18×100=60%.';candidate.doc.review=DraftQuality.stamp(candidate);StudResults.deliver(candidate);});
 await expect(page.locator('[data-save-review]')).toHaveCount(0);
 await expect(page.getByText(/арифметическая ошибка/)).toBeVisible();
 await page.evaluate(()=>{
  candidate.doc.inputs.sources='[S1]\nРеквизиты: Учебный источник, 2026, с. 1.\nФрагмент: Протокол содержит решения и ответственных.\nПодтверждает: Фиксация решений совещания.';
  candidate.doc.structure.intro.text='Прибыль выросла на 30% благодаря совещаниям [S1]. Доля: 9/18×100=50%.';
  candidate.doc.review=DraftQuality.stamp(candidate);StudResults.deliver(candidate);
 });
 await readyReview(page);
 await page.locator('[data-source-review] summary').click();
 await expect(page.locator('[data-source-review]')).toContainText('Прибыль выросла на 30%');
 await expect(page.locator('[data-source-review]')).toContainText('Протокол содержит решения и ответственных');
 await expect(page.locator('[data-source-review]')).toContainText('Требует ручной проверки смысла');
 await fillReview(page);
 for(const state of ['manual','fail']){
  await page.locator('[data-criterion-status="C10"]').selectOption(state);await page.locator('[data-save-review]').click();
  await expect(page.locator('[data-result-status]')).toContainText('заблокирована');
  expect(await page.evaluate(()=>calls.filter(c=>c.action==='review-result'||c.action==='deliver').length)).toBe(0);
 }
});

test('C089 negative notes reopen on exact Word and cannot deliver; correction needs new review',async({page})=>{
 await setupReview(page);
 const download=page.waitForEvent('download');await page.locator('[data-preview]').click();await download;await page.locator('[data-word-opened]').check();
 await page.locator('details').filter({has:page.locator('[data-criterion]')}).evaluate(el=>el.open=true);
 await page.locator('[data-criterion-status="C12"]').selectOption('manual');
 await page.locator('[data-criterion="C12"]').fill('Нужно сверить основной объём по методичке');
 await page.locator('[data-criterion-section="C12"]').fill('Основная часть, страницы 4–30');
 await page.locator('[data-save-notes]').click();await expect(page.locator('[data-result-status]')).toContainText('Замечания сохранены');
 await expect(page.locator('[data-deliver]')).toBeHidden();
 await page.locator('.sheet .close').click();await page.evaluate(()=>StudResults.deliver(candidate));
 await expect(page.locator('[data-result-status]')).toContainText('Замечания сохранены');
 await expect(page.locator('[data-criterion="C12"]')).toHaveValue('Нужно сверить основной объём по методичке');
 await expect(page.locator('[data-criterion-section="C12"]')).toHaveValue('Основная часть, страницы 4–30');
 await expect(page.locator('[data-reviewed]')).not.toBeChecked();
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(0);
 await fillReview(page);await page.locator('[data-save-review]').click();
 await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='review-notes')[0].reviewId!==remote.review.reviewId)).toBe(true);
});

test('C089 replacing Word keeps old notes in history without approving new version',async({page})=>{
 await setupReview(page);await fillReview(page);
 await page.locator('[data-criterion-status="C10"]').selectOption('fail');
 await page.locator('[data-criterion-section="C10"]').fill('Глава 1, источник 3');
 await page.locator('[data-save-notes]').click();await expect(page.locator('[data-result-status]')).toContainText('Замечания сохранены');
 await page.locator('.sheet .close').click();
 await page.evaluate(()=>{candidate.doc.structure.intro.text+=' Исправленная версия.';candidate.doc.review=DraftQuality.stamp(candidate);StudResults.deliver(candidate);});
 await readyReview(page);
 await expect(page.locator('[data-criterion="C10"]')).toHaveValue('');
 await expect(page.locator('[data-deliver]')).toBeHidden();
 await page.locator('[data-review-history] > summary').click();
 await expect(page.locator('[data-review-history-body]')).toContainText('Последние 1 проверок');
 await expect(page.locator('[data-review-history-body]')).toContainText('Глава 1, источник 3');
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(0);
});

test('C089 later notes revoke approval; lost acknowledgement recovers and correction unlocks separate delivery',async({page})=>{
 await setupReview(page);await fillReview(page);await page.locator('[data-save-review]').click();
 await expect(page.locator('[data-deliver]')).toBeEnabled();
 await page.locator('[data-save-notes]').click();await expect(page.locator('[data-deliver]')).toBeDisabled();
 await page.locator('[data-criterion-status="C10"]').selectOption('fail');
 await page.locator('[data-criterion-section="C10"]').fill('Глава 1, источник 3');
 await page.evaluate(()=>loseNotes=true);
 await page.locator('[data-save-notes]').click();await expect(page.locator('[data-result-status]')).toContainText('Ответ на замечания потерян');
 await page.locator('[data-result-refresh]').click();await expect(page.locator('[data-result-status]')).toContainText('Замечания сохранены');
 await expect(page.locator('[data-deliver]')).toBeHidden();
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='review-notes').length)).toBe(1);
 await fillReview(page);await page.locator('[data-save-review]').click();await expect(page.locator('[data-deliver]')).toBeEnabled();
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='review-result').map(c=>c.reviewId))).toHaveLength(2);
 expect(await page.evaluate(()=>new Set(calls.filter(c=>c.action==='review-result').map(c=>c.reviewId)).size)).toBe(2);
 expect(await page.evaluate(()=>calls.filter(c=>c.action==='deliver').length)).toBe(0);
});

test('C102 a changed quality record requires a fresh ordinary review of the same Word',async({page})=>{
 await setupReview(page);await fillReview(page);await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 const original=await page.evaluate(()=>({reviewId:remote.review.reviewId,versionId:remote.receipt.versionId}));
 await page.evaluate(()=>{
  const previous=Oblako.requestApi;window.freshQuality=null;
  const scan={scope:{providedSources:1,usableSources:1,documentTokens:10,scannedDocumentTokens:10},sources:[{id:'synthetic',tokenCount:10,scannedTokenCount:10}],limits:{truncated:false,reasons:[]},matches:[]};
  Oblako.requestApi=async body=>{
   if(body.action==='quality-scan')return {scan,scanHash:'d'.repeat(64)};
   if(body.action==='quality-save'){freshQuality={id:body.evidenceId,payload:{...body.payload,scan},createdAt:'2026-09-23T10:00:00Z'};remote.state='prepared';remote.reason='quality_review_stale';delete remote.review;return {evidence:freshQuality};}
   const result=await previous(body);if(body.action==='quality-state'&&freshQuality)result.latest.internal_borrowing=freshQuality;return result;
  };
 });
 await page.locator('[data-quality-panel]').evaluate(el=>el.open=true);await page.locator('[data-quality-scan]').click();await page.locator('[data-q="internalDisposition"]').selectOption('pass');await page.locator('[data-q="internalNotes"]').fill('Повторно рассмотрены доступные источники этой версии.');await page.locator('[data-quality-save-internal]').click();
 await expect(page.locator('[data-save-review]')).toBeVisible();await readyReview(page);await expect(page.locator('[data-reviewed]')).not.toBeChecked();await expect(page.locator('[data-criterion="C01"]')).toBeEnabled();
 await page.locator('[data-reviewed]').check();await page.locator('[data-save-review]').click();await expect(page.locator('[data-result-status]')).toContainText('Проверка сохранена');
 const current=await page.evaluate(()=>({reviewId:remote.review.reviewId,versionId:remote.receipt.versionId}));expect(current.versionId).toBe(original.versionId);expect(current.reviewId).not.toBe(original.reviewId);
});

test('C102 unavailable quality API blocks ordinary approval while review notes remain available',async({page})=>{
 await setupReview(page);await page.evaluate(()=>{const previous=Oblako.requestApi;Oblako.requestApi=body=>body.action==='quality-state'?Promise.reject(Error('Проверки временно недоступны')):previous(body);});
 await page.locator('[data-result-refresh]').click();await expect(page.locator('[data-save-review]')).toBeDisabled();await expect(page.locator('[data-save-notes]')).toBeEnabled();await expect(page.locator('[data-quality-status]')).toContainText('недоступны');
 expect(await page.evaluate(()=>calls.some(x=>x.action==='review-result'||x.action==='deliver'))).toBe(false);
});

test('C102 unsaved quality observations disable ordinary delivery until explicit discard',async({page})=>{
 await setupReview(page);await fillReview(page);await page.locator('[data-save-review]').click();await expect(page.locator('[data-deliver]')).toBeEnabled();
 await page.locator('[data-quality-panel]').evaluate(el=>el.open=true);await page.locator('[data-q="internalNotes"]').fill('Обнаружено новое замечание, пока не сохранено.');
 await expect(page.locator('[data-deliver]')).toBeDisabled();await expect(page.locator('[data-quality-status]')).toContainText('несохранённые изменения');
 await page.locator('[data-quality-refresh]').click();await expect(page.locator('[data-deliver]')).toBeEnabled();await expect(page.locator('[data-q="internalNotes"]')).toHaveValue('Previously reviewed fixture evidence');
 expect(await page.evaluate(()=>calls.some(x=>x.action==='deliver'))).toBe(false);
});
