const {test,expect}=require('@playwright/test');
async function seed(page){
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>QA.switchUser('workspace-synthetic'));
 await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);
 await page.evaluate(()=>{
  D.items=Array.from({length:67},(_,i)=>({id:'workspace-'+i,requestNumber:1201+i,student:'Учебный студент '+i,topic:'Тема '+i+' — Организация проектной команды',univ:'Учебный университет',status:i===66?'sent':'new',format:{},passports:[],note:'Сохранённая заметка'}));
  tab='list';openId=null;filter='all';query='';listPage=1;listPageSize=25;render();
 });
}
test('pagination, number search and return preserve list context',async({page})=>{
 await seed(page);
 await expect(page.locator('.request-row')).toHaveCount(25);
 await page.getByRole('button',{name:'Следующая страница',exact:true}).first().click();
 await expect(page.locator('.open-request').first()).toHaveText('№ 1226');
 await page.locator('.open-request').nth(8).scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>({scroll:scrollY,data:JSON.stringify(D)}));
 await page.locator('.open-request').nth(8).click();
 await page.getByRole('button',{name:'← Заявки',exact:true}).click();
 expect(await page.evaluate(()=>listPage)).toBe(2);
 expect(await page.evaluate(()=>Math.abs(scrollY-listScroll))).toBeLessThan(3);
 expect(await page.evaluate(()=>JSON.stringify(D))).toBe(before.data);
 await page.getByLabel('Заявок на странице',{exact:true}).first().selectOption('50');
 await expect(page.locator('.request-row')).toHaveCount(50);
 await page.getByRole('searchbox',{name:'Поиск заявок'}).fill('1267');
 await expect(page.locator('.request-row')).toHaveCount(1);
 await expect(page.locator('.registry-filters')).toContainText('Все · 1');
 await page.locator('.registry-filters').getByRole('button',{name:'Подготовка · 0',exact:true}).click();
 await expect(page.locator('.request-row')).toHaveCount(0);
 await page.locator('.registry-filters').getByRole('button',{name:'Все · 1',exact:true}).click();
 await expect(page.getByRole('searchbox')).toHaveValue('1267');
 await page.locator('.open-request').focus();await page.keyboard.press('Enter');
 await expect(page.locator('.request-head')).toContainText('№ 1267');
 await expect(page.locator('.request-action button')).toHaveCount(1);
});
test('six tabs retain unsaved note, keyboard focus and request data',async({page})=>{
 await seed(page);await page.locator('.open-request').first().click();
 const before=await page.evaluate(()=>JSON.stringify(D));
 await page.locator('#note').fill('Ещё не сохранено');
 for(const name of ['Требования','Материалы','Документ','Проверка','Версии и история','Обзор']){
  await page.getByRole('tab',{name,exact:true}).click();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
 }
 await expect(page.locator('#note')).toHaveValue('Ещё не сохранено');
 expect(await page.evaluate(()=>JSON.stringify(D))).toBe(before);
 await page.getByRole('tab',{name:'Обзор',exact:true}).focus();
 await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'Требования',exact:true})).toBeFocused();
 await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'Версии и история',exact:true})).toBeFocused();
 await page.keyboard.press('Home');await page.locator('[data-act="save-note"]').click();
 expect(await page.evaluate(()=>item('workspace-0').note)).toBe('Ещё не сохранено');
 await page.evaluate(()=>QA.switchUser('workspace-other'));
 await expect.poll(()=>page.evaluate(()=>openId)).toBeNull();
 await expect(page.locator('#note')).toHaveCount(0);
});
test('single primary action uses real workflow and keeps exact Word review gate',async({page})=>{
 await seed(page);
 for(const kind of ['intake','passport','quality','delivery','cancelled','delivered']){
  await page.evaluate(kind=>{
   const x=D.items[0];x.status=kind==='cancelled'?'off':kind==='delivered'?'sent':'new';
   x.passports=kind==='intake'?[]:[{revision:1,status:kind==='passport'?'draft':'approved',items:[]}];
   delete x.doc;
   if(['quality','delivery'].includes(kind)){docOf(x);const id=x.doc.order[0].id;x.doc.structure[id].text='Учебный текст';if(kind==='delivery')x.doc.review=DraftQuality.stamp(x);}
   openId=x.id;render();
  },kind);
  await expect(page.locator('.request-action button[data-act]')).toHaveCount(kind==='cancelled'?0:1);
  const duplicates=await page.evaluate(()=>{const b=document.querySelector('.request-action button[data-act]');return b?document.querySelectorAll('#page button[data-act="'+b.dataset.act+'"]').length:0;});
  expect(duplicates).toBe(kind==='cancelled'?0:1);
  if(kind==='delivery')await expect(page.locator('.request-action')).toContainText('Провести итоговую проверку');
  if(kind==='delivered')await expect(page.locator('.request-action')).not.toContainText('Маршрут завершён');
 }
});
for(const width of [320,390,768,1440])test('layout stays readable at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await seed(page);
 await page.evaluate(()=>{D.items[0].topic='Длинная тема исследования '.repeat(18);render();});
 for(const theme of ['blue','green','lilac']){
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.evaluate(()=>{D.theme='blue';applyTheme();D.items[0].topic='Организация проектной команды';render();document.getElementById('toast').style.display='none';});
 await page.screenshot({path:'test-results/workspace-registry-'+width+'.png'});
 await page.locator('.open-request').first().click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('tab',{name:'Материалы',exact:true}).click();
 await expect(page.getByRole('tabpanel')).toContainText('Список файлов ещё не получен');
 const action=await page.locator('.request-action').boundingBox();expect(action.x).toBeGreaterThanOrEqual(0);expect(action.x+action.width).toBeLessThanOrEqual(width+1);
 await page.screenshot({path:'test-results/workspace-request-'+width+'.png'});
});

