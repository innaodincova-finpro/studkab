const {test,expect}=require('@playwright/test');
const base='http://127.0.0.1:4173/';
async function account(page,file){await page.goto(base+file);await page.evaluate(()=>QA.switchUser('result-test'));await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);}
test('executor reviews Word, retries safely and receives an honest delivery confirmation',async({page})=>{
 await account(page,'reestr.html');await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{
  window.deliveries=[];Oblako.requestApi=async body=>{deliveries.push(body);if(deliveries.length===1)throw Error('Временный сбой');return{saved:true,deliveryId:body.deliveryId};};
  const candidate={id:'11111111-1111-4111-8111-111111111111',requestNumber:1,topic:'Проверка документа',student:'Тестовый студент',format:{},doc:{order:[{id:'intro',name:'Введение'}],structure:{intro:{text:'Проверенный черновик'}}}};candidate.doc.review=DraftQuality.stamp(candidate);StudResults.deliver(candidate);
 });
 await page.getByRole('button',{name:'Передать в кабинет студента',exact:true}).click();await expect(page.locator('[data-result-status]')).toContainText('Проверьте документ');expect(await page.evaluate(()=>deliveries.length)).toBe(0);
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Проверить Word перед передачей'}).click();expect((await downloaded).suggestedFilename()).toMatch(/\.docx$/);
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Передать в кабинет студента',exact:true}).click();await expect(page.locator('[data-result-status]')).toContainText('Временный сбой');
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
