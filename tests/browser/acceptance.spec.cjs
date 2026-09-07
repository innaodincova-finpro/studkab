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
