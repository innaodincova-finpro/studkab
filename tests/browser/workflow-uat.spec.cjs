const {test,expect}=require('@playwright/test');
// Real DOM, simulated API. Auth/RLS/Storage are exercised separately in integration CI.
async function setup(page,status,hasDocument=true){
 await page.goto('http://127.0.0.1:4173/tests/qa.html');
 await page.evaluate(({status,hasDocument})=>{
  document.body.innerHTML='<main id="workflowPanel" data-role="executor" data-request-id="request"></main><p id="message"></p>';
  window.fixture={process:{status,revision:7,active_document_id:hasDocument?'doc':null,active_passport_id:'passport'},files:[],passports:[{id:'passport',version:1,state:'approved'}],requirements:[{id:'r',passport_id:'passport',code:'DOC-06',rule_text:'Открыть Word',applicability:'applicable',severity:'critical',verification_method:'automatic'}],documents:hasDocument?[{id:'doc',passport_id:'passport',version:1,state:status==='quality_review'?'ready_for_review':'approved'}]:[],criteria:[]};
  window.calls=[];window.toast=t=>document.getElementById('message').textContent=t;
  window.Oblako={workflowApi:async c=>{window.calls.push(c);if(c.action==='get_snapshot')return window.fixture;if(c.action==='transition_request'){window.fixture.process.status=c.payload.nextStatus;window.fixture.process.revision++;return {};}return {};}};
 },{status,hasDocument});
 await page.addScriptTag({url:'http://127.0.0.1:4173/workflow-ui.js'});
 await page.evaluate(()=>WorkflowUI.paint());
}
test('rework offers a new version and never a generic skip to quality review',async({page})=>{
 await setup(page,'quality_review');
 await page.getByRole('button',{name:'Вернуть на доработку',exact:true}).click();
 await page.getByRole('button',{name:'Вернуть в подготовку',exact:true}).click();
 await expect(page.getByRole('button',{name:'Зарегистрировать исправленный Word для проверки',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Передать на контроль',exact:true})).toHaveCount(0);
 const calls=await page.evaluate(()=>calls.filter(c=>c.action==='transition_request'));
 expect(calls.map(c=>c.payload.nextStatus)).toEqual(['changes_required','preparing']);
});
test('approved checklist is read-only but delivery stays available',async({page})=>{
 await setup(page,'ready_to_deliver');
 await expect(page.locator('[data-workflow-check]')).toBeDisabled();
 await expect(page.locator('[data-workflow-comment]')).toBeDisabled();
 await expect(page.getByRole('button',{name:'Сохранить ручную проверку'})).toBeHidden();
 await expect(page.getByRole('button',{name:'Запустить автопроверку'})).toBeHidden();
 await expect(page.getByRole('button',{name:'Передать студенту',exact:true})).toBeVisible();
});
test('older automatic-only Word criterion still offers human confirmation',async({page})=>{
 await setup(page,'quality_review');
 await expect(page.locator('[data-workflow-check]')).toBeEnabled();
 await expect(page.locator('#workflowPanel')).toContainText('автоматически и вручную');
});
test('service outage remains visible and retry recovers the panel',async({page})=>{
 await setup(page,'preparing',false);
 await page.evaluate(()=>{const api=Oblako.workflowApi;let once=true;Oblako.workflowApi=async c=>{if(once){once=false;throw Object.assign(Error('Сервис временно недоступен'),{status:503});}return api(c);};});
 await page.evaluate(()=>WorkflowUI.paint());
 await expect(page.locator('#workflowPanel')).toContainText('Сервис временно недоступен');
 await page.getByRole('button',{name:'Повторить',exact:true}).click();
 await expect(page.getByRole('button',{name:'Зарегистрировать текущий Word для проверки',exact:true})).toBeVisible();
});
