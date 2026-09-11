// Internal server process, not a public HTTP endpoint.
// A deployment adapter must verify ownership and budget before Jobs.start().
import {Jobs,tick} from './durable-jobs.mjs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export async function run({jobs,provider,signal,pollMs=1000,onError=()=>{}}) {
 while(!signal.aborted) {
   try {
     if(await tick(jobs,provider))continue;
   } catch {
     // Do not log provider exception text: it can contain request material or credentials.
     onError({code:'HANDLER_ERROR'});
   }
   try {await delay(pollMs,undefined,{signal});}catch {break;}
 }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const [database,adapterPath]=process.argv.slice(2);
 if(!database||!adapterPath)throw Error('Usage: node server/run-jobs.mjs PERSISTENT_DB SERVER_PROVIDER_ADAPTER');
 const adapter=await import(pathToFileURL(resolve(adapterPath)).href);
 if(typeof adapter.provider!=='function')throw Error('Adapter must export provider; implicit paid provider is disabled');
 const controller=new AbortController();
 process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
 const jobs=new Jobs(database);
 try {await run({jobs,provider:adapter.provider,signal:controller.signal,onError:e=>console.error(e.code)});}
 finally {jobs.close();}
}
