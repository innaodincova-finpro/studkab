const {test,expect}=require('@playwright/test');
for(const file of ['reestr.html','index.html'])test('desktop workspace and mobile layout '+file,async({page})=>{
 await page.goto('http://127.0.0.1:4173/'+file);
 await page.evaluate(()=>QA.switchUser('desktop-test'));
 await page.setViewportSize({width:1440,height:1000});
 await expect.poll(()=>page.locator('.phone').evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThan(1300);
 const nav=await page.locator('.tabs').boundingBox();expect(nav.x).toBe(0);expect(nav.width).toBe(224);
 if(file==='reestr.html'){
  await page.evaluate(()=>{D.items=[{id:'desktop-synthetic',student:'Тест рабочего стола',group:'Тест',topic:'Проверка широкой таблицы',univ:'Учебный вуз',status:'new',format:{}}];tab='list';openId=null;render();});
  await expect(page.getByRole('table',{name:'Заявки студентов'})).toBeVisible();
  await page.getByRole('button',{name:'Тест рабочего стола',exact:true}).click();
  await page.getByText('Готовый результат',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Собрать документ',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Собрать документ',exact:true}).click();
  expect((await page.locator('.sheet-in').last().boundingBox()).width).toBeGreaterThan(1000);
  await page.screenshot({animations:'disabled',path:'test-results/desktop-editor.png'});
  await page.locator('.sheet .close').last().click();
  await page.getByRole('button',{name:'← Заявки',exact:true}).click();
 }
 await page.screenshot({animations:'disabled',path:'test-results/desktop-'+file+'.png'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:390,height:844});
 expect((await page.locator('.phone').boundingBox()).width).toBeLessThanOrEqual(390);
 const mobileNav=await page.locator('.tabs').boundingBox();expect(mobileNav.y).toBeGreaterThan(650);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({animations:'disabled',path:'test-results/mobile-'+file+'.png'});
});

test('university registry stays compact and opens one university at a time',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{QA.switchUser('refs-desktop-test');D.refs=[
  {id:'ref-a1',univ:'Первый университет',faculty:'Факультет экономики',kafedra:'Кафедра финансов',format:{},verified:false,requests:2},
  {id:'ref-a2',univ:'Первый университет',faculty:'Факультет управления',kafedra:'',format:{},verified:true,requests:1},
  {id:'ref-b1',univ:'Второй университет',faculty:'Институт права',kafedra:'',format:{},verified:true,requests:4}
 ];tab='refs';openRefId=null;render();});
 await expect(page.locator('.ref-group')).toHaveCount(2);
 await expect(page.getByText('Факультет экономики',{exact:true})).toBeHidden();
 await page.locator('.ref-group').first().locator('summary').click();
 await expect(page.getByText('Факультет экономики',{exact:true})).toBeVisible();
 await page.locator('.ref-group').last().locator('summary').click();
 await expect(page.getByText('Факультет экономики',{exact:true})).toBeHidden();
 await expect(page.getByText('Институт права',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Требует уточнения',exact:true}).click();
 await expect(page.locator('.ref-group')).toHaveCount(1);
 await page.getByPlaceholder('Поиск по вузу, факультету, кафедре').fill('управления');
 await expect(page.locator('.ref-group')).toHaveCount(0);
});
