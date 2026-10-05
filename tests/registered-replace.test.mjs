import test from 'node:test';import assert from 'node:assert/strict';
import {registeredReplaceAction,registeredAddAction} from '../supabase/functions/studkab-requests/registered-replace.mjs';
const user={id:'11111111-1111-4111-8111-111111111111'},request='22222222-2222-4222-8222-222222222222',attachment='33333333-3333-4333-8333-333333333333',file='44444444-4444-4444-8444-444444444444';
const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
async function payload(){const bytes=new Uint8Array([80,75,3,4,1,2,3]);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');return {action:'registered-replace',id:request,attachmentId:attachment,fileName:'Данные v2.docx',contentType:DOCX,sizeBytes:bytes.length,fileHash:hash,base64:Buffer.from(bytes).toString('base64')};}
function deps(over={}){const calls=[],saved=[];return {calls,saved,isMember:async()=>true,saveIntake:async(...a)=>{saved.push(a);},
 db:async(path,method,args)=>{calls.push(path);if(path==='rpc/studkab_registered_replace_reserve')return over.reserve?over.reserve(args):{file:{id:file,file_hash:args.p_hash,state:'pending',storage_path:user.id+'/draft/'+file}};
  if(path==='rpc/studkab_registered_replace_finish')return over.finish?over.finish(args):{attachment:{id:file,supersedes:attachment},duplicate:false};throw Error('unexpected '+path);},...over};}
test('KIT-03: замена сохраняет байты один раз и ставит новый файл вместо прежнего',async()=>{
 const d=deps(),r=await registeredReplaceAction(await payload(),user,d);
 assert.equal(r.data.attachment.supersedes,attachment);assert.equal(d.saved.length,1);assert.deepEqual(d.calls,['rpc/studkab_registered_replace_reserve','rpc/studkab_registered_replace_finish']);
 // Повтор после потерянного ответа: байты уже сохранены, повторно не пишутся.
 const again=deps({reserve:a=>({file:{id:file,file_hash:a.p_hash,state:'saved',storage_path:user.id+'/draft/'+file},duplicate:true}),finish:()=>({attachment:{id:file,supersedes:attachment},duplicate:true})});
 assert.equal((await registeredReplaceAction(await payload(),user,again)).data.duplicate,true);assert.equal(again.saved.length,0);
});
test('KIT-03: закрытые материалы, чужой доступ, неверный файл и подмена пути отклоняются до записи',async()=>{
 const locked=deps({reserve:()=>({locked:true,reason:'Изменения материалов закрыты'})});
 assert.equal((await registeredReplaceAction(await payload(),user,locked)).status,409);assert.equal(locked.saved.length,0);
 assert.equal((await registeredReplaceAction(await payload(),user,deps({isMember:async()=>false}))).status,403);
 const bad=await payload();bad.fileName='x.exe';assert.equal((await registeredReplaceAction(bad,user,deps())).status,400);
 const wrong=await payload();wrong.fileHash='0'.repeat(64);assert.equal((await registeredReplaceAction(wrong,user,deps())).status,400);
 const noId=await payload();noId.attachmentId='x';assert.equal((await registeredReplaceAction(noId,user,deps())).status,400);
 const path=deps({reserve:a=>({file:{id:file,file_hash:a.p_hash,state:'pending',storage_path:'someone/draft/'+file}})});
 await assert.rejects(async()=>registeredReplaceAction(await payload(),user,path),/Replace unavailable/);assert.equal(path.saved.length,0);
});
test('UX-01: отказ замены называет точную причину и ничего не записывает',async()=>{
 const cases=[[{same:true},'уже загружен в заявку и стоит на этом месте'],[{conflict:true,kind:'duplicate'},'уже есть в заявке на другом месте'],[{conflict:true,kind:'replaced'},'уже заменён новой редакцией'],[{conflict:true},'уже заменён новой редакцией']];
 for(const [reply,text] of cases){const d=deps({reserve:()=>reply}),r=await registeredReplaceAction(await payload(),user,d);
  assert.equal(r.status,409);assert.match(r.data.error,new RegExp(text));assert.equal(d.saved.length,0);assert.deepEqual(d.calls,['rpc/studkab_registered_replace_reserve']);}
});

function addDeps(over={}){const calls=[],saved=[];return {calls,saved,isMember:async()=>true,saveIntake:async(...a)=>{saved.push(a);},
 db:async(path,method,args)=>{calls.push(path);if(path==='rpc/studkab_registered_add_reserve')return over.reserve?over.reserve(args):{file:{id:file,file_hash:args.p_hash,state:'pending',supersedes:null,storage_path:user.id+'/draft/'+file}};
  if(path==='rpc/studkab_registered_add_finish')return over.finish?over.finish(args):{attachment:{id:file,supersedes:null},duplicate:false};throw Error('unexpected '+path);},...over};}
async function addPayload(){const p=await payload();p.action='registered-add';delete p.attachmentId;return p;}
test('UX-02a: новый файл к ответу сохраняется один раз и встаёт в заявку отдельным файлом',async()=>{
 const d=addDeps(),r=await registeredAddAction(await addPayload(),user,d);
 assert.equal(r.data.attachment.supersedes,null);assert.equal(d.saved.length,1);assert.deepEqual(d.calls,['rpc/studkab_registered_add_reserve','rpc/studkab_registered_add_finish']);
 const again=addDeps({reserve:a=>({file:{id:file,file_hash:a.p_hash,state:'saved',supersedes:null,storage_path:user.id+'/draft/'+file},duplicate:true})});
 const r2=await registeredAddAction(await addPayload(),user,again);assert.equal(r2.data.duplicate,true);assert.equal(again.saved.length,0);assert.deepEqual(again.calls,['rpc/studkab_registered_add_reserve']);
});
test('UX-02a: закрытые материалы, предел файлов, дубликат, чужой доступ и подмена пути отклоняются до записи',async()=>{
 for(const [reply,status,text] of [[{locked:true,reason:'Изменения материалов закрыты'},409,'закрыты'],[{limit:true},409,'20 файлов'],[{conflict:true,kind:'duplicate'},409,'уже есть в заявке'],[{conflict:true,kind:'replaced'},409,'прежняя редакция'],[{quota:true},429,'100 МБ'],[{missing:true},404,'не найдены']]){
  const d=addDeps({reserve:()=>reply}),r=await registeredAddAction(await addPayload(),user,d);assert.equal(r.status,status);assert.match(r.data.error,new RegExp(text));assert.equal(d.saved.length,0);}
 assert.equal((await registeredAddAction(await addPayload(),user,addDeps({isMember:async()=>false}))).status,403);
 const bad=await addPayload();bad.id='x';assert.equal((await registeredAddAction(bad,user,addDeps())).status,400);
 const path=addDeps({reserve:a=>({file:{id:file,file_hash:a.p_hash,state:'pending',supersedes:null,storage_path:'someone/draft/'+file}})});
 await assert.rejects(async()=>registeredAddAction(await addPayload(),user,path),/Add unavailable/);assert.equal(path.saved.length,0);
 const repl=addDeps({reserve:a=>({file:{id:file,file_hash:a.p_hash,state:'pending',supersedes:attachment,storage_path:user.id+'/draft/'+file}})});
 await assert.rejects(async()=>registeredAddAction(await addPayload(),user,repl),/Add unavailable/);
});
