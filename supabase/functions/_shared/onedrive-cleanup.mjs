import {makeOneDriveJournal} from './onedrive-journal.mjs';
import {recoverOneDriveTempFile} from './onedrive-convert.mjs';

// Server-only recovery operation. A scheduler must obtain a fresh delegated
// token for the same OneDrive before calling this function. No upload occurs.
export async function cleanupPendingOneDrive({db,accessToken,fetcher=fetch}){
 if(typeof accessToken!=='string'||!accessToken||accessToken.length>10000)
  throw Error('GRAPH_TOKEN_UNAVAILABLE');
 const journal=makeOneDriveJournal(db);
 const entries=await journal.claimPending();
 let cleared=0,unconfirmed=0;
 for(const entry of entries){
  try{await recoverOneDriveTempFile({entry,accessToken,journal,fetcher});cleared++;}
  catch{unconfirmed++;} // Keep the durable row for another bounded attempt.
 }
 return {claimed:entries.length,cleared,unconfirmed};
}
