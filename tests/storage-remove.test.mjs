// Удаление файла из хранилища: отсутствующий файл не считается сбоем, настоящий сбой останавливает удаление.
import test from 'node:test';import assert from 'node:assert/strict';
import {removeStorageObject} from '../supabase/functions/studkab-requests/storage-remove.mjs';
const reply=(status,body)=>async(url,init)=>{reply.last={url,init};return new Response(body===undefined?null:JSON.stringify(body),{status});};
test('missing file (400 with statusCode 404) and 404 count as already removed',async()=>{
 await removeStorageObject(reply(400,{statusCode:'404',error:'not_found',message:'Object not found'}),'https://x.test','k','b','s/a');
 assert.equal(reply.last.url,'https://x.test/storage/v1/object/b/s/a');assert.equal(reply.last.init.method,'DELETE');
 await removeStorageObject(reply(404,{}),'https://x.test','k','b','s/a');
 await removeStorageObject(reply(200,[{name:'s/a'}]),'https://x.test','k','b','s/a');
});
test('other storage errors stop the deletion',async()=>{
 await assert.rejects(()=>removeStorageObject(reply(400,{statusCode:'400',error:'InvalidKey'}),'https://x.test','k','b','s/a'),/Storage cleanup unavailable/);
 await assert.rejects(()=>removeStorageObject(reply(500,{statusCode:'500'}),'https://x.test','k','b','s/a'),/Storage cleanup unavailable/);
 await assert.rejects(()=>removeStorageObject(reply(403,undefined),'https://x.test','k','b','s/a'),/Storage cleanup unavailable/);
});
