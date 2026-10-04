const {test,expect}=require('@playwright/test');
async function setup(page,{restored=false}={}){
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>{
  window.receiptCalls=[];Oblako.mode='cloud';
  Oblako.requestApi=async input=>{
   receiptCalls.push(input.action);
   let state=JSON.parse(localStorage.getItem('receipt-fixture:'+KEY)||'null')||{draft:{id:crypto.randomUUID(),state:'open',revision:1,receiptMode:true},files:[]};
   function save(){localStorage.setItem('receipt-fixture:'+KEY,JSON.stringify(state));}
   if(input.action==='intake-open'){save();return state;}
   if(input.action==='intake-upload'){
    if(window.failReceiptUpload)throw Error('Нет сети');
    if(!state.files.some(f=>f.file_hash===input.fileHash)){state.files.push({id:crypto.randomUUID(),file_name:input.fileName,file_hash:input.fileHash,state:'saved',read_status:'idle',size_bytes:input.sizeBytes});state.draft.revision++;save();}
    return {file:state.files.at(-1)};
   }
   if(input.action==='intake-receive-state')return {submission:state.receipt||{revision:state.draft.revision,files:state.files.length,canReceive:true}};
   if(input.action==='intake-receive'){
    if(!state.receipt){state.receipt={submitted:true,ready:true,id:crypto.randomUUID(),number:8,payload:{route:'received',id:'intake_'+state.draft.id,t:'',n:'',u:'',k:'',d:'',dl:input.deadline,rq:input.description,cn:'student@example.invalid'}};state.writes=(state.writes||0)+1;save();}
    if(window.loseReceiptReply)throw Error('Ответ потерян');return {submission:state.receipt};
   }
   throw Error('Unexpected API: '+input.action);
  };
 });
 await page.evaluate(()=>StudIntake.open({api:Oblako.requestApi,openModal,esc,owner:()=>KEY,identity:Oblako.identity,submitted:s=>{window.lastReceipt=s;}}));
 if(restored)await expect(page.locator('#intakeFiles')).toBeDisabled();
 else await expect(page.locator('#intakeFiles')).toBeEnabled();
}
test('saved files can be sent before reading/AI and server receipt is the only success signal',async({page})=>{
 await setup(page);await page.locator('#intakeFiles').setInputFiles({name:'Материалы.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-unread')});
 await expect(page.locator('[data-intake-receive]')).toBeEnabled();
 await page.locator('[data-intake-receive]').click();await expect(page.locator('[data-intake-status]')).toContainText('Укажите срок');
 expect(await page.evaluate(()=>receiptCalls.includes('intake-receive'))).toBe(false);
 await page.locator('#intakeDeadline').fill('2026-10-30');
 await page.evaluate(()=>{const b=document.querySelector('[data-intake-receive]');b.click();b.click();});
 await expect(page.locator('[data-intake-status]')).toContainText('Заявка №8 принята');
 await expect(page.locator('[data-intake-receive]')).toBeDisabled();await expect(page.locator('#intakeFiles')).toBeDisabled();
 expect(await page.evaluate(()=>receiptCalls.some(a=>['intake-read','intake-analyze','intake-confirmation-save'].includes(a)))).toBe(false);
 expect(await page.evaluate(()=>lastReceipt.payload.t)).toBe('');
 expect(await page.evaluate(()=>receiptCalls.filter(a=>a==='intake-receive').length)).toBe(1);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('receipt-fixture:'+KEY)).writes)).toBe(1);
});
test('pending local file disables sending; retry retains the original, lost reply/reopen restores one receipt',async({page})=>{
 await setup(page);await page.evaluate(()=>window.failReceiptUpload=true);
 await page.locator('#intakeFiles').setInputFiles({name:'Материалы.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-pending')});
 await expect(page.locator('[data-intake-status]')).toContainText('Часть файлов');await expect(page.locator('[data-intake-receive]')).toBeDisabled();
 await page.evaluate(()=>{window.failReceiptUpload=false;window.loseReceiptReply=true;});
 await page.locator('[data-intake-retry]').click();await expect(page.locator('[data-intake-receive]')).toBeEnabled();
 await page.locator('#intakeDeadline').fill('2026-10-30');await page.locator('[data-intake-receive]').click();await expect(page.locator('[data-intake-status]')).toContainText('Заявка №8 принята');
 await setup(page,{restored:true});await expect(page.locator('[data-intake-status]')).toContainText('уже отправлена');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('receipt-fixture:'+KEY)).writes)).toBe(1);
});
test('receipt is displayed in registry with a visible study blocker and original download',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 const result=await page.evaluate(()=>{
  const x=fromPayload({id:'receipt-ui',route:'received',t:'',n:'',u:'',dl:'2026-10-30',cn:'student@example.invalid'});
  D.items=[x];openId=x.id;render();return {topic:x.topic,stage:requestWorkflow(x)};
 });
 expect(result.topic).toContain('тема ещё не изучена');expect(result.stage.title).toBe('Заявка получена');expect(result.stage.blocker).toContain('изучения');expect(result.stage.complete).toBe(false);
});

// UX-01: карточка «Следующее действие» показывает состояние изучения и открывает окно изучения.
test('registry card reflects finished study and opens the study window',async({page})=>{
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>{
  window.cardCalls=[];
  const study={state:'done',manifest:'a'.repeat(64),analysisId:'22222222-2222-4222-8222-222222222222',dialog:[],files:[],result:{fields:{},requirements:[],roles:[]},proposals:[1,2].map(n=>({id:'4444444'+n+'-4444-4444-8444-444444444444',analysis_id:'22222222-2222-4222-8222-222222222222',state:'pending',question:'Вопрос '+n,reason:'Причина '+n,evidence:[]}))};
  Oblako.requestApi=async d=>{cardCalls.push(d.action);if(d.action==='registered-study-state')return {study:structuredClone(study)};throw Error('Unexpected '+d.action);};
  const x=fromPayload({id:'receipt-card',route:'received',t:'',n:'',u:'',dl:'2026-10-30',cn:'student@example.invalid'});x.requestNumber=2;
  D.items=[x];openId=x.id;render();
 });
 const button=page.locator('.request-action [data-act="registered-study"]');
 await expect(button).toHaveText('Решить вопросы (2)');
 await expect(page.locator('.request-action')).toContainText('Нужно решить вопросы по комплекту');
 await expect(page.locator('.request-action')).not.toContainText('Показать материалы');
 await button.click();
 await expect(page.getByRole('dialog')).toContainText('Нужно ваше решение по 2 вопросам');
 await expect(page.locator('[data-proposal-publish]')).toHaveCount(2);
});
