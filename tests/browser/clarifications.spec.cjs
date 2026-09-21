const {test,expect}=require('@playwright/test');
for(const width of [390,1440])test('C084 question and answer UI at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(async()=>{
  window.c084Rows=[];window.c084Calls=[];
  window.c084Api=async function(data){c084Calls.push(data);if(data.action==='clarification-list')return {questions:c084Rows};if(data.action==='clarification-ask'){c084Rows.push({id:data.questionId,item_id:data.itemId,question:data.question,answer:null});return {};}
  if(data.action==='clarification-answer'){var q=c084Rows.find(q=>q.id===data.questionId);q.answer=data.answer;q.answer_source=data.source;return {};}};
  await StudClarifications.show({requestId:'test',executor:true,items:[{id:'VOLUME'}],labels:{VOLUME:'Объём'},api:c084Api,esc:esc,openModal:openModal});
 });
 await page.getByText('Задать вопрос студенту',{exact:true}).click();
 await page.locator('[data-question-text]').fill('Сколько страниц основного текста требуется?');
 await page.getByRole('button',{name:'Сохранить вопрос в кабинете студента'}).click();
 await expect(page.getByText('Ожидается ответ студента',{exact:true})).toBeVisible();
 await page.locator('.close[data-x]').last().click();
 await page.evaluate(async()=>{await StudClarifications.show({requestId:'test',executor:false,api:c084Api,esc:esc,openModal:openModal});});
 await page.locator('[data-answer]').fill('25–30 страниц');
 await page.getByRole('button',{name:'Сохранить ответ',exact:true}).click();
 await expect(page.getByText('Заполните ответ и основание',{exact:true})).toBeVisible();
 await page.locator('[data-source]').fill('Методичка, страница 2');
 await page.getByRole('button',{name:'Сохранить ответ',exact:true}).click();
 await expect(page.getByText('Ответ сохранён. Проверка исполнителем — в требованиях.')).toBeVisible();
 expect(await page.locator('[data-answer]').count()).toBe(0);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);expect(overflow).toBe(false);
 await page.screenshot({path:'/tmp/c084-clarifications-'+width+'.png',fullPage:true});
});
test('C084 actual editor resets verification on edits and keeps answer evidence',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(async()=>{
  window.c084Item={id:'44444444-4444-4444-8444-444444444444',passports:[{title:'Test',items:[{id:'VOLUME',category:'measurable',required:true,text:'Объём: 30 страниц',source:'Методичка, с. 2',verified:true,answer_ids:[]}]}]};
  Oblako.requestApi=async()=>({questions:[]});await editPassport(c084Item,true);
 });
 await expect(page.locator('[data-pp-verified="0"]')).toBeChecked();
 await page.getByText('Объём',{exact:true}).click();
 await page.locator('[data-pp-item="0"]').fill('Объём: 25–30 страниц');
 await expect(page.locator('[data-pp-verified="0"]')).not.toBeChecked();
});
