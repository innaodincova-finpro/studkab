const {test,expect}=require('@playwright/test');
for(const file of ['index.html','reestr.html']){
 test(file+': login form, autosave, reload offline edits and explicit conflict choice',async({page})=>{
  await page.goto('http://127.0.0.1:4173/'+file);
  await page.locator('[data-tab="more"]').click();
  await page.getByText('Хранение записей',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Войти через Google',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Войти по почте и паролю',exact:true}).click();
  await page.getByLabel('Электронная почта',{exact:true}).fill('cloud-flow@example.test');
  await page.getByLabel('Пароль приложения',{exact:true}).fill('test-password-123');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Oblako.canSync())).toBe(true);
  await page.evaluate(()=>{D.settings.name='Первое изменение';save();});
  await expect.poll(()=>page.evaluate(()=>QA.rows[QA.user+':'+CLOUD_APP]?.data.settings.name)).toBe('Первое изменение');
  await page.evaluate(()=>{QA.failWrite=true;D.settings.name='Без сети';save();});
  await expect.poll(()=>page.evaluate(()=>Oblako.lastError)).not.toBe('');
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>QA.rows[QA.user+':'+CLOUD_APP]?.data.settings.name)).toBe('Без сети');
  await page.evaluate(()=>{
   const key=QA.user+':'+CLOUD_APP,row=QA.rows[key];row.data.settings.name='Другое устройство';row.rev++;
   D.settings.name='Местная версия';save();
  });
  await expect.poll(()=>page.evaluate(()=>Oblako.lastError)).toContain('другом устройстве');
  await page.evaluate(()=>{CloudUI.sync();});
  await expect(page.getByRole('heading',{name:'Записи на устройствах различаются'})).toBeVisible();
  await page.getByRole('button',{name:'Решить позже — ничего не заменять'}).click();
  expect(await page.evaluate(()=>D.settings.name)).toBe('Местная версия');
  expect(await page.evaluate(()=>QA.rows[QA.user+':'+CLOUD_APP].data.settings.name)).toBe('Другое устройство');
  await page.evaluate(()=>{CloudUI.sync();});
  await page.getByRole('button',{name:'Использовать записи из облака',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>D.settings.name)).toBe('Другое устройство');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(KEY+':before-cloud-choice')).local.settings.name)).toBe('Местная версия');
  expect(await page.evaluate(()=>Oblako.canSync())).toBe(true);
 });
}

test('choice rejects stale local edit and keeps both records',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>QA.switchUser('stale-choice'));await expect.poll(()=>page.evaluate(()=>Oblako.canSync())).toBe(true);
 await page.evaluate(()=>{D.settings.name='Local';const remote=JSON.parse(JSON.stringify(D));remote.settings.name='Remote';QA.rows[QA.user+':'+CLOUD_APP]={rev:3,data:remote};CloudUI.sync();});
 await expect(page.getByRole('heading',{name:'Записи на устройствах различаются'})).toBeVisible();
 await page.evaluate(()=>{D.settings.name='Edited while choosing';save();});
 await page.getByRole('button',{name:'Использовать записи из облака',exact:true}).click();
 expect(await page.evaluate(()=>D.settings.name)).toBe('Edited while choosing');
 expect(await page.evaluate(()=>QA.rows[QA.user+':'+CLOUD_APP].data.settings.name)).toBe('Remote');
});