test('C072 refresh updates history without overwriting an existing document or notes',async({page})=>{
 await seed(page);
 await page.evaluate(()=>{
  const x=D.items[0];docOf(x);x.doc.structure[x.doc.order[0].id].text='Текущий изменённый текст';
  window.beforeRefresh=JSON.stringify({doc:x.doc,note:x.note,passports:x.passports,topic:x.topic});
  Oblako.requestApi=async input=>{
   if(!input.includeDeliveryState)throw Error('Missing history request');
   return {rows:[{id:x.id,number:x.requestNumber,payload:{id:x.id,t:'Не перезаписывать тему',n:'Не перезаписывать имя'},deliveryState:{checkedAt:'2026-09-20T10:00:00Z',last:{versionId:'old-version',deliveryId:'receipt',createdAt:'2026-09-18T11:07:52Z'}}}],next:null};
  };
 });
 await page.locator('[data-act="receive-inbox"]').click();
 await expect(page.locator('.request-row').first()).toContainText('Ранее передано');
 expect(await page.evaluate(()=>{const x=D.items[0];return JSON.stringify({doc:x.doc,note:x.note,passports:x.passports,topic:x.topic})===beforeRefresh;})).toBe(true);
 await page.locator('.open-request').first().click();
 await expect(page.locator('.request-action')).toContainText('Ранее передано');
 await expect(page.locator('.request-action')).not.toContainText('Маршрут завершён');
 await page.getByRole('tab',{name:'Версии и история',exact:true}).click();
 await expect(page.locator('#request-panel-history')).toContainText('18 сентября');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/c072-delivery-history.png'});
});
test('C072 an older endpoint cannot erase known delivery history',async({page})=>{
 await seed(page);
 await page.evaluate(()=>{
  const x=D.items[0];x.deliveryState={checkedAt:'2026-09-20',last:{createdAt:'2026-09-18',versionId:'old'}};
  Oblako.requestApi=async()=>({rows:[{id:x.id,number:x.requestNumber,payload:{id:x.id,t:x.topic}}],next:null});
 });
 await page.locator('[data-act="receive-inbox"]').click();
 expect(await page.evaluate(()=>D.items[0].deliveryState.last.versionId)).toBe('old');
});
test('C072 account change while inbox is pending cannot merge old history',async({page})=>{
 await seed(page);
 await page.evaluate(()=>{
  window.oldWorkspace=D;
  Oblako.requestApi=()=>new Promise(resolve=>window.finishInbox=resolve);
  window.refreshPending=receiveInbox();
 });
 await page.evaluate(()=>QA.switchUser('c072-another-account'));
 await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);
 const before=await page.evaluate(()=>JSON.stringify(D));
 await page.evaluate(async()=>{finishInbox({rows:[{id:'workspace-0',number:1201,payload:{id:'workspace-0',t:'Old account'},deliveryState:{checkedAt:'2026-09-20',last:{createdAt:'2026-09-18'}}}],next:null});await refreshPending;});
 expect(await page.evaluate(()=>JSON.stringify(D))).toBe(before);
 expect(await page.evaluate(()=>oldWorkspace.items[0].deliveryState)).toBeUndefined();
});

for(const width of [390,1440])test('C081 compact passport preserves full requirements at '+width,async({page})=>{
 await seed(page);await page.setViewportSize({width,height:1000});
 await page.evaluate(()=>{
  const x=D.items[0];x.requirements='Полный исходный текст заявки. '.repeat(25);x.methodNotes='Методические пояснения. '.repeat(20);
  x.passports=[{id:'draft',revision:2,status:'draft',items:[
   {id:'VOLUME',text:'Объём: 25–30 страниц основного текста',required:true},
   {id:'SOURCES',text:'Источники: учебные фрагменты S1–S5; не выдавать за реальные публикации',required:true},
   {id:'METHODOLOGY',text:'Методология: '+x.methodNotes,required:true},
   {id:'ANTIPLAGIARISM',text:'Система и порог оригинальности: Не указано — требуется уточнить',required:true}
  ]}];openId=x.id;window.c081Before=JSON.stringify(x);render();
 });
 await page.getByRole('tab',{name:'Требования',exact:true}).click();
 const panel=page.locator('#request-panel-requirements');
 await expect(panel.getByText('25–30 страниц основного текста',{exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Утвердить',exact:true})).toBeDisabled();
 await page.screenshot({path:'test-results/c081-compact-'+width+'.png',fullPage:true});
 const originals=panel.locator('.requirement-original');await expect(originals).not.toHaveAttribute('open','');
 await originals.locator('summary').click();await expect(originals).toHaveAttribute('open','');
 await expect(originals).toContainText('Полный исходный текст заявки. '.repeat(25).trim());
 const details=panel.locator('.requirement-detail').filter({has:page.locator('summary', {hasText:'Подробнее'})}).first();
 await details.locator('summary').focus();await page.keyboard.press('Enter');await expect(details).toHaveAttribute('open','');
 expect(await page.evaluate(()=>JSON.stringify(D.items[0])===c081Before)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:'test-results/c081-expanded-'+width+'.png',fullPage:true});
});
