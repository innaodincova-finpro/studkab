const {test,expect}=require('@playwright/test');
async function setup(page){
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(async()=>{
  window.studyCalls=[];window.studyIdentity='executor';Oblako.identity=()=>studyIdentity;
  window.studyState={state:'done',manifest:'a'.repeat(64),dialog:[],analysisId:'22222222-2222-4222-8222-222222222222',files:[{id:'33333333-3333-4333-8333-333333333333',name:'Задание.docx',status:'ready',category:'unclassified'}],result:{fields:{t:{label:'Тема',values:[{value:'<img src=x onerror=alert(1)>',refs:[]}]}},requirements:[],roles:[{role:'assignment',refs:[{fileId:'33333333-3333-4333-8333-333333333333'}]}]},proposals:[{id:'44444444-4444-4444-8444-444444444444',analysis_id:'22222222-2222-4222-8222-222222222222',state:'pending',question:'Какая тема согласована?',reason:'В документах разные темы',evidence:[{value:'Тема 1',refs:[{fileName:'Задание.docx',source:{paragraph:2},quote:'Тема 1'}]}]}]};
  window.studyApi=async d=>{studyCalls.push(d);if(d.action==='registered-study-state')return {study:structuredClone(studyState)};await new Promise(r=>setTimeout(r,100));
   if(d.action==='registered-private-message'){studyState.dialog.push({kind:'executor',body:d.text});studyState.state='awaiting_analysis';studyState.manifest='b'.repeat(64);return {};}
   if(d.action==='registered-material-classify'){studyState.files[0].category=d.category;return {};}
   const q=studyState.proposals[0];if(d.decision==='publish'){q.state='published';q.published_text=d.text;}else{q.state='returned';q.return_comment=d.text;studyState.state='awaiting_analysis';}return {};
  };
  await StudRegisteredStudy.show({requestId:'11111111-1111-4111-8111-111111111111',api:studyApi,esc:esc,openModal:openModal});
 });
}
for(const width of [390,1440])test('registered study: executor edits and explicitly publishes once at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page);
 await expect(page.getByText('В документах разные темы',{exact:true})).toBeVisible();
 expect(await page.locator('.sheet-in img').count()).toBe(0);
 expect(await page.evaluate(()=>studyCalls.filter(c=>c.action==='registered-question-decide').length)).toBe(0);
 await page.locator('[data-proposal-text]').fill('Подтвердите тему из задания преподавателя.');
 await page.locator('[data-proposal-publish]').evaluate(b=>{b.click();b.click();});
 await expect(page.getByText('Подтвердите тему из задания преподавателя.',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>studyCalls.filter(c=>c.action==='registered-question-decide').length)).toBe(1);
 expect(await page.evaluate(()=>studyCalls.find(c=>c.action==='registered-question-decide').text)).toBe('Подтвердите тему из задания преподавателя.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
});
test('registered study: return stays private and requests repeat study with the comment',async({page})=>{
 await setup(page);await page.getByText('Вопрос лишний',{exact:true}).click();await page.locator('[data-proposal-return]').click();
 await expect(page.locator('[data-study-status]')).toContainText('от 10 знаков');
 await page.locator('[data-proposal-comment]').fill('Проверьте применимость темы из методички.');await page.locator('[data-proposal-return]').click();
 await expect(page.getByText('Ожидает повторного изучения комплекта',{exact:true})).toBeVisible();
 expect(await page.locator('[data-proposal-publish]').count()).toBe(0);
 expect(await page.evaluate(()=>studyCalls.filter(c=>c.decision==='publish').length)).toBe(0);
});
test('registered study: file role needs its own explicit executor confirmation',async({page})=>{
 await setup(page);await expect(page.getByText('Назначение определено автоматически. Проверьте и подтвердите.',{exact:true})).toBeVisible();
 await page.locator('[data-file-classify-all]').click();
 await expect(page.getByText('✓ Назначение файлов подтверждено',{exact:true})).toBeVisible();
 await expect(page.getByText('Задание.docx — Задание',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>studyCalls.filter(c=>c.action==='registered-material-classify').length)).toBe(1);
 expect(await page.evaluate(()=>studyCalls.filter(c=>c.action==='registered-question-decide').length)).toBe(0);
});
test('registered study: account change blocks a pending decision',async({page})=>{
 await setup(page);await page.evaluate(()=>{studyIdentity='student';});await page.locator('[data-proposal-publish]').click();
 await expect(page.locator('[data-study-status]')).toContainText('Аккаунт изменился');
 expect(await page.evaluate(()=>studyCalls.filter(c=>c.action==='registered-question-decide').length)).toBe(0);
});
test('registered study: inadequate answer has readable grounds and cannot appear resolved',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{studyState.result.kitReview={version:'registered-kit-review-1',gaps:[{key:'cash_flow'}],returnedReviews:[{status:'resolved',reason:'Справочник вузов не требуется по заданию.',refs:[{fileName:'Задание.docx',source:{paragraph:3},quote:'Справочник вузов не нужен'}]}],answerReviews:[{status:'insufficient',reason:'Ответ не предоставляет требуемый ОДДС.',refs:[{fileName:'Задание.docx',source:{paragraph:2},quote:'Предоставить ОДДС'}]}]};document.querySelector('.sheet-in').innerHTML=StudRegisteredStudy.content(studyState,esc);});
 await expect(page.getByText('Ответ недостаточен',{exact:true})).toBeVisible();
 await expect(page.getByText('Вопрос снят по заключению',{exact:true})).toBeVisible();
 await expect(page.getByText('Справочник вузов не требуется по заданию.',{exact:true})).toBeVisible();
 await expect(page.getByText('Ответ не предоставляет требуемый ОДДС.',{exact:true})).toBeVisible();
 await expect(page.getByText('Нужно ваше решение по 1 вопросу.',{exact:false})).toBeVisible();
 await expect(page.getByText('Подготовка работы начнётся, когда вопросы будут решены.',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>studyCalls.filter(c=>c.action==='registered-question-decide').length)).toBe(0);
});

