import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {schema,student,other,apiDatabase} from './intake-fixture.mjs';
import {distribute} from '../supabase/functions/_shared/intake-analysis.mjs';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
import {intakeAction} from '../supabase/functions/studkab-requests/intake.mjs';
async function fixture(questions=false){
 const db=new PGlite();await db.exec(schema());await db.exec('set role service_role');const api=apiDatabase(db),rpc=(name,args)=>api('rpc/studkab_intake_'+name,'POST',args);
 const draft=await rpc('open',{p_student:student});const {file}=await rpc('reserve',{p_student:student,p_draft:draft.id,p_name:'Задание.docx',p_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',p_size:10,p_hash:'a'.repeat(64),p_supersedes:null});await rpc('finish',{p_student:student,p_draft:draft.id,p_file:file.id,p_hash:file.file_hash});
 await db.query("update studkab_intake_files set read_status='ready',read_version='intake-reader-1',read_result=$2 where id=$1",[file.id,{status:'ready',readerVersion:'intake-reader-1',blocks:[]}]);
 const snapshot=await rpc('analysis_snapshot',{p_student:student,p_draft:draft.id});
 const candidates=['t','k','u','n','d',...(questions?[]:['dl'])].map(field=>({field,value:field==='d'?'Менеджмент':'Сведение '+field,condition:'',refs:[]}));
 if(questions)candidates.push({field:'t',value:'Другая тема',condition:'',refs:[]},{field:'formatting',value:'Приложить расчёт',condition:'если финансовая работа',refs:[]},{field:'requirement',value:'Определённый метод',condition:'если есть данные',refs:[]});
 const result=distribute([{candidates,roles:[]}]);const job=(await db.query("insert into studkab_intake_analysis_jobs(draft_id,manifest,version,plan,state,result) values($1,$2,'intake-analysis-1','[{}]','done',$3) returning id",[draft.id,snapshot.manifest,result])).rows[0];
 const state=(who=student)=>rpc('confirmation_state',{p_student:who,p_draft:draft.id});
 const save=(answers={},revision=0,confirm=false,who=student,analysis=job.id)=>rpc('confirmation_save',{p_student:who,p_draft:draft.id,p_analysis:analysis,p_revision:revision,p_answers:answers,p_confirm:confirm});
 return {db,api,rpc,draft,job,file,result,state,save,snapshot};
}
test('known document facts need no retyping; confirmation survives lost reply with one immutable revision and no request',async()=>{
 const f=await fixture();try{const initial=await f.state();assert.equal(initial.state,'editing');assert.ok(Object.values(initial.rules).every(r=>!r.required));
 const a=await f.save({},0,true),b=await f.save({},0,true);assert.equal(a.state,'confirmed');assert.equal(a.revision,b.revision);assert.equal(a.analysisId,f.job.id);assert.equal(a.manifest,f.snapshot.manifest);assert.equal((await f.db.query('select count(*) n from studkab_intake_confirmations')).rows[0].n,1);
 assert.equal((await f.rpc('analysis_snapshot',{p_student:student,p_draft:f.draft.id})).manifest,f.snapshot.manifest);assert.equal((await f.state(other)).missing,true);assert.equal((await f.save({},0,true,other)).missing,true);
 assert.equal(await f.db.query("select to_regclass('public.studkab_requests') requests").then(r=>r.rows[0].requests),null);
 await assert.rejects(()=>f.db.exec('delete from studkab_intake_confirmations'),/permission denied/);await assert.rejects(()=>f.db.exec("update studkab_intake_confirmations set state='editing'"),/permission denied/);
 }finally{await f.db.close();}
});
test('only important missing facts, conflicts and conditional requirements require answers; unknown remains explicit',async()=>{
 const f=await fixture(true);try{const s=await f.state();assert.deepEqual(Object.keys(s.rules).filter(k=>s.rules[k].required).sort(),['c:formatting:0','c:requirement:0','f:dl','f:t']);assert.equal((await f.save({},0,true)).incomplete,true);
 const answers={'f:t':{type:'candidate',index:1},'f:dl':{type:'unknown'},'c:formatting:0':{type:'not_applies'},'c:requirement:0':{type:'unknown'}};
 const r=await f.save(answers,0,true);assert.equal(r.state,'confirmed');assert.deepEqual(r.answers,answers);assert.equal(r.answers['f:dl'].value,undefined);assert.equal(f.result.fields.dl.values.length,0);
 }finally{await f.db.close();}
});
test('forged keys, references, indices, wrong types, blank/oversized custom values and invalid conditions are refused without history',async()=>{
 const f=await fixture(true);try{for(const answers of [{'f:fake':{type:'unknown'}},{'f:t':{type:'candidate',index:2}},{'f:t':{type:'candidate',index:'0'}},{'f:t':{type:'unknown',value:'invented'}},{'f:t':{type:'custom',value:' '}},{'f:t':{type:'custom',value:'x'.repeat(2001)}},{'f:t':{type:'custom',value:null}},{'c:formatting:0':{type:'candidate',index:0}},[]])assert.equal((await f.save(answers)).invalid,true);
 assert.equal((await f.db.query('select count(*) n from studkab_intake_confirmations')).rows[0].n,0);assert.equal((await f.save({},0,false,student,null)).stale,true);
 }finally{await f.db.close();}
});
test('two different edits cannot overwrite; identical retry deduplicates; editing confirmed card preserves prior versions',async()=>{
 const f=await fixture();try{const a={'f:n':{type:'custom',value:'Уточнённое имя'}};const saved=await f.save(a);assert.equal(saved.revision,1);assert.equal((await f.save(a,0)).revision,1);
 const b={'f:n':{type:'unknown'}};assert.equal((await f.save(b,0)).conflict,true);const confirmed=await f.save(a,1,true);assert.equal(confirmed.revision,2);const edited=await f.save(b,2);assert.equal(edited.state,'editing');assert.equal(edited.revision,3);
 assert.deepEqual((await f.db.query('select state from studkab_intake_confirmations order by revision')).rows.map(r=>r.state),['editing','confirmed','editing']);
 await f.db.exec(`reset role;delete from studkab_members where user_id='${student}';set role service_role`);assert.equal((await f.save(b,3,true)).missing,true);
 }finally{await f.db.close();}
});
test('a pending new original invalidates confirmation, hides prior answers and retains history; new analysis requires fresh revision',async()=>{
 const f=await fixture();try{await f.save({'f:n':{type:'custom',value:'Имя из ответа'}},0,true);
 await f.rpc('reserve',{p_student:student,p_draft:f.draft.id,p_name:'Методичка.pdf',p_type:'application/pdf',p_size:10,p_hash:'b'.repeat(64),p_supersedes:null});const state=await f.state();assert.equal(state.state,'stale');assert.deepEqual(state.answers,{});assert.equal((await f.save({},1,true)).stale,true);
 assert.equal((await f.db.query('select count(*) n from studkab_intake_confirmations')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('Edge actions enforce invitation, ownership, payload bounds and service-only RPC access',async()=>{
 const f=await fixture();try{const deps={db:f.api,isMember:async()=>true},input={action:'intake-confirmation-save',id:f.draft.id,analysisId:f.job.id,revision:0,answers:{},confirm:true};
 assert.equal((await intakeAction(input,{id:student},{...deps,isMember:async()=>false})).status,403);assert.equal((await intakeAction(input,{id:other},deps)).status,404);assert.equal((await intakeAction({...input,answers:[]},{id:student},deps)).status,400);
 assert.equal((await intakeAction(input,{id:student},deps)).data.confirmation.state,'confirmed');
 for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(()=>f.state(),/permission denied/);await assert.rejects(()=>f.save(),/permission denied/);await assert.rejects(()=>f.db.exec('select * from studkab_intake_confirmations'),/permission denied/);}
 }finally{await f.db.close();}
});

test('authenticated request handler routes confirmation before legacy form validation and accepts a bounded full answer set',async()=>{
 const f=await fixture();try{const h=handler({auth:async()=>({id:student,email_confirmed_at:'2026-01-01'}),db:f.api,isMember:async()=>true});
 const answers=Object.fromEntries(Object.keys((await f.state()).rules).map(k=>[k,{type:'custom',value:'x'.repeat(2000)}]));
 const input={action:'intake-confirmation-save',id:f.draft.id,analysisId:f.job.id,revision:0,answers,confirm:true};const body=JSON.stringify(input);assert.ok(body.length>16000);
 const req=auth=>new Request('https://example.test',{method:'POST',headers:auth?{authorization:'Bearer session'}:{},body});assert.equal((await h(req(false))).status,401);const r=await h(req(true));assert.equal(r.status,200);assert.equal((await r.json()).confirmation.state,'confirmed');
 }finally{await f.db.close();}
});
