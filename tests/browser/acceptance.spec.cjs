const {test,expect}=require('@playwright/test');
test('real browser: accounts, writes, recovery, mobile, DOCX',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4173/tests/qa.html');
 await page.getByRole('button',{name:'Запустить приёмку'}).click();
 await expect(page.locator('#results')).toContainText('Приёмка завершена',{timeout:60000});
 await expect(page.locator('#results .fail')).toHaveCount(0);
 expect(errors).toEqual([]);
 console.log(await page.locator('#results').innerText());
});
const fs=require('node:fs/promises');
for(const file of ['index.html','reestr.html']){
 test(file+': download and restore backup through UI',async({page})=>{
   await page.goto('http://127.0.0.1:4173/'+file);
   await page.locator('[data-tab="more"]').click();
   await page.getByText('Копия данных',{exact:true}).click();
   const downloaded=page.waitForEvent('download');
   await page.getByRole('button',{name:'Сохранить копию',exact:true}).click();
   const data=JSON.parse(await fs.readFile(await (await downloaded).path(),'utf8'));
   expect(data.settings?.proxyToken).toBeUndefined();
   const marker='Проверка восстановления';data.settings=data.settings||{};data.settings.name=marker;
   const upload=page.waitForEvent('filechooser');
   await page.getByRole('button',{name:'Загрузить копию',exact:true}).click();
   await (await upload).setFiles({name:'test-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
   await expect(page.locator('#toast')).toContainText('Данные загружены');
   await page.reload();await page.locator('[data-tab="more"]').click();
   await page.getByText('Копия данных',{exact:true}).click();
   const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить копию',exact:true}).click();
   const roundtrip=JSON.parse(await fs.readFile(await (await exported).path(),'utf8'));
   expect(roundtrip.settings.name).toBe(marker);
 });
}

test('profile sections collapse without losing unsaved input',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.locator('[data-tab="more"]').click();
 await expect(page.locator('.profile-fold[open]')).toHaveCount(0);
 await page.getByText('Данные студента',{exact:true}).click();
 await page.locator('#stName').fill('Проверка профиля');
 await page.getByText('Данные студента',{exact:true}).click();
 await expect(page.locator('#stName')).toBeHidden();
 await page.getByText('Данные студента',{exact:true}).click();
 await expect(page.locator('#stName')).toHaveValue('Проверка профиля');
 await page.locator('.profile-fold').filter({has:page.locator('#stName')}).getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.reload();await page.locator('[data-tab="more"]').click();
 await page.getByText('Данные студента',{exact:true}).click();
 await expect(page.locator('#stName')).toHaveValue('Проверка профиля');
});

test('saving profile fills only blank shared fields of an existing work',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
   D=emptyData();
   const format=defaultFormat();format.univ='Особый вуз';format.discipline='Управление проектами';format.supervisor='Иванов И. И.';
   D.works.push({id:'w-test',topic:'Организация работы проектной команды',student:'',group:'',created:today(),deadline:addDays(today(),30),requirements:'',status:'draft',format,structure:emptyStructure(),tasks:[],req:{id:'rq-test',contact:'',org:'',notes:'',sent:''}});
   save();render();
 });
 await page.locator('[data-tab="more"]').click();
 await page.getByText('Данные студента',{exact:true}).click();
 await page.locator('#stName').fill('Тестовый студент');
 await page.locator('#stUniv').fill('Общий вуз');
 await page.locator('#stKaf').fill('Кафедра управления');
 await page.locator('#stGroup').fill('Т-1');
 await page.locator('#stContact').fill('@test');
 await page.locator('.profile-fold').filter({has:page.locator('#stName')}).getByRole('button',{name:'Сохранить',exact:true}).click();
 const work=await page.evaluate(()=>D.works[0]);
 expect(work.student).toBe('Тестовый студент');expect(work.group).toBe('Т-1');expect(work.req.contact).toBe('@test');
 expect(work.format.univ).toBe('Особый вуз');expect(work.format.kafedra).toBe('Кафедра управления');
 expect(work.format.discipline).toBe('Управление проектами');expect(work.format.supervisor).toBe('Иванов И. И.');
});
