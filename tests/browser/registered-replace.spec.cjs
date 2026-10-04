const {test,expect}=require('@playwright/test');
// KIT-03: замена файла в принятой заявке через окно «Материалы заявки».
async function open(page,state){
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(async state=>{
  D.works=[{id:'replace-work',topic:'Курсовая',format:{},req:{id:'local-request',serverId:'11111111-1111-4111-8111-111111111111',number:2}}];
  window.replaceCalls=[];
  window.replaceFiles=[{id:'33333333-3333-4333-8333-333333333333',file_name:'03_Данные.docx',category:'unclassified',file_hash:'a'.repeat(64),intake:true}];
  window.replaceState={state,requestRevision:4,cycleId:null,reason:null,canUpload:state!=='locked',canReopen:false,canComplete:false,blockingReason:state==='locked'?'Изменения закрыты':null};
  Oblako.requestApi=async body=>{
   replaceCalls.push(body);
   if(body.action==='material-revision-state')return {materials:{...replaceState}};
   if(body.action==='attachment-list')return {attachments:replaceFiles.map(x=>({...x}))};
   if(body.action==='registered-replace'){
    replaceFiles=replaceFiles.filter(x=>x.id!==body.attachmentId).concat({id:'44444444-4444-4444-8444-444444444444',file_name:body.fileName,category:'unclassified',file_hash:body.fileHash,intake:true,supersedes:body.attachmentId,created_at:'2026-10-04T03:24:44Z'});
    replaceState.requestRevision++;return {attachment:{id:'44444444-4444-4444-8444-444444444444',supersedes:body.attachmentId}};
   }
   throw Error('Unexpected '+body.action);
  };
  await openStudentMaterials('replace-work');
 },state);
}
test('KIT-03 student replaces a file of the received request; old version is not shown as current',async({page})=>{
 await open(page,'initial');
 await expect(page.getByRole('dialog')).toContainText('Заменить файл');
 await expect(page.getByRole('dialog')).not.toContainText('откройте «Отправить заявку»');
 await page.locator('[data-intake-replace-file]').setInputFiles({name:'03_Данные_v2.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from([80,75,3,4,9,9])});
 await expect(page.locator('[data-intake-replace-status]')).toContainText('загружен вместо прежнего');
 await expect(page.locator('[data-intake-replace-list]')).toContainText('новая редакция загружена 4 октября');
 await expect(page.locator('[data-material-files]')).toContainText('03_Данные_v2.docx');
 await expect(page.locator('[data-material-files]')).not.toContainText('03_Данные.docx');
 const call=await page.evaluate(()=>replaceCalls.find(x=>x.action==='registered-replace'));
 expect(call.attachmentId).toBe('33333333-3333-4333-8333-333333333333');expect(call.sizeBytes).toBe(6);expect(call.fileHash).toMatch(/^[a-f0-9]{64}$/);
});
test('KIT-03 wrong format is refused before any request; closed materials show no replace control',async({page})=>{
 await open(page,'initial');
 await page.locator('[data-intake-replace-file]').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('x')});
 await expect(page.locator('[data-intake-replace-status]')).toContainText('Разрешены только DOCX, PDF и XLSX');
 expect(await page.evaluate(()=>replaceCalls.filter(x=>x.action==='registered-replace').length)).toBe(0);
 await page.locator('.sheet [data-x]').click();
 await open(page,'locked');
 await expect(page.locator('[data-intake-replace-file]')).toHaveCount(0);
 await expect(page.getByRole('dialog')).toContainText('Изменения закрыты');
});
