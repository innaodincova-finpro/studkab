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
 await page.evaluate(async()=>{await StudClarifications.show({requestId:'test',requestNumber:2,executor:false,api:c084Api,esc:esc,openModal:openModal});});
 // UX-02a: понятное название вместо кода, одно поле ответа, одна кнопка отправки.
 await expect(page.getByText('Вопрос 1 из 1')).toBeVisible();await expect(page.getByText('Объём работы',{exact:true})).toHaveCount(0);
 await expect(page.locator('[data-source]')).toHaveCount(0);
 const send=page.getByRole('button',{name:'Отправить ответы',exact:true});await expect(send).toBeDisabled();
 await page.locator('[data-answer]').fill('25–30 страниц');await expect(send).toBeEnabled();
 await send.click();
 await expect(page.getByText('Ответы отправлены. Исполнитель получит их и продолжит работу.')).toBeVisible();
 await expect(page.getByText('все ответы отправлены')).toBeVisible();
 expect(await page.evaluate(()=>c084Calls.filter(c=>c.action==='clarification-answer').map(c=>[c.answer,c.source]))).toEqual([['25–30 страниц','']]);
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
test('UX-02a: student sees plain topics, attaches a file to an answer and sends all answers at once',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(async()=>{
  window.uxRows=[{id:'11111111-1111-4111-8111-111111111111',item_id:'FIELD_GAP_conflict_1',question:'Какой объём применять: 25–30 или 40–45 страниц?',answer:null},{id:'22222222-2222-4222-8222-222222222222',item_id:'FIELD_GAP_missing_1',question:'Пришлите результаты опроса.',answer:null}];window.uxCalls=[];
  window.uxApi=async function(d){uxCalls.push(d);if(d.action==='clarification-list')return {questions:uxRows};if(d.action==='clarification-read')return {};
   if(d.action==='registered-add')return {attachment:{id:'x'},duplicate:false};
   if(d.action==='clarification-answer'){const q=uxRows.find(q=>q.id===d.questionId);q.answer=d.answer;q.answered_at='2026-10-05T10:00:00Z';return {};}};
  await StudClarifications.show({requestId:'33333333-3333-4333-8333-333333333333',requestNumber:2,executor:false,api:uxApi,esc:esc,openModal:openModal});
 });
 await expect(page.getByText('Документы расходятся',{exact:true})).toBeVisible();await expect(page.getByText('Не хватает данных',{exact:true})).toBeVisible();
 await expect(page.getByText(/FIELD_GAP/)).toHaveCount(0);
 await page.locator('[data-answer]').first().fill('25–30 страниц, как в задании');
 await page.locator('[data-answer-file="22222222-2222-4222-8222-222222222222"]').setInputFiles({name:'Опрос.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from([80,75,3,4,1])});
 await expect(page.getByText('Файл «Опрос.xlsx» добавлен в материалы заявки',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Отправить ответы',exact:true}).click();
 await expect(page.getByText('Ответы отправлены. Исполнитель получит их и продолжит работу.')).toBeVisible();
 const calls=await page.evaluate(()=>uxCalls.filter(c=>c.action!=='clarification-list'&&c.action!=='clarification-read').map(c=>c.action==='registered-add'?['add',c.fileName,c.id]:[c.questionId.slice(0,1),c.answer,c.source]));
 expect(calls).toEqual([['add','Опрос.xlsx','33333333-3333-4333-8333-333333333333'],['1','25–30 страниц, как в задании',''],['2','Приложен файл: Опрос.xlsx','Ответ студента в кабинете; файл добавлен в материалы заявки']]);
 await page.getByText('Отправленные ответы (2)').isVisible();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);expect(overflow).toBe(false);
});
test('UX-02a: a failed answer keeps the typed text and reports the error',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(async()=>{
  window.fRows=[{id:'11111111-1111-4111-8111-111111111111',item_id:'VOLUME',question:'Объём?',answer:null}];
  window.fApi=async function(d){if(d.action==='clarification-list')return {questions:fRows};if(d.action==='clarification-read')return {};throw Error('Нет сети');};
  await StudClarifications.show({requestId:'33333333-3333-4333-8333-333333333333',executor:false,api:fApi,esc:esc,openModal:openModal});
 });
 await page.locator('[data-answer]').fill('30 страниц');await page.getByRole('button',{name:'Отправить ответы',exact:true}).click();
 await expect(page.getByText('Нет сети',{exact:true})).toBeVisible();await expect(page.locator('[data-answer]')).toHaveValue('30 страниц');
});
