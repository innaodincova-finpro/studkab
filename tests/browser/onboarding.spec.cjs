const {test,expect}=require('@playwright/test');
const base='http://127.0.0.1:4173/';
async function account(page,file='reestr.html'){
 await page.goto(base+file);
 await page.evaluate(()=>QA.switchUser('onboarding'));
 await expect.poll(()=>page.evaluate(()=>Oblako.canSync())).toBe(true);
}
test('invitation contains guide, shares and copies whole message; cancellation is not success',async({page})=>{
 await account(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{Oblako.requestApi=async()=>({url:'https://example.test/activate#token=fixture'});openInvitation(false);Object.defineProperty(navigator,'share',{configurable:true,value:async value=>{window.shared=value;}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value;}}});});
 await page.getByLabel('Почта студента',{exact:true}).fill('student@example.test');
 await page.getByRole('button',{name:'Подготовить приглашение',exact:true}).click();
 const message=page.getByRole('textbox',{name:'Текст приглашения'});
 await expect(message).toBeVisible();
 await page.screenshot({path:'test-results/invitation-mobile.png'});
 const text=await message.inputValue();
 expect(text).toContain('https://example.test/activate#token=fixture');expect(text).toContain('Пароль от почтового ящика');expect(text).toContain('На экран Домой');expect(text).toContain('Профиль');
 await page.getByRole('button',{name:'Скопировать приглашение',exact:true}).click();expect(await page.evaluate(()=>copied)).toBe(text);
 await page.getByRole('button',{name:'Поделиться приглашением',exact:true}).click();expect(await page.evaluate(()=>shared.text)).toBe(text);
 await page.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('cancel','AbortError')}});});
 await page.getByRole('button',{name:'Поделиться приглашением',exact:true}).click();await expect(page.locator('#inviteShareStatus')).toContainText('Отправка отменена');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>QA.switchUser('other'));await expect(message).toHaveCount(0);
});
test('existing account gets sign-in instructions without password reset or activation link',async({page})=>{
 await account(page);await page.evaluate(()=>{Oblako.requestApi=async()=>({existing:true});openInvitation(false);});
 await page.getByLabel('Почта студента',{exact:true}).fill('existing@example.test');await page.getByRole('button',{name:'Подготовить приглашение',exact:true}).click();
 const text=await page.locator('#inviteMessage').inputValue();expect(text).toContain('Новый аккаунт создавать не нужно');expect(text).not.toContain('#token=');expect(text).not.toContain('Придумайте пароль');
});
for(const file of ['index.html','reestr.html'])test(file+': account shows honest live status and confirms visible password before saving',async({page})=>{
 await account(page,file);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{window.passwordCalls=0;Oblako.setPassword=async()=>{passwordCalls++};openCloud();});
 await expect(page.getByRole('heading',{name:'Вы вошли в аккаунт'})).toBeVisible();
 await expect(page.locator('[data-account-auto]')).toContainText('автоматически');await expect(page.locator('[data-account-retry] button')).toHaveCount(0);
 await page.getByText('Способы входа',{exact:true}).click();
 await page.screenshot({path:'test-results/account-'+file+'-mobile.png'});
 await page.getByLabel('Новый пароль',{exact:true}).fill('password123');await page.getByLabel('Повторите пароль',{exact:true}).fill('password124');
 await page.getByRole('button',{name:'Показать пароль: Новый пароль',exact:true}).click();await expect(page.locator('#accountPassword')).toHaveAttribute('type','text');
 await page.getByRole('button',{name:'Сохранить пароль',exact:true}).click();await expect(page.locator('#passwordMsg')).toContainText('Пароли не совпадают');expect(await page.evaluate(()=>passwordCalls)).toBe(0);
 await page.getByLabel('Повторите пароль',{exact:true}).fill('password123');await page.getByRole('button',{name:'Сохранить пароль',exact:true}).click();await expect(page.locator('#passwordMsg')).toContainText('Пароль сохранён');expect(await page.evaluate(()=>passwordCalls)).toBe(1);await expect(page.locator('#accountPassword')).toHaveValue('');
 await page.evaluate(()=>{Oblako.lastError='Нет связи с облаком';CloudUI.paint();});await expect(page.locator('[data-account-status]')).toContainText('Нет связи');await expect(page.locator('[data-account-auto]')).toHaveText('');await expect(page.locator('[data-account-retry] button')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('first-entry mismatch never consumes invitation; both passwords can be viewed',async({page})=>{
 await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'application/javascript',body:`window.verifyCount=0;window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),verifyOtp:async()=>{verifyCount++;return {error:{message:'expired'}}}}})};`}));
 await page.goto(base+'activate.html#token=fixture&email=student%40example.test');await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/activation-mobile.png'});
 await page.getByLabel('Придумайте пароль',{exact:true}).fill('password123');await page.getByLabel('Повторите пароль',{exact:true}).fill('password124');
 for(const label of ['Придумайте пароль','Повторите пароль'])await page.getByRole('button',{name:'Показать пароль: '+label,exact:true}).click();
 await expect(page.locator('#password')).toHaveAttribute('type','text');await expect(page.locator('#repeat')).toHaveAttribute('type','text');
 await page.getByRole('button',{name:'Сохранить пароль и открыть приложение'}).click();await expect(page.locator('#status')).toContainText('Пароли не совпадают');expect(await page.evaluate(()=>verifyCount)).toBe(0);
 await page.getByLabel('Повторите пароль',{exact:true}).fill('password123');await page.getByRole('button',{name:'Сохранить пароль и открыть приложение'}).click();await expect(page.locator('#status')).toContainText('Ссылка истекла');expect(await page.evaluate(()=>verifyCount)).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('unavailable share and clipboard offer a selectable complete message',async({page})=>{
 await account(page);await page.evaluate(()=>{Oblako.requestApi=async()=>({existing:true});openInvitation(false);Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}});});
 await page.getByLabel('Почта студента',{exact:true}).fill('existing@example.test');await page.getByRole('button',{name:'Подготовить приглашение',exact:true}).click();
 await page.getByRole('button',{name:'Поделиться приглашением',exact:true}).click();await expect(page.locator('#inviteShareStatus')).toContainText('Скопировать приглашение');
 await page.getByRole('button',{name:'Скопировать приглашение',exact:true}).click();await expect(page.locator('#inviteShareStatus')).toContainText('Скопируйте выделенный текст');
 expect(await page.locator('#inviteMessage').evaluate(el=>el.selectionEnd-el.selectionStart)).toBe((await page.locator('#inviteMessage').inputValue()).length);
});
