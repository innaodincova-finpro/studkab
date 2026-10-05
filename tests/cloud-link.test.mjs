// ROUTE-03, R3-B: проверка ссылки на облако и копия файлов папки Яндекс Диска. Сеть подменена.
import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
import {checkCloudLink,cloudService,downloadYandexFile} from '../supabase/functions/studkab-requests/cloud-link.mjs';
import {schema,student,apiDatabase} from './intake-fixture.mjs';
const LINK='https://disk.yandex.ru/d/Mt7abc';
const PDF=Buffer.from('%PDF-1.4 practice');
function yandex({href='https://downloader.disk.yandex.ru/disk/a',status=200,body=PDF}={}){
 const calls=[];
 const fetcher=async(url,init={})=>{calls.push(url);const u=new URL(url);
  if(u.hostname==='cloud-api.yandex.net'&&u.pathname.endsWith('/download')){
   assert.equal(u.searchParams.get('public_key'),LINK);return new Response(JSON.stringify({href:href+'?path='+encodeURIComponent(u.searchParams.get('path'))}),{status:200});}
  if(u.hostname==='cloud-api.yandex.net'){
   assert.equal(u.searchParams.get('public_key'),LINK);assert.equal(init.redirect,'error');
   if(status!==200)return new Response('{}',{status});
   return new Response(JSON.stringify({type:'dir',_embedded:{total:5,items:[
    {type:'file',name:'Практика1.pdf',path:'/Практика1.pdf',size:PDF.length,mime_type:'application/pdf'},
    {type:'file',name:'Страница.jpg',path:'/Страница.jpg',size:4000,mime_type:'image/jpeg'},
    {type:'file',name:'Большой.pdf',path:'/Большой.pdf',size:6000000,mime_type:'application/pdf'},
    {type:'file',name:'Заметки.txt',path:'/Заметки.txt',size:20,mime_type:'text/plain'},
    {type:'dir',name:'Старое',path:'/Старое'}]}}),{status:200});}
  if(u.hostname.endsWith('yandex.ru')||u.hostname.endsWith('yandex.net')){
   const name=u.searchParams.get('path');return new Response(name==='/Заметки.txt'?'notes':body,{status:200});}
  throw Error('unexpected host '+u.hostname);
 };
 return {fetcher,calls};
}
test('R3-B: only listed clouds are recognised; Google login redirect means closed; Mail.ru 404 means missing',async()=>{
 assert.equal(cloudService('https://evil.example/d/x'),null);assert.equal(cloudService('http://disk.yandex.ru/d/x'),null);
 assert.equal(cloudService('https://yadi.sk/d/x'),'yandex');assert.equal(cloudService('https://drive.google.com/drive/folders/x'),'google');assert.equal(cloudService('https://cloud.mail.ru/public/x/y'),'mailru');
 assert.deepEqual(await checkCloudLink('https://evil.example/x',{fetcher:async()=>{throw Error('no network call');}}),{state:'invalid'});
 const google=async(url,init)=>{assert.equal(init.redirect,'manual');return new Response('',{status:302,headers:{location:'https://accounts.google.com/ServiceLogin?continue=x'}});};
 assert.equal((await checkCloudLink('https://drive.google.com/drive/folders/x',{fetcher:google})).state,'closed');
 assert.equal((await checkCloudLink('https://drive.google.com/drive/folders/x',{fetcher:async()=>new Response('ok',{status:200})})).state,'open');
 assert.equal((await checkCloudLink('https://cloud.mail.ru/public/x/y',{fetcher:async()=>new Response('',{status:404})})).state,'missing');
 assert.equal((await checkCloudLink('https://cloud.mail.ru/public/x/y',{fetcher:async()=>{throw Error('timeout');}})).state,'unknown');
 for(const [status,state] of [[404,'missing'],[403,'closed'],[500,'unknown']])assert.equal((await checkCloudLink(LINK,{fetcher:yandex({status}).fetcher})).state,state);
 const open=await checkCloudLink(LINK,{fetcher:yandex().fetcher});
 assert.equal(open.state,'open');assert.equal(open.files.length,4);assert.equal(open.folders,1);
});
test('R3-B: a download address outside Yandex is refused; oversize file is refused before download',async()=>{
 await assert.rejects(()=>downloadYandexFile(LINK,'/Практика1.pdf',{fetcher:yandex({href:'https://evil.example/steal'}).fetcher}),/неподходящий адрес/);
 const y=yandex();await assert.rejects(()=>downloadYandexFile(LINK,'/Большой.pdf',{fetcher:y.fetcher}),/больше 5 МБ/);
 assert.ok(!y.calls.some(u=>u.startsWith('https://downloader')));
 await assert.rejects(()=>downloadYandexFile(LINK,'/Нет такого.pdf',{fetcher:yandex().fetcher}),/не найден/);
 const got=await downloadYandexFile(LINK,'/Практика1.pdf',{fetcher:yandex().fetcher});assert.equal(got.name,'Практика1.pdf');assert.deepEqual(Buffer.from(got.bytes),PDF);
});
test('R3-B: student checks the link and copies Yandex files into the draft one by one; repeats do not duplicate',async()=>{
 const db=new PGlite();await db.exec(schema());await db.exec('set role service_role');
 try{
  const objects=new Map(),y=yandex();
  const app=handler({db:apiDatabase(db),isMember:async()=>true,auth:async()=>({id:student,email:'student@example.test',email_confirmed_at:'2026-01-01'}),
   saveIntake:async(path,type,bytes)=>{objects.set(path,{type,bytes});},fetchCloud:y.fetcher,send:async()=>{throw Error('no notification');}});
  const call=async body=>{const r=await app(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(body)}));return {status:r.status,...await r.json()};};
  const {draft}=await call({action:'intake-open'});
  assert.equal((await call({action:'intake-link-check',id:draft.id,link:'https://evil.example/x'})).status,400);
  const checked=await call({action:'intake-link-check',id:draft.id,link:LINK});assert.equal(checked.link.state,'open');assert.equal(checked.link.files.length,4);
  const copied=await call({action:'intake-link-copy',id:draft.id,link:LINK,path:'/Практика1.pdf'});
  assert.equal(copied.status,200);assert.equal(copied.file.state,'saved');assert.equal(copied.file.file_name,'Практика1.pdf');assert.equal(copied.file.content_type,'application/pdf');
  assert.equal((await call({action:'intake-link-copy',id:draft.id,link:LINK,path:'/Практика1.pdf'})).duplicate,true);
  for(const [path,why] of [['/Большой.pdf',/больше 5 МБ/],['/Заметки.txt',/не принимается/]]){const r=await call({action:'intake-link-copy',id:draft.id,link:LINK,path});assert.equal(r.status,409);assert.match(r.error,why);}
  assert.equal((await call({action:'intake-link-copy',id:draft.id,link:'https://drive.google.com/drive/folders/x',path:'/a.pdf'})).status,400);
  assert.equal((await call({action:'intake-open'})).files.length,1);assert.equal(objects.size,1);
 }finally{await db.close();}
});
