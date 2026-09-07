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
   const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить копию',exact:true}).click();
   const roundtrip=JSON.parse(await fs.readFile(await (await exported).path(),'utf8'));
   expect(roundtrip.settings.name).toBe(marker);
 });
}
