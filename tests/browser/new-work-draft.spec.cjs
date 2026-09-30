const {test,expect}=require('@playwright/test');
async function open(page){await page.evaluate(()=>openNewWork());}
async function start(page){
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{window.requestCalls=[];Oblako.requestApi=async body=>{requestCalls.push(body);throw Error('unexpected API');};});
 await open(page);
}
async function fill(page){
 await page.locator('#nTopic').fill('Мотивация персонала <учебная>');
 await page.locator('#nType').selectOption('Курсовая работа');
 await page.locator('#nDue').fill('2026-10-30');
 await page.locator('#nTpl').selectOption('tpl1');
}
async function restored(page){
 await expect(page.locator('#nTopic')).toHaveValue('Мотивация персонала <учебная>');
 await expect(page.locator('#nDue')).toHaveValue('2026-10-30');
 await expect(page.locator('#nType')).toHaveValue('Курсовая работа');
 await expect(page.locator('#nTpl')).toHaveValue('tpl1');
}
for(const way of ['close','backdrop','escape','cancel'])test('new work draft survives '+way,async({page})=>{
 await start(page);await fill(page);
 if(way==='close')await page.locator('.sheet [data-x]').click();
 if(way==='cancel')await page.getByRole('button',{name:'Отмена',exact:true}).click();
 if(way==='escape')await page.keyboard.press('Escape');
 if(way==='backdrop')await page.locator('.sheet').click({position:{x:2,y:2}});
 await open(page);await restored(page);
 expect(await page.evaluate(()=>({works:D.works.length,calls:requestCalls.length}))).toEqual({works:0,calls:0});
});
test('last keystroke survives reload and successful creation clears only its draft',async({page})=>{
 await start(page);await fill(page);await page.reload();await open(page);await restored(page);
 await page.getByRole('button',{name:'Создать',exact:true}).click();
 expect(await page.evaluate(()=>({count:D.works.length,topic:D.works[0].topic,sent:D.works[0].req.sent,draft:localStorage.getItem(KEY+':new-work-draft')})))
 .toEqual({count:1,topic:'Мотивация персонала <учебная>',sent:'',draft:null});
 await open(page);await expect(page.locator('#nTopic')).toHaveValue('');
 await page.reload();expect(await page.evaluate(()=>D.works.length)).toBe(1);
});
test('drafts stay private to each account including stale dialog',async({page})=>{
 await start(page);
 await page.evaluate(()=>{document.querySelector('.sheet').remove();cloudSwitchUser('draft-user-a');openNewWork();});
 await fill(page);
 await page.evaluate(()=>{window.oldDraft=document.querySelector('.sheet');cloudSwitchUser('draft-user-b');openNewWork();});
 await expect(page.locator('#nTopic')).toHaveValue('');
 await page.locator('#nTopic').fill('Тема другого пользователя');
 await page.evaluate(()=>{oldDraft.querySelector('#nTopic').value='Чужой ввод';oldDraft.querySelector('#nTopic').dispatchEvent(new Event('input',{bubbles:true}));oldDraft.querySelector('[data-save]').click();});
 expect(await page.evaluate(()=>D.works.length)).toBe(0);
 await page.evaluate(()=>{cloudSwitchUser('draft-user-a');openNewWork();});await restored(page);
 await page.evaluate(()=>{cloudSwitchUser('draft-user-b');openNewWork();});
 await expect(page.locator('#nTopic')).toHaveValue('Тема другого пользователя');
});
test('storage errors are visible and do not destroy existing records',async({page})=>{
 await start(page);
 await page.evaluate(()=>{window.before=JSON.stringify(D);window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.endsWith(':new-work-draft'))throw Error('quota');return originalSet.call(this,k,v);};});
 await page.locator('#nTopic').fill('Несохранённый ввод');
 await expect(page.locator('[data-new-work-status]')).toContainText('Черновик не сохранён');
 expect(await page.evaluate(()=>JSON.stringify(D)===before)).toBe(true);
 await page.evaluate(()=>{Storage.prototype.setItem=originalSet;});
 await page.locator('#nTopic').fill('Восстановленная запись');
 await expect(page.locator('[data-new-work-status]')).toContainText('Черновик сохранён');
});
test('corrupt draft and missing template never block opening or execute markup',async({page})=>{
 await start(page);
 await page.evaluate(()=>{document.querySelector('.sheet').remove();localStorage.setItem(KEY+':new-work-draft','{broken');openNewWork();});
 await expect(page.locator('[data-new-work-status]')).toContainText('Не удалось прочитать');
 await page.evaluate(()=>{document.querySelector('.sheet').remove();localStorage.setItem(KEY+':new-work-draft',JSON.stringify({version:1,fields:{topic:'<img src=x onerror="window.injected=1">',type:'Несуществующий',due:'2026-10-30',template:'removed'}}));openNewWork();});
 await expect(page.locator('#nTpl')).toHaveValue('');
 await expect(page.locator('#nType')).toHaveValue('Курсовая работа');
 expect(await page.evaluate(()=>window.injected)).toBeUndefined();
});
test('narrow screen restores changed type and intentionally empty date',async({page})=>{
 await page.setViewportSize({width:390,height:844});await start(page);
 await page.locator('#nTopic').fill('Проект команды');
 await page.locator('#nType').selectOption('Эссе');await page.locator('#nDue').fill('');
 await page.reload();await open(page);
 await expect(page.locator('#nTopic')).toHaveValue('Проект команды');
 await expect(page.locator('#nType')).toHaveValue('Эссе');await expect(page.locator('#nDue')).toHaveValue('');
 await expect(page.getByRole('button',{name:'Создать',exact:true})).toBeVisible();
});
