const {test,expect}=require('@playwright/test');
const PDF=Buffer.from('%PDF-1.4\nSynthetic local test report\n%%EOF');
async function setup(page,{reset=true,unavailable=false}={}){
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(async({reset,unavailable})=>{
  if(reset)sessionStorage.removeItem('quality-fixture');
  window.qualityIdentity='executor';window.qCalls=[];window.qUnavailable=unavailable;window.qReady=false;window.qLoseSave=false;
  window.qBinding={versionId:'22222222-2222-4222-8222-222222222222',recipientId:'33333333-3333-4333-8333-333333333333',fileHash:'a'.repeat(64),documentHash:'b'.repeat(64),passportId:'44444444-4444-4444-8444-444444444444',sourceFingerprint:'c'.repeat(64)};
  window.qScan={algorithmVersion:'fixture',status:'manual',scope:{providedSources:1,usableSources:1,documentTokens:20,scannedDocumentTokens:20,officialOriginality:false},sources:[{id:'source-one',tokenCount:20,scannedTokenCount:20}],limits:{truncated:false,reasons:[]},matches:[{id:'match-one',kind:'corpus',document:{lineStart:1,lineEnd:2,excerpt:'Совпавший фрагмент проверяемого Word'},source:{id:'source-one',lineStart:4,lineEnd:5,excerpt:'Фрагмент доступного источника'}}]};
  window.qHost=document.createElement('section');document.getElementById('page').prepend(qHost);
  const capturedIdentity=qualityIdentity;
  Oblako.requestApi=async body=>{
   qCalls.push(body);
   if(qUnavailable)throw Error('Проверки временно недоступны');
   let latest=JSON.parse(sessionStorage.getItem('quality-fixture')||'{}');
   if(body.action==='quality-state')return {bindings:qBinding,thresholdRequirement:{itemId:'ANTIPLAGIARISM',text:'Оригинальность не менее 70 процентов'},latest,eligible:['internal_borrowing','external_originality'].every(k=>latest[k]?.payload.disposition==='pass'),blockingCodes:['internal_borrowing','external_originality'].filter(k=>latest[k]?.payload.disposition!=='pass')};
   if(body.action==='quality-scan'){if(window.qDeferred)await new Promise(resolve=>window.qRelease=resolve);return {scan:qScan,scanHash:'d'.repeat(64)};}
   if(body.action==='quality-save'){
    if(body.versionId!==qBinding.versionId||body.fileHash!==qBinding.fileHash)throw Error('QUALITY_STALE');
    const payload={...body.payload};let reportHash=null;
    if(body.kind==='internal_borrowing')payload.scan=qScan;
    else{const bytes=Uint8Array.from(atob(payload.reportBase64),c=>c.charCodeAt(0));reportHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');}
    const evidence={id:body.evidenceId,kind:body.kind,payload,createdAt:'2026-09-23T10:00:00Z',reportHash};latest[body.kind]=evidence;sessionStorage.setItem('quality-fixture',JSON.stringify(latest));
    if(qLoseSave){qLoseSave=false;throw Error('Ответ на сохранение потерян');}return {evidence};
   }
   if(body.action==='quality-report'){const e=latest.external_originality;return {reportName:e.payload.reportName,reportBase64:e.payload.reportBase64,reportHash:e.reportHash};}
   throw Error('Unexpected action '+body.action);
  };
  window.qPanel=QualityEvidence.mount(qHost,{id:'11111111-1111-4111-8111-111111111111',guard(){if(capturedIdentity!==qualityIdentity)throw Error('Аккаунт изменился');},getBinding:()=>qBinding,ensureVersion:async()=>{},onChange:ready=>qReady=ready});
  await qPanel.refresh();qHost.querySelector('[data-quality-panel]').open=true;
 },{reset,unavailable});
}
async function internal(page){
 await page.locator('[data-quality-scan]').click();await expect(page.locator('[data-finding]')).toHaveCount(1);
 await page.locator('[data-finding-disposition]').selectOption('explained');await page.locator('[data-finding-notes]').fill('Цитата оформлена, источник указан в строке 1.');
 await page.locator('[data-q="internalDisposition"]').selectOption('pass');await page.locator('[data-q="internalNotes"]').fill('Проверены все доступные источники, цитата обоснована.');
 await page.locator('[data-quality-save-internal]').click();await expect(page.locator('[data-internal-saved]')).toContainText('Пройдено');
}
async function externalForm(page){
 await page.locator('details').filter({has:page.locator('[data-q="service"]')}).last().evaluate(el=>el.open=true);
 await page.locator('[data-q="service"]').fill('Учебная система');await page.locator('[data-q="checkId"]').fill('SYNTHETIC-REPORT');await page.locator('[data-q="checkedAt"]').fill('2026-09-23');
 await page.locator('[data-q="thresholdPercent"]').fill('70');await page.locator('[data-q="actualPercent"]').fill('75');await page.locator('[data-q="externalNotes"]').fill('Сверены данные учебного PDF и точный Word.');
 await page.locator('[data-q="externalDisposition"]').selectOption('pass');await page.locator('[data-q="report"]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:PDF});
}
test('C102 internal scan shows limited corpus and needs individual decisions; it is not originality',async({page})=>{
 await setup(page);expect(await page.evaluate(()=>qReady)).toBe(false);
 await page.locator('[data-quality-scan]').click();await expect(page.locator('[data-quality-scope]')).toContainText('Пригодных для сравнения: 1');await expect(page.locator('[data-quality-scope]')).toContainText('source-one');
 await expect(page.locator('[data-quality-findings]')).toContainText('не подтверждает оригинальность');
 await page.locator('[data-q="internalDisposition"]').selectOption('pass');await page.locator('[data-q="internalNotes"]').fill('Проверка имеет нерешённое совпадение.');await page.locator('[data-quality-save-internal]').click();
 await expect(page.locator('[data-quality-status]')).toContainText('каждого совпадения');expect(await page.evaluate(()=>qCalls.filter(x=>x.action==='quality-save').length)).toBe(0);
});
test('C102 saved scan survives lost response and reopen without duplicate writes',async({page})=>{
 await setup(page);await page.locator('[data-quality-scan]').click();await page.locator('[data-finding-disposition]').selectOption('explained');await page.locator('[data-finding-notes]').fill('Оформленная цитата, источник указан.');
 await page.locator('[data-q="internalDisposition"]').selectOption('pass');await page.locator('[data-q="internalNotes"]').fill('Проверены все найденные совпадения.');await page.evaluate(()=>qLoseSave=true);await page.locator('[data-quality-save-internal]').click();
 await expect(page.locator('[data-quality-status]')).toContainText('Ответ на сохранение потерян');expect(await page.evaluate(()=>qReady)).toBe(false);
 await page.locator('[data-quality-refresh]').click();await expect(page.locator('[data-internal-saved]')).toContainText('Пройдено');await expect(page.locator('[data-finding-notes]')).toHaveValue('Оформленная цитата, источник указан.');
 expect(await page.evaluate(()=>qCalls.filter(x=>x.action==='quality-save').length)).toBe(1);
 await setup(page,{reset:false});await expect(page.locator('[data-internal-saved]')).toContainText('Пройдено');expect(await page.evaluate(()=>qReady)).toBe(false);
});
test('C102 external PDF requires both confirmations and below-threshold result cannot pass',async({page})=>{
 await setup(page);await externalForm(page);await page.locator('[data-quality-save-external]').click();await expect(page.locator('[data-quality-status]')).toContainText('Подтвердите основание');
 expect(await page.evaluate(()=>qCalls.some(x=>x.action==='quality-save'))).toBe(false);
 await expect(page.locator('[data-q="service"]')).toHaveValue('Учебная система');await expect(page.locator('[data-q="service"]')).toBeEnabled();expect(await page.locator('[data-q="report"]').evaluate(el=>el.files.length)).toBe(1);await page.locator('[data-q="requirementConfirmed"]').check();await page.locator('[data-q="wordBindingConfirmed"]').check();await page.locator('[data-q="actualPercent"]').fill('60');await page.locator('[data-quality-save-external]').click();
 await expect(page.locator('[data-quality-status]')).toContainText('ниже требуемого порога');expect(await page.evaluate(()=>qCalls.some(x=>x.action==='quality-save'))).toBe(false);
});
test('C102 both current passes restore readiness and PDF download verifies exact bytes',async({page})=>{
 await setup(page);await internal(page);await externalForm(page);await page.locator('[data-q="requirementConfirmed"]').check();await page.locator('[data-q="wordBindingConfirmed"]').check();await page.locator('[data-quality-save-external]').click();await expect.poll(()=>page.evaluate(()=>qReady)).toBe(true);
 await page.locator('details').filter({has:page.locator('[data-quality-report]')}).last().evaluate(el=>el.open=true);
 const pending=page.waitForEvent('download');await page.locator('[data-quality-report]').click();const file=await pending;const fs=require('node:fs');expect(fs.readFileSync(await file.path())).toEqual(PDF);
 await setup(page,{reset:false});expect(await page.evaluate(()=>qReady)).toBe(true);
 const call=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('quality-fixture')).external_originality.payload);expect(call.thresholdBasis).toBe('Оригинальность не менее 70 процентов');expect(call.thresholdPercent).toBe(70);
});
test('C102 unavailable state and account/version changes never keep positive readiness',async({page})=>{
 await setup(page,{unavailable:true});expect(await page.evaluate(()=>qReady)).toBe(false);await expect(page.locator('[data-quality-status]')).toContainText('недоступны');
 await setup(page);await page.evaluate(()=>qDeferred=true);await page.locator('[data-quality-scan]').click();await page.evaluate(()=>{qualityIdentity='other';qRelease();});await expect(page.locator('[data-quality-status]')).toContainText('Аккаунт');expect(await page.evaluate(()=>qReady)).toBe(false);
 await setup(page);await page.evaluate(()=>qDeferred=true);await page.locator('[data-quality-scan]').click();await page.evaluate(()=>{qBinding={...qBinding,versionId:'55555555-5555-4555-8555-555555555555'};qRelease();});await expect(page.locator('[data-quality-status]')).toContainText('изменились');expect(await page.evaluate(()=>qReady)).toBe(false);
});

