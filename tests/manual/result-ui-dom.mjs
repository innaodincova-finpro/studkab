// Optional isolated DOM verification. Does not replace real browser acceptance.
import {createRequire} from 'node:module';import fs from 'node:fs';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
const require=createRequire(process.env.STUDKAB_TEST_MODULE_ROOT+'/package.json');const {JSDOM}=require('jsdom');
const root=new URL('../../',import.meta.url);const codes=Array.from({length:13},(_,i)=>'C'+String(i+1).padStart(2,'0')).concat(['S01','S02','S03']);
const dom=new JSDOM('<body></body>',{url:'https://local.test',runScripts:'outside-only'}),w=dom.window;
w.TextEncoder=TextEncoder;w.Blob=Blob;w.Uint8Array=Uint8Array;w.DataView=DataView;Object.defineProperty(w,'crypto',{value:webcrypto});
let identity='test',calls=[],downloads=[],failure=true;w.D={};w.esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');w.toast=s=>{w.document.body.dataset.toast=s;};
w.openModal=html=>{const el=w.document.createElement('div');el.innerHTML=html;w.document.body.append(el);return el;};
w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
w.eval(fs.readFileSync(new URL('result-docx.js',root),'utf8'));w.DraftQuality={issues:()=>[],finAcceptance:()=>({errors:[]}),stamp:x=>JSON.stringify([x.id,x.student,x.doc.structure])};
w.Oblako={identity:()=>identity,requestApi:async body=>{calls.push(body);
 if(body.action==='prepare-result'){const b=Buffer.from(body.docxBase64,'base64');return{versionId:body.versionId,recipientId:'55555555-5555-4555-8555-555555555555',fileHash:Buffer.from(await webcrypto.subtle.digest('SHA-256',b)).toString('hex'),documentHash:'b'.repeat(64)};}
 if(body.action==='review-result')return{reviewId:body.reviewId,versionId:body.versionId};
 if(failure){failure=false;throw Error('Temporary failure');}return{saved:true,deliveryId:body.deliveryId};}};
w.eval(fs.readFileSync(new URL('results-ui.js',root),'utf8'));
const x={id:'11111111-1111-4111-8111-111111111111',requestNumber:1,topic:'Synthetic',student:'Synthetic',doc:{order:[{id:'intro',name:'Introduction'}],structure:{intro:{text:'Synthetic reviewed text'}}}};x.doc.review=w.DraftQuality.stamp(x);
w.StudResults.deliver(x);const $=s=>w.document.querySelector(s),button=$('[data-deliver]');
await button.onclick();assert.equal(calls.length,0);assert.match($('[data-result-status]').textContent,/Проверьте/);
$('[data-preview]').onclick();$('[data-reviewed]').checked=true;await button.onclick();assert.equal(calls.length,0);assert.match($('[data-result-status]').textContent,/Заполните пункт/);
for(const code of codes)$('[data-criterion="'+code+'"]').value='Synthetic evidence at page 1';
await button.onclick();assert.match($('[data-result-status]').textContent,/Temporary/);assert.deepEqual(calls.map(c=>c.action),['prepare-result','review-result','deliver']);
assert.deepEqual(Buffer.from(await downloads[0].arrayBuffer()),Buffer.from(calls[0].docxBase64,'base64'));
await button.onclick();assert.match($('[data-result-status]').textContent,/доступен студенту/);assert.equal(calls[2].deliveryId,calls[3].deliveryId);assert.equal(calls.filter(c=>c.action==='prepare-result').length,1);
// Changed recipient blocks even with a previously completed review.
x.id='22222222-2222-4222-8222-222222222222';await button.onclick();assert.equal(calls.length,4);assert.match($('[data-result-status]').textContent,/получатель изменился/);
const binary=calls[0].docxBase64,hash=Buffer.from(await webcrypto.subtle.digest('SHA-256',Buffer.from(binary,'base64'))).toString('hex');
w.document.body.innerHTML='';w.Oblako.requestApi=async()=>({result:{version_id:'v',document:{topic:'Synthetic'},created_at:'2026-09-12',docxBase64:binary,fileHash:hash}});
await w.StudResults.receive({req:{serverId:x.id}});assert.equal($('[data-download]').hidden,false);$('[data-download]').onclick();assert.deepEqual(Buffer.from(await downloads.at(-1).arrayBuffer()),Buffer.from(binary,'base64'));
identity='changed';$('[data-download]').onclick();assert.equal($('[data-download]').hidden,true);
w.document.body.innerHTML='';w.Oblako.requestApi=async()=>({result:{version_id:'v',document:{topic:'Synthetic'},created_at:'2026-09-12',docxBase64:binary,fileHash:'0'.repeat(64)}});
await w.StudResults.receive({req:{serverId:x.id}});assert.equal($('[data-download]').hidden,true);assert.match($('[data-result-status]').textContent,/Контрольная сумма/);
console.log('PASS DOM: missing preview/evidence blocked, preview bytes equal upload, retry reuses review/version/delivery, changed recipient/account blocked, exact-byte receive and corrupt hash rejected');w.close();
