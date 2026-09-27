const {test,expect}=require('@playwright/test');

test('C150 creating a work tells the student that the request has not been sent',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.getByRole('button',{name:'Новая работа'}).first().click();
 const modal=page.getByRole('dialog',{name:'Новая работа'});
 await expect(modal).toContainText('Исполнителю она пока не отправляется');
 await modal.getByRole('textbox',{name:'Тема'}).fill('Проверка первого шага');
 await modal.getByRole('button',{name:'Создать'}).click();
 await expect(page.locator('#toast')).toContainText('Заявка исполнителю ещё не отправлена');
 await expect(page.getByRole('button',{name:'Заявка'})).toBeVisible();
 expect(await page.evaluate(()=>D.works[0]?.req?.serverId)).toBeUndefined();
});

test('C149 opening a student request reads its stage and retry remains available',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  const w={id:'c149-work',topic:'Тестовая заявка',deadline:'2026-10-15',student:'Студент',format:{workType:'Курсовая'},structure:emptyStructure(),req:{id:'c149',serverId:'11111111-1111-4111-8111-111111111111',number:1}};
  D.works=[w];window.progressCalls=[];
  Oblako.requestApi=async body=>{if(body.action==='student-progress'){progressCalls.push(body);return {stage:'requirements_review',openQuestions:0};}return {question:0};};
  go('works',w.id);
 });
 await expect(page.locator('[data-student-progress]')).toContainText('Исполнитель проверяет требования');
 await expect(page.getByText('Результат заявки',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Обновить этап'}).click();
 await expect.poll(()=>page.evaluate(()=>progressCalls.length)).toBe(2);
 await page.evaluate(()=>go('today'));
 await expect(page.getByText(/мои разделы: \d+%/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Условия заявки'})).toBeVisible();
});
