const {test,expect}=require('@playwright/test');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs/promises');
const {createHash,randomUUID}=require('node:crypto');
const base='http://127.0.0.1:4174/';
const requestId=randomUUID();
function sql(query){
 if(!/^postgres(?:ql)?:\/\/[^/]+@(localhost|127\.0\.0\.1):\d+\//.test(process.env.DB_URL||''))throw Error('Refusing non-local database');
 return execFileSync('psql',[process.env.DB_URL,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
}
async function session(email){
 const r=await fetch(process.env.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:'Test-only-29!safe'})});
 if(!r.ok)throw Error('Test Auth rejected session');return r.json();
}
async function screen(browser,file,auth){
 const context=await browser.newContext({serviceWorkers:'block'});
 const page=await context.newPage();
 // Real Auth session bootstrap, not a mocked SDK or API. Login UX is a separate test.
 await page.addInitScript(({auth,key})=>{localStorage.setItem(key,JSON.stringify(auth));},{auth,key:'oblako-'+(file==='reestr.html'?'reestr':'kabinet')});
 await page.goto(base+file);
 await expect.poll(()=>page.evaluate(()=>Oblako.email)).toBe(auth.user.email);
 expect(await page.evaluate(()=>typeof QA)).toBe('undefined');
 return page;
}
async function ready(page,text){await expect(page.locator('#workflowPanel')).toContainText(text);}
async function click(page,name,expectedStatus=200){
 const button=page.getByRole('button',{name,exact:true}),handle=await button.elementHandle();
 const action=await button.getAttribute('data-workflow-action');
 if(action==='passport-open'){await button.click();return;}
 if(action==='review-download'){
  await button.click();await expect.poll(()=>handle.evaluate(el=>el.isConnected)).toBe(false);return;
 }
 const response=page.waitForResponse(r=>r.url().includes('/functions/v1/studkab-workflow')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action!=='get_snapshot');
 await button.click();const result=await response;
 expect(result.status(),action+': '+await result.text()).toBe(expectedStatus);
 if(result.ok()){
  await expect.poll(()=>handle.evaluate(el=>el.isConnected)).toBe(false);
  await expect(page.locator('#workflowPanel')).not.toContainText('Загружаем состояние заявки');
 }
 else await expect(button).toBeEnabled();
}
test('real screens + Auth + Edge + RLS + Storage: materials, passport, rework, delivery',async({browser})=>{
 const studentAuth=await session('student.workflow@example.test'),executorAuth=await session('other.workflow@example.test');
 sql(`insert into studkab_requests(id,student_id,client_id,payload) values('${requestId}','${studentAuth.user.id}','live-screen-test','{"id":"live-screen-test","t":"Тестовый черновик","cn":"test"}')`);
 const student=await screen(browser,'index.html',studentAuth),executor=await screen(browser,'reestr.html',executorAuth);
 // Only initial local work/draft are fixtures. Every workflow operation uses the production client and real server.
 await student.evaluate(id=>{const w={id:'live-work',topic:'Тестовый черновик',format:{},structure:emptyStructure(),tasks:[],req:{serverId:id},status:'draft'};D.works.push(w);tab='works';openWorkId=w.id;render();},requestId);
 await executor.evaluate(id=>{const x=fromPayload({id,t:'Тестовый черновик',n:'Тестовый студент'});x.requestNumber=1;x.doc={order:[{id:'intro',name:'Введение'}],structure:{intro:{text:'Учебный пример для технической проверки передачи документа. Не является курсовой работой.'}}};x.doc.review=DraftQuality.stamp(x);D.items.push(x);openId=id;tab='list';render();},requestId);
 await ready(student,'Заявка получена');await ready(executor,'Заявка получена');
 await student.locator('[data-workflow-file]').setInputFiles({name:'materials.txt',mimeType:'text/plain',buffer:Buffer.from('Учебные материалы для сквозного теста.')});
 await click(student,'Загрузить файл');await ready(student,'materials.txt · проверен');
 await click(executor,'Начать проверку материалов');await ready(executor,'Проверяются материалы');
 await executor.locator('[data-workflow-question]').fill('Уточните период исследования');await click(executor,'Отправить вопрос');
 await student.evaluate(()=>WorkflowUI.paint());await ready(student,'Уточните период исследования');
 await student.locator('[data-workflow-answer]').fill('2024–2025');await click(student,'Отправить ответ');
 await executor.evaluate(()=>WorkflowUI.paint());await ready(executor,'Проверяются материалы');
 await click(executor,'Создать паспорт');await executor.locator('[data-workflow-passport-confirm]').check();await click(executor,'Сохранить новую версию');
 await click(executor,'Утвердить паспорт');await ready(executor,'Требования утверждены');
 await click(executor,'Начать подготовку');await click(executor,'Зарегистрировать текущий Word для проверки');await ready(executor,'Проверяется документ');
 await click(executor,'Подтвердить готовность',422);await expect(executor.locator('#toast')).toContainText('Не завершены обязательные проверки');
 await click(executor,'Вернуть на доработку');await click(executor,'Вернуть в подготовку');
 await executor.evaluate(id=>{const x=item(id);x.doc.structure.intro.text+=' Исправленная версия два.';x.doc.review=DraftQuality.stamp(x);},requestId);
 await click(executor,'Зарегистрировать исправленный Word для проверки');await ready(executor,'Проверяется документ');
 const reviewDownload=executor.waitForEvent('download');await click(executor,'Скачать Word для проверки');
 const reviewed=await fs.readFile(await (await reviewDownload).path());
 await click(executor,'Запустить автопроверку');
 await expect.poll(()=>executor.locator('[data-workflow-check]').count()).toBeGreaterThan(0);
 for(const select of await executor.locator('[data-workflow-check]').all())await select.selectOption('pass');
 for(const input of await executor.locator('[data-workflow-comment]').all())await input.fill('Синтетическая отметка теста; не подтверждает содержательную или ручную приёмку Word.');
 await click(executor,'Сохранить ручную проверку');await click(executor,'Подтвердить готовность');await ready(executor,'Готов к передаче');
 await student.evaluate(()=>WorkflowUI.paint());await expect(student.getByRole('button',{name:'Скачать Word',exact:true})).toHaveCount(0);
 await executor.screenshot({path:'test-results/live-executor-approved.png',fullPage:true});
 await click(executor,'Передать студенту');await ready(executor,'Черновик передан');
 await student.evaluate(()=>WorkflowUI.paint());const download=student.waitForEvent('download');await click(student,'Скачать Word');
 const delivered=await fs.readFile(await (await download).path());expect(delivered.equals(reviewed)).toBe(true);
 await fs.mkdir('test-results/live-evidence',{recursive:true});await fs.writeFile('test-results/live-evidence/delivered.docx',delivered);
 const hash=createHash('sha256').update(delivered).digest('hex');expect(sql(`select d.docx_sha256 from studkab_request_process p join studkab_document_versions d on d.id=p.delivered_document_id where p.request_id='${requestId}'`)).toBe(hash);
 expect(sql(`select count(*) from studkab_document_versions where request_id='${requestId}'`)).toBe('2');
 execFileSync('python3',['-c','import zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile("test-results/live-evidence/delivered.docx"); [E.fromstring(z.read(n)) for n in z.namelist() if n.endswith(".xml")]; assert "Исправленная версия два." in z.read("word/document.xml").decode()']);
 await student.setViewportSize({width:390,height:844});await student.screenshot({path:'test-results/live-student-delivered.png',fullPage:true});
 await fs.writeFile('test-results/live-evidence/summary.json',JSON.stringify({requestId,versions:2,sha256:hash,api:'real isolated Supabase',manualWordAcceptance:false,scope:'Seeded request and draft; no AI calls or production data'},null,2));
});
