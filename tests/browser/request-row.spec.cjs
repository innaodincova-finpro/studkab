const {test,expect}=require('@playwright/test');
// C-052 (аудит, замечание 23): заявка открывается нажатием в любом месте строки.
const seed=()=>{D.items=[{id:'row-open-test',student:'Учебный пример',group:'ДЕМО',topic:'Анализ финансового состояния — учебный пример',univ:'Демонстрационный кейс',status:'work',format:{}},{id:'row-open-other',student:'Другая заявка',group:'Т',topic:'Другая тема',univ:'Другой вуз',status:'new',format:{}}];tab='list';openId=null;render();};
for(const size of [{width:390,height:844},{width:1440,height:1000}]){
 test('C-052: request opens from any part of its row at '+size.width,async({page})=>{
  await page.setViewportSize(size);
  await page.goto('http://127.0.0.1:4173/reestr.html');
  await page.evaluate(()=>QA.switchUser('row-open'));
  for(const part of ['Демонстрационный кейс','Анализ финансового состояния — учебный пример','ДЕМО']){
   await page.evaluate(seed);
   await page.getByText(part,{exact:true}).click();
   await expect(page.getByRole('button',{name:'← Заявки',exact:true})).toBeVisible();
   expect(await page.evaluate(()=>openId)).toBe('row-open-test');
  }
  await page.evaluate(seed);
  const row=page.locator('tr',{hasText:'Учебный пример'});
  expect(await row.evaluate(e=>getComputedStyle(e).cursor)).toBe('pointer');
  const name=await page.getByRole('button',{name:'Учебный пример',exact:true}).boundingBox();
  expect(name.height).toBeGreaterThanOrEqual(24);
  await page.getByRole('button',{name:'Учебный пример',exact:true}).focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>openId)).toBe('row-open-test');
 });
}