for(const width of [390,1440])test('private dialog: escaped comment, one save and refresh at '+width,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page);
 const body='<img src=x onerror=alert(1)> Проверьте применимость темы.';
 await page.getByText('Переписка с помощником',{exact:true}).click();
 await page.locator('[data-private-text]').fill(body);await page.locator('[data-private-send]').evaluate(b=>{b.click();b.click();});
 await expect(page.getByText(body,{exact:true})).toBeVisible();expect(await page.locator('.sheet-in img').count()).toBe(0);
 expect(await page.evaluate(()=>studyCalls.filter(c=>c.action==='registered-private-message').length)).toBe(1);
 expect(await page.evaluate(()=>studyCalls.some(c=>c.action==='registered-question-decide'))).toBe(false);
 await page.locator('[data-study-refresh]').click();await expect(page.getByText(body,{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
});
test('private dialog: changed account refuses a comment without sending it',async({page})=>{
 await setup(page);await page.getByText('Переписка с помощником',{exact:true}).click();await page.locator('[data-private-text]').fill('Проверьте методичку ещё раз.');await page.evaluate(()=>{studyIdentity='student';});await page.locator('[data-private-send]').click();
 await expect(page.locator('[data-study-status]')).toContainText('Аккаунт изменился');expect(await page.evaluate(()=>studyCalls.some(c=>c.action==='registered-private-message'))).toBe(false);
});

// UX-01: главное наверху — состояние и вопросы идут до справочных разделов; повторов цитат нет.
test('registered study: decision first, reference sections after, no duplicated quote',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{studyState.result.fields.t.values[0]={value:'Тема работы',refs:[{fileName:'Задание.docx',source:{paragraph:3},quote:'Тема работы'}]};studyState.result.requirements=[{value:'Объём 25–30 страниц',refs:[{fileName:'Задание.docx',source:{paragraph:4},quote:'Объём 25–30 страниц'}]}];document.querySelector('.sheet-in').innerHTML=StudRegisteredStudy.content(studyState,esc);});
 const order=await page.evaluate(()=>{const t=document.querySelector('.sheet-in').textContent;return ['Нужно ваше решение по 1 вопросу','Вопросы студенту','Что система поняла о работе','Файлы','Требования из документов (1)','Переписка с помощником'].map(x=>t.indexOf(x));});
 expect(order.every(x=>x>=0)).toBe(true);expect(order).toEqual([...order].sort((a,b)=>a-b));
 expect(await page.locator('.sheet-in').getByText('«Тема работы»').count()).toBe(0);
 await expect(page.locator('[data-proposal-return]')).toBeHidden();await expect(page.locator('[data-private-text]')).toBeHidden();
 expect(await page.locator('.sheet-in').getByText('Голосовая переписка',{exact:false}).count()).toBe(0);
 expect(await page.locator('.sheet-in').getByText('Сохранено частей',{exact:false}).count()).toBe(0);
});
