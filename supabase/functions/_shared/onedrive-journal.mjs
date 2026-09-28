// Service-role REST adapter. The OAuth token and document bytes never enter
// the journal. db(path, body, method) must fail closed on non-2xx responses.
const sha=/^[a-f0-9]{64}$/;
const namePattern=/^studkab-[a-f0-9-]{36}\.docx$/i;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function makeOneDriveJournal(db){
 if(typeof db!=='function')throw Error('GRAPH_JOURNAL_UNAVAILABLE');
 return {
  async begin({driveId,name,sourceSha256}){
   if(typeof driveId!=='string'||!driveId||driveId.length>200||
    !namePattern.test(name||'')||!sha.test(sourceSha256||''))throw Error('GRAPH_INPUT_INVALID');
   let rows;
   try{rows=await db('studkab_graph_temp_files?select=id,drive_id,file_name,state',
    {drive_id:driveId,file_name:name,source_sha256:sourceSha256},'POST');}
   catch{throw Error('GRAPH_JOURNAL_UNAVAILABLE');}
   if(!Array.isArray(rows)||rows.length!==1||rows[0].drive_id!==driveId||
    rows[0].file_name!==name||rows[0].state!=='pending')throw Error('GRAPH_JOURNAL_UNAVAILABLE');
  },
  async cleared({driveId,name,claimToken}){
   if(typeof driveId!=='string'||!driveId||driveId.length>200||!namePattern.test(name||'')||
    (claimToken!==undefined&&!uuid.test(claimToken)))throw Error('GRAPH_INPUT_INVALID');
   const filter=claimToken?'claim_token=eq.'+claimToken:'claim_token=is.null';
   let rows;
   try{rows=await db('studkab_graph_temp_files?drive_id=eq.'+encodeURIComponent(driveId)+
    '&file_name=eq.'+encodeURIComponent(name)+'&state=eq.pending&'+filter+'&select=id,state',
    {state:'cleared',cleared_at:new Date().toISOString(),claim_token:null,lease_until:null},'PATCH');}
   catch{throw Error('GRAPH_JOURNAL_UNAVAILABLE');}
   if(!Array.isArray(rows)||rows.length!==1||rows[0].state!=='cleared')throw Error('GRAPH_JOURNAL_UNAVAILABLE');
  },
  async claimPending(){
   let rows;
   try{rows=await db('rpc/studkab_graph_claim_cleanup',{},'POST');}
   catch{throw Error('GRAPH_JOURNAL_UNAVAILABLE');}
   if(!Array.isArray(rows)||rows.length>10||rows.some(r=>
    typeof r.drive_id!=='string'||!r.drive_id||!namePattern.test(r.file_name||'')||
    !sha.test(r.source_sha256||'')||!uuid.test(r.claim_token||'')||r.state!=='pending'))
    throw Error('GRAPH_JOURNAL_UNAVAILABLE');
   return rows.map(r=>({driveId:r.drive_id,name:r.file_name,sourceSha256:r.source_sha256,claimToken:r.claim_token}));
  }
 };
}