test('C102 empty, partial or truncated corpus cannot offer positive internal result',async({page})=>{
 for(const scenario of ['empty','partial','truncated']){
  await setup(page);
  const disposition=page.locator('[data-q="internalDisposition"]');
  const pass=disposition.locator('option[value="pass"]');
  // toBeDisabled follows the enclosing label to its select in Playwright.
  // Inspect the option's native property so manual/fail can remain selectable.
  await expect(pass).toHaveJSProperty('disabled',true);
  await page.locator('[data-quality-scan]').click();
  await expect(pass).toHaveJSProperty('disabled',false);
  await disposition.selectOption('pass');
  await page.evaluate(scenario=>{
   if(scenario==='empty'){qScan.scope.usableSources=0;qScan.scope.providedSources=0;qScan.sources=[];qScan.matches=[];}
   if(scenario==='partial'){qScan.scope.providedSources=2;}
   if(scenario==='truncated'){qScan.limits.truncated=true;qScan.limits.reasons=['document_token_limit'];}
  },scenario);
  await page.locator('[data-quality-scan]').click();
  await expect(page.locator('[data-quality-scope]')).toContainText(scenario==='empty'?'Нет доступных текстов источников':scenario==='partial'?'Часть источников не содержит':'ограничена объёмом');
  await expect(pass).toHaveJSProperty('disabled',true);
  await expect(disposition).toHaveValue('manual');
  await expect(disposition).toBeEnabled();
  await disposition.selectOption('fail');await expect(disposition).toHaveValue('fail');
  await disposition.selectOption('manual');await expect(disposition).toHaveValue('manual');
  expect(await page.evaluate(()=>qReady)).toBe(false);
  expect(await page.evaluate(()=>qCalls.some(x=>x.action==='quality-save'))).toBe(false);
 }
});
