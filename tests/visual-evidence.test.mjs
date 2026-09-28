import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bindVisualEvidence,visualEvidenceCurrent} from '../supabase/functions/_shared/visual-evidence.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=new TextEncoder().encode('synthetic fixture bytes, not a student document');
const picture=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9v8f6CoAAAAASUVORK5CYII=','base64'));
const recipientId='22222222-2222-4222-8222-222222222222';
const version={id:'33333333-3333-4333-8333-333333333333',request_id:'11111111-1111-4111-8111-111111111111',
 recipient_id:recipientId,file_hash:hash(bytes),document_hash:'a'.repeat(64)};
const passport={id:'44444444-4444-4444-8444-444444444444',request_id:version.request_id,
 status:'approved',source_fingerprint:'b'.repeat(64)};
const rendered={sourceSha256:version.file_hash,pdfBytes:new TextEncoder().encode('%PDF-synthetic'),
 converter:'Synthetic renderer',pageCount:2,pages:[{number:1,bytes:picture},{number:2,bytes:picture}]};
const bind=(changes={})=>bindVisualEvidence({wordBytes:bytes,version,passport,recipientId,rendered,...changes});

test('visual bundle records exact Word, passport, recipient and each numbered page',async()=>{
 const evidence=await bind();
 assert.equal(evidence.wordHash,version.file_hash);
 assert.equal(evidence.passportId,passport.id);
 assert.equal(evidence.pages.length,2);
 assert.equal(evidence.pages[0].sha256,hash(picture));
 assert.equal(visualEvidenceCurrent(evidence,version,passport,recipientId),true);
 for(const change of [
  {version:{...version,id:'55555555-5555-4555-8555-555555555555'}},
  {version:{...version,file_hash:'c'.repeat(64)}},
  {passport:{...passport,id:'66666666-6666-4666-8666-666666666666'}},
  {passport:{...passport,source_fingerprint:'c'.repeat(64)}},
  {passport:{...passport,status:'draft'}}
 ])assert.equal(visualEvidenceCurrent(evidence,change.version||version,change.passport||passport,recipientId),false);
 assert.equal(visualEvidenceCurrent(evidence,version,passport,'77777777-7777-4777-8777-777777777777'),false);
});

test('bundle rejects changed source, different recipient and passport before accepting images',async()=>{
 await assert.rejects(bind({wordBytes:new Uint8Array([...bytes,32])}),/VISUAL_SOURCE_MISMATCH/);
 await assert.rejects(bind({rendered:{...rendered,sourceSha256:'f'.repeat(64)}}),/VISUAL_SOURCE_MISMATCH/);
 await assert.rejects(bind({recipientId:'77777777-7777-4777-8777-777777777777'}),/VISUAL_BINDING_STALE/);
 await assert.rejects(bind({passport:{...passport,status:'draft'}}),/VISUAL_BINDING_STALE/);
 await assert.rejects(bind({passport:{...passport,request_id:'77777777-7777-4777-8777-777777777777'}}),/VISUAL_BINDING_STALE/);
});

test('bundle rejects missing, misordered, malformed or oversized pages',async()=>{
 for(const bad of [
  {...rendered,pages:rendered.pages.slice(0,1)},
  {...rendered,pages:[rendered.pages[1],rendered.pages[0]]},
  {...rendered,pages:[rendered.pages[0],{number:2,bytes:new Uint8Array([1,2,3])}]},
  {...rendered,pageCount:201},
  {...rendered,pdfBytes:new TextEncoder().encode('fake-pdf')}
 ])await assert.rejects(bind({rendered:bad}),/VISUAL_PAGES_INCOMPLETE|VISUAL_PDF_INVALID/);
});
