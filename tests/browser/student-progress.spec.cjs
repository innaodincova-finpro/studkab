const {test,expect}=require('@playwright/test');

test('C150 creating a work tells the student that the request has not been sent',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.getByRole('button',{name:'Вести работу самостоятельно'}).click();
 const modal=page.getByRole('dialog',{name:'Новая работа'});
 await expect(modal).toContainText('Исполнителю она пока не отправляется');
 await modal.getByRole('textbox',{name:'Тема'}).fill('Проверка первого шага');
 await modal.getByRole('button',{name:'Создать'}).click();
 await expect(page.locator('#toast')).toContainText('Заявка исполнителю ещё не отправлена');
 const action=page.getByRole('button',{name:'Заполнить и отправить заявку'});
 await expect(action).toBeVisible();
 await expect(action).toHaveCount(1);
 expect(await page.evaluate(()=>D.works[0]?.req?.serverId)).toBeUndefined();
 await action.click();
 await expect(page.getByRole('dialog',{name:'Заявка исполнителю'})).toBeVisible();
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

test('C151 approved requirements do not claim Word was delivered or materials can be added now',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  const w={id:'c151-work',topic:'Учебный вариант 1',deadline:'2026-10-25',format:{workType:'Курсовая'},structure:emptyStructure(),req:{id:'c151',serverId:'11111111-1111-4111-8111-111111111111',number:1}};
  D.works=[w];
  Oblako.requestApi=async body=>body.action==='student-progress'?{stage:'requirements_approved',openQuestions:0}:{question:0};
  go('works',w.id);
 });
 await expect(page.locator('[data-student-progress]')).toContainText('готовит или проверяет Word');
 await expect(page.locator('[data-student-progress]')).toContainText('передача студенту ещё не зарегистрирована');
 await expect(page.getByText('Добавить новые получится, если исполнитель откроет дополнение материалов.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Открыть материалы заявки'})).toBeVisible();
});

test('Home leads to «Отправить задание»; the own-work window offers practical and laboratory work',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await expect(page.locator('#page')).toContainText('Пришлите задание от преподавателя');
 await expect(page.locator('#page [data-act="intake-materials"]')).toHaveText('Отправить задание');
 await expect(page.locator('#fab')).toHaveAttribute('data-act','intake-materials');await expect(page.locator('#fab')).toContainText('Отправить задание');
 await expect(page.locator('#page')).not.toContainText('Новая работа');
 await page.getByRole('button',{name:'Вести работу самостоятельно'}).click();
 const kinds=await page.locator('#nType option').allTextContents();
 expect(kinds.slice(0,2)).toEqual(['Практические задания','Лабораторная работа']);expect(kinds).toContain('Курсовая работа');expect(kinds).toContain('Другое');
});

test('STATE-01 taken R3 request stays neutral and status refresh preserves feedback',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  const w={id:'state-r3',topic:'Проверка состояния',deadline:'2026-11-15',format:{workType:'Практическая работа'},structure:emptyStructure(),req:{id:'state-r3',serverId:'11111111-1111-4111-8111-111111111111',number:1,route:'r3'}};
  D.works=[w];window.stateReads=0;
  Oblako.requestApi=async body=>{
   if(body.action==='student-progress')return {route:'r3',stage:'r3_in_work',openQuestions:0,work:{takenAt:'2026-10-09T09:00:00Z',returnedAt:null,delivered:null,downloadedAt:null,handedAt:null}};
   if(body.action==='assistant-state'){stateReads++;return {job:null};}
   return {question:0};
  };
  go('works',w.id);
 });
 await expect(page.locator('[data-student-progress]')).toContainText('Задание у исполнителя');
 await expect(page.locator('[data-r3-route]')).not.toContainText('Работа выполняется');
 await page.evaluate(()=>{
  r3Forms['state-r3']=true;r3Drafts['state-r3']='Сохранить замечания';
  document.querySelector('[data-r3-route]').innerHTML=r3ReturnForm(work('state-r3'));
 });
 const remarks=page.locator('[data-r3-comment]');
 await remarks.fill('Замечания ещё не отправлены');await remarks.focus();
 await page.evaluate(()=>refreshStudentProgress());
 await expect.poll(()=>page.evaluate(()=>stateReads)).toBeGreaterThan(1);
 await expect(remarks).toHaveValue('Замечания ещё не отправлены');await expect(remarks).toBeFocused();
});

test('STATE-02 a delayed former account response cannot repaint another request',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  const w={id:'owner-r3',topic:'Проверка доступа',format:{},structure:emptyStructure(),req:{serverId:'11111111-1111-4111-8111-111111111111',number:1,route:'r3'}};
  D.works=[w];window.testOwner='old-account';Oblako.identity=()=>testOwner;
  Oblako.requestApi=body=>body.action==='student-progress'?new Promise(resolve=>window.finishOldRead=resolve):Promise.resolve({job:null,question:0});
  go('works',w.id);
 });
 await page.evaluate(()=>{testOwner='new-account';go('today');finishOldRead({route:'r3',stage:'r3_ready',result:{name:'old-private.docx',size:10,at:'2026-10-09T10:00:00Z'}});});
 await expect(page.locator('#page')).not.toContainText('old-private.docx');
 expect(await page.evaluate(()=>r3Last['owner-r3']?.result)).toBeUndefined();
});

test('UI-04 same-view refresh keeps profile drafts and folds without saving them',async({page})=>{
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>go('more'));
 const name=page.getByRole('textbox',{name:'Фамилия, имя, отчество',exact:true});
 const original=await page.evaluate(()=>D.settings.name);
 await name.fill('Ещё не сохранено');await name.focus();
 await page.evaluate(()=>{document.querySelectorAll('.profile-fold')[1].open=true;render();});
 await expect(name).toHaveValue('Ещё не сохранено');await expect(name).toBeFocused();
 expect(await page.evaluate(()=>D.settings.name)).toBe(original);
 expect(await page.locator('.profile-fold').nth(1).evaluate(el=>el.open)).toBe(true);
});
