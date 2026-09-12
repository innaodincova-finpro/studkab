const {test,expect}=require('@playwright/test');
const base='http://127.0.0.1:4173/';
async function account(page,file){await page.goto(base+file);await page.evaluate(()=>QA.switchUser('result-test'));await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);}
test('executor reviews Word, retries safely and receives an honest delivery confirmation',async({page})=>{
 await account(page,'reestr.html');await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{
  window.deliveries=[];Oblako.requestApi=async body=>{if(body.action==='prepare-result'){window.prepared=body;var bytes=Uint8Array.from(atob(body.docxBase64),c=>c.charCodeAt(0)),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');return{versionId:body.versionId,recipientId:'55555555-5555-4555-8555-555555555555',fileHash:hash,documentHash:'b'.repeat(64)};}if(body.action==='review-result')return{reviewId:body.reviewId,versionId:body.versionId};deliveries.push(body);if(deliveries.length===1)throw Error('Временный сбой');return{saved:true,deliveryId:body.deliveryId};};
  const candidate={id:'11111111-1111-4111-8111-111111111111',requestNumber:1,topic:'Проверка документа',student:'Тестовый студент',format:{},doc:{order:[{id:'intro',name:'Введение'}],structure:{intro:{text:'Проверенный черновик'}}}};candidate.doc.review=DraftQuality.stamp(candidate);StudResults.deliver(candidate);
 });
 await page.getByRole('button',{name:'Передать в кабинет студента',exact:true}).click();await expect(page.locator('[data-result-status]')).toContainText('Проверьте документ');expect(await page.evaluate(()=>deliveries.length)).toBe(0);
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Проверить Word перед передачей'}).click();expect((await downloaded).suggestedFilename()).toMatch(/\.docx$/);
 await page.locator('details').filter({has:page.locator('[data-criterion]')}).evaluate(el=>el.open=true);for(const field of await page.locator('[data-criterion]').all())await field.fill('Synthetic evidence at page 1');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Передать в кабинет студента',exact:true}).click();await expect(page.locator('[data-result-status]')).toContainText('Временный сбой');
 await page.getByRole('button',{name:'Передать в кабинет студента',exact:true}).click();await expect(page.locator('[data-result-status]')).toContainText('доступен студенту');
 expect(await page.evaluate(()=>deliveries[0].deliveryId===deliveries[1].deliveryId)).toBe(true);await expect(page.getByRole('button',{name:'Черновик передан',exact:true})).toBeDisabled();
 await page.screenshot({path:'test-results/result-delivery-mobile.png'});
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

test('editing a recipient or document after opening delivery prevents sending',async({page})=>{
 await account(page,'reestr.html');
 await page.evaluate(()=>{
  window.deliveries=[];Oblako.requestApi=async body=>{deliveries.push(body);return{saved:true,deliveryId:body.deliveryId};};
  window.candidate={id:'11111111-1111-4111-8111-111111111111',requestNumber:1,topic:'Проверка',student:'Получатель',format:{},doc:{order:[{id:'intro',name:'Введение'}],structure:{intro:{text:'Проверенный текст'}}}};
  candidate.doc.review=DraftQuality.stamp(candidate);StudResults.deliver(candidate);
 });
 await page.getByRole('checkbox').check();
 await page.evaluate(()=>{candidate.id='22222222-2222-4222-8222-222222222222';});
 await page.getByRole('button',{name:'Передать в кабинет студента',exact:true}).click();
 await expect(page.locator('[data-result-status]')).toContainText('Документ или получатель изменился');
 expect(await page.evaluate(()=>deliveries.length)).toBe(0);
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
