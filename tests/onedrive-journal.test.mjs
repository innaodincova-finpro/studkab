import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {makeOneDriveJournal} from '../supabase/functions/_shared/onedrive-journal.mjs';
import {cleanupPendingOneDrive} from '../supabase/functions/_shared/onedrive-cleanup.mjs';

const name=`studkab-${randomUUID()}.docx`,hash='a'.repeat(64);

test('journal persists before upload, claims only old rows and hides them from clients',async()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20260928123227_c168_onedrive_temp_journal.sql',import.meta.url),'utf8');
 const pg=new PGlite();
 try{
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  await pg.exec(sql);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on public\.studkab_graph_temp_files from public,anon,authenticated/);
  await pg.query('insert into studkab_graph_temp_files(drive_id,file_name,source_sha256) values($1,$2,$3)', ['drive',name,hash]);
  assert.equal((await pg.query('select count(*)::int n from studkab_graph_claim_cleanup()')).rows[0].n,0);
  await pg.query("update studkab_graph_temp_files set created_at=now()-interval '11 minutes' where file_name=$1",[name]);
  const claimed=(await pg.query('select drive_id,file_name,source_sha256,claim_token,attempts from studkab_graph_claim_cleanup()')).rows;
  assert.equal(claimed.length,1);assert.equal(claimed[0].attempts,1);
  assert.equal((await pg.query('select count(*)::int n from studkab_graph_claim_cleanup()')).rows[0].n,0);
  await pg.exec('set role authenticated;');
  await assert.rejects(pg.query('select * from studkab_graph_temp_files'),/permission denied/);
  await assert.rejects(pg.query('select * from studkab_graph_claim_cleanup()'),/permission denied/);
  await pg.exec('reset role;');
 }finally{await pg.close();}
});

test('journal refuses upload without confirmed insert and clears only the claimed row',async()=>{
 const calls=[],entry={drive_id:'drive',file_name:name,state:'pending',source_sha256:hash,claim_token:randomUUID()};
 const db=async(path,body,method)=>{calls.push({path,body,method});
  if(method==='POST'&&path.startsWith('studkab_graph_temp_files'))return [entry];
  if(path==='rpc/studkab_graph_claim_cleanup')return [entry];
  if(method==='PATCH')return [{state:'cleared'}];
  throw Error('unexpected DB call');};
 const journal=makeOneDriveJournal(db);
 await journal.begin({driveId:'drive',name,sourceSha256:hash});
 assert.equal(calls[0].method,'POST');
 const [claimed]=await journal.claimPending();
 assert.equal(claimed.claimToken,entry.claim_token);
 await journal.cleared({...claimed});
 assert.ok(calls[2].path.includes('claim_token=eq.'+entry.claim_token));
 assert.equal(calls[2].body.state,'cleared');
 const offline=makeOneDriveJournal(async()=>{throw Error('DB down');});
 await assert.rejects(offline.begin({driveId:'drive',name,sourceSha256:hash}),/GRAPH_JOURNAL_UNAVAILABLE/);
 await assert.rejects(makeOneDriveJournal(async()=>[]).cleared({driveId:'drive',name}),/GRAPH_JOURNAL_UNAVAILABLE/);
});

test('recovery never claims a row without an authenticated token and never uploads',async()=>{
 let claims=0,writes=0;
 const db=async(path)=>{if(path==='rpc/studkab_graph_claim_cleanup'){claims++;return [{drive_id:'drive',file_name:name,
  source_sha256:hash,state:'pending',claim_token:randomUUID()}];}throw Error('unexpected journal write');};
 await assert.rejects(cleanupPendingOneDrive({db,accessToken:''}),/GRAPH_TOKEN_UNAVAILABLE/);
 assert.equal(claims,0);
 const result=await cleanupPendingOneDrive({db,accessToken:'test-token',fetcher:async(url,options)=>{
  assert.equal(options.method,'GET');writes++;return new Response(null,{status:503});}});
 assert.deepEqual(result,{claimed:1,cleared:0,unconfirmed:1});
 assert.equal(claims,1);assert.equal(writes,1);
});
