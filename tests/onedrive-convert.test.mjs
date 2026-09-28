import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {convertWordViaOneDrive,recoverOneDriveTempFile} from '../supabase/functions/_shared/onedrive-convert.mjs';

const doc=new Uint8Array([80,75,3,4,...Array(30).fill(0)]),expectedHash=createHash('sha256').update(doc).digest('hex');
const pdf=new TextEncoder().encode('%PDF-1.7\nSynthetic PDF fixture');
const metadata={id:'TEST_ITEM'};
function graph({uploadLost=false,lookupMissing=false,conversionFailed=false,deleteFailed=false,sourceChanged=false,journalFailure=false}={}){
 const calls=[];let deleted=false,putCount=0;
 const pending=new Map(),journal={
  async begin(entry){if(journalFailure)throw Error('journal down');pending.set(entry.name,entry);},
  async cleared(entry){pending.delete(entry.name);}
 };
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname,method=options.method;
  calls.push({path,method,query:new URL(url).search,hasToken:options.headers.Authorization==='Bearer test-token'});
  assert.ok(url.startsWith('https://graph.microsoft.com/v1.0/'));
  if(path==='/v1.0/me/drive')return Response.json({id:'TEST_DRIVE'});
  if(method==='PUT'){putCount++;if(uploadLost)throw Error('network response lost');return Response.json(metadata,{status:201});}
  if(path.includes('/permanentDelete')){
   if(deleteFailed)return Response.json({error:'unknown'}, {status:503});
   deleted=true;return new Response(null,{status:204});
  }
  if(path.includes('/root:/'))return deleted||lookupMissing?new Response(null,{status:404}):Response.json(metadata);
  if(path.includes('/items/TEST_ITEM/content')&&!new URL(url).search)
   return new Response(sourceChanged?new Uint8Array([...doc,1]):doc);
  if(path.includes('/items/TEST_ITEM/content')&&new URL(url).search)
   return conversionFailed?new Response(null,{status:500}):new Response(pdf);
  throw Error('Unexpected Graph call');
 };
 return {calls,fetcher,journal,pending,get putCount(){return putCount;},get deleted(){return deleted;}};
}
const run=g=>convertWordViaOneDrive({wordBytes:doc,expectedHash,accessToken:'test-token',fetcher:g.fetcher,journal:g.journal});

test('one upload, source hash check, PDF conversion, permanent deletion and absence check',async()=>{
 const g=graph(),out=await run(g);
 assert.equal(out.sourceSha256,expectedHash);
 assert.deepEqual(out.pdfBytes,pdf);
 assert.equal(g.putCount,1);
 assert.equal(g.deleted,true);
 assert.deepEqual(g.calls.map(c=>c.method),['GET','PUT','GET','GET','POST','GET']);
 assert.ok(g.calls[4].path.endsWith('/permanentDelete'));
 assert.ok(g.calls.every(c=>c.hasToken));
 assert.equal(g.pending.size,0);
});

test('lost upload response searches unique name and deletes found file without retry',async()=>{
 const g=graph({uploadLost:true});
 await assert.rejects(run(g),/GRAPH_RESULT_UNCONFIRMED/);
 assert.equal(g.putCount,1);
 assert.equal(g.deleted,true);
 assert.equal(g.pending.size,0);
 assert.deepEqual(g.calls.map(c=>c.method),['GET','PUT','GET','POST','GET']);
});

test('missing object after uncertain upload remains unresolved instead of claiming deletion',async()=>{
 const g=graph({uploadLost:true,lookupMissing:true});
 await assert.rejects(run(g),/GRAPH_TEMP_FILE_UNCONFIRMED/);
 assert.equal(g.putCount,1);
 assert.equal(g.deleted,false);
 assert.equal(g.pending.size,1);
});

test('conversion error still permanently deletes; deletion error is blocking',async()=>{
 const failed=graph({conversionFailed:true});
 await assert.rejects(run(failed),/GRAPH_CONVERSION_FAILED/);
 assert.equal(failed.deleted,true);
 const blocked=graph({deleteFailed:true});
 await assert.rejects(run(blocked),/GRAPH_TEMP_FILE_UNCONFIRMED/);
 assert.equal(blocked.deleted,false);
 assert.equal(blocked.pending.size,1);
});

test('changed uploaded source blocks PDF use and gets deleted',async()=>{
 const g=graph({sourceChanged:true});
 await assert.rejects(run(g),/GRAPH_UPLOADED_WORD_MISMATCH/);
 assert.equal(g.deleted,true);
 assert.equal(g.calls.some(c=>c.query==='?format=pdf'),false);
});

test('wrong source hash never contacts Microsoft',async()=>{
 const g=graph();
 await assert.rejects(convertWordViaOneDrive({wordBytes:doc,expectedHash:'a'.repeat(64),accessToken:'test-token',fetcher:g.fetcher,journal:g.journal}),/GRAPH_WORD_STALE/);
 assert.equal(g.calls.length,0);
});

test('journal must commit before upload and an unavailable journal prevents writing',async()=>{
 const g=graph({journalFailure:true});
 await assert.rejects(run(g),/GRAPH_JOURNAL_UNAVAILABLE/);
 assert.equal(g.putCount,0);
 assert.equal(g.pending.size,0);
});

test('recovery deletes an item left pending after process interruption',async()=>{
 const g=graph({deleteFailed:true});
 await assert.rejects(run(g),/GRAPH_TEMP_FILE_UNCONFIRMED/);
 assert.equal(g.pending.size,1);
 const entry=[...g.pending.values()][0];
 const recovered=graph();
 recovered.pending.set(entry.name,entry);
 assert.deepEqual(await recoverOneDriveTempFile({entry,accessToken:'test-token',journal:recovered.journal,fetcher:recovered.fetcher}),{cleared:true});
 assert.equal(recovered.pending.size,0);
 assert.equal(recovered.deleted,true);
 assert.equal(recovered.putCount,0);
});

test('failed recovery retains the pending record and never repeats upload',async()=>{
 const g=graph({deleteFailed:true});
 await assert.rejects(run(g),/GRAPH_TEMP_FILE_UNCONFIRMED/);
 const entry=[...g.pending.values()][0];
 await assert.rejects(recoverOneDriveTempFile({entry,accessToken:'test-token',journal:g.journal,fetcher:g.fetcher}),/GRAPH_TEMP_FILE_UNCONFIRMED/);
 assert.equal(g.pending.size,1);
 assert.equal(g.putCount,1);
});
