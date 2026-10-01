import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {schema,submissionExtension,student,other,apiDatabase} from './intake-fixture.mjs';
import {distribute} from '../supabase/functions/_shared/intake-analysis.mjs';
import {handler,validatePayload} from '../supabase/functions/studkab-requests/handler.mjs';
import {intakeAction} from '../supabase/functions/studkab-requests/intake.mjs';
import {addIntakeCandidates} from '../supabase/functions/studkab-requests/intake-passport.mjs';
import {requirementAction,originalityText} from '../supabase/functions/studkab-requests/requirements.mjs';
async function fixture(assignment=true){
 const db=new PGlite();await db.exec(schema()+submissionExtension());await db.exec('set role service_role');const api=apiDatabase(db),rpc=(name,args)=>api('rpc/studkab_intake_'+name,'POST',args);
 const draft=await rpc('open',{p_student:student}),files=[];
 for(let index=0;index<3;index++){
 const {file}=await rpc('reserve',{p_student:student,p_draft:draft.id,p_name:['Задание.docx','Методичка.pdf','Расчёт.xlsx'][index],p_type:['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'][index],p_size:10,p_hash:'abc'[index].repeat(64),p_supersedes:null});
 await rpc('finish',{p_student:student,p_draft:draft.id,p_file:file.id,p_hash:file.file_hash});
 await db.query("update studkab_intake_files set read_status='ready',read_version='intake-reader-1',extracted_text=$2,read_result=$3 where id=$1",[file.id,'Текст '+index,{status:'ready',blocks:[]}]);files.push(file);
 }
 const snap=await rpc('analysis_snapshot',{p_student:student,p_draft:draft.id});
 const facts={t:'Управление организацией',k:'Курсовая работа',u:'Учебный вуз',n:'Учебный студент',d:'Менеджмент',dl:'Сдать до 30.10.2026'};
 const refs=[{fileId:files[0].id,fileName:files[0].file_name,fileHash:files[0].file_hash,quote:'Отдельное требование',source:{paragraph:1}}];
 const result=distribute([{candidates:[...Object.entries(facts).map(([field,value])=>({field,value,condition:'',refs})),{field:'requirement',value:'Отдельное требование',condition:'Если есть расчёты',refs}],roles:assignment?files.map(f=>({role:'assignment',refs:[{...refs[0],fileId:f.id}]})):[]}]);
 const job=(await db.query("insert into studkab_intake_analysis_jobs(draft_id,manifest,version,plan,state,result) values($1,$2,'intake-analysis-1','[{}]','done',$3) returning id",[draft.id,snap.manifest,result])).rows[0];
 const confirmed=await rpc('confirmation_save',{p_student:student,p_draft:draft.id,p_analysis:job.id,p_revision:0,p_answers:{'c:requirement:0':{type:'unknown'}},p_confirm:true});
 const input={action:'intake-submit',id:draft.id,analysisId:job.id,revision:confirmed.revision};const user={id:student,email:'student@example.invalid',email_confirmed_at:'2026-01-01'},copied=[];
 const deps={db:api,isMember:async()=>true,validatePayload,transferIntake:async f=>copied.push(f)};
 const action=(body=input,who=user,changes={})=>intakeAction(body,who,{...deps,...changes});
 const snapshot=()=>rpc('submission_snapshot',{p_student:student,p_draft:draft.id,p_contact:user.email});
 const submit=async(src,revision=confirmed.revision)=>{src??=await snapshot();return rpc('submit',{p_student:student,p_draft:draft.id,p_analysis:job.id,p_revision:revision,p_contact:user.email,p_content:src.payload});};
 return {db,api,rpc,draft,files,result,job,confirmed,input,user,deps,copied,action,snapshot,submit};
}
test('one atomic ordinary request contains all same-role files including XLSX, original hashes, date and receipt; repeats do not copy or renotify',async()=>{
 const f=await fixture();try{
 const preview=(await f.action({...f.input,action:'intake-submission-state'})).data.submission;assert.equal(preview.canSubmit,true);assert.equal(preview.files,3);assert.equal(f.copied.length,0);
 const first=(await f.action()).data.submission;assert.equal(first.submitted,true);assert.equal(first.payload.dl,'2026-10-30');assert.equal(first.payload.cn,f.user.email);assert.equal(f.copied.length,3);
 const again=(await f.action()).data.submission;assert.equal(again.id,first.id);assert.equal(again.duplicate,true);assert.equal(f.copied.length,3);
 const rows=(await f.db.query('select * from studkab_request_attachments order by file_name')).rows;assert.equal(rows.length,3);assert.ok(rows.every(r=>r.category==='assignment'&&r.intake_file_id===r.id));assert.ok(rows.every(r=>f.files.some(o=>o.id===r.id&&o.file_hash===r.file_hash&&o.storage_path===r.storage_path)));
 assert.ok((await f.db.query('select ready_at from studkab_requests')).rows[0].ready_at);assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,1);
 const context=await f.rpc('request_context',{p_request:first.id});assert.deepEqual(context.analysis,f.result);assert.equal(context.answers['c:requirement:0'].type,'unknown');assert.equal(context.stale,false);
 await assert.rejects(()=>f.db.query("update studkab_intake_drafts set notes='overwrite' where id=$1",[f.draft.id]),/IMMUTABLE/);
 await f.db.exec('reset role');await f.db.query('update studkab_requests set revision=revision+1 where id=$1',[first.id]);await f.db.exec('set role service_role');assert.equal((await f.rpc('request_context',{p_request:first.id})).stale,true);
 }finally{await f.db.close();}
});
test('partial storage failure creates no request; retry transfers retained originals once before publication',async()=>{
 const f=await fixture();try{let count=0;await assert.rejects(()=>f.action(f.input,f.user,{transferIntake:async()=>{if(++count===2)throw Error('lost storage');}}),/lost storage/);
 assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,0);assert.equal((await f.db.query('select count(*) n from studkab_intake_files')).rows[0].n,3);assert.equal((await f.action()).data.submission.submitted,true);
 }finally{await f.db.close();}
});
test('unknown core field, bad dates and large fields are not invented or truncated; no transfer before validation',async()=>{
 const f=await fixture();try{await f.rpc('confirmation_save',{p_student:student,p_draft:f.draft.id,p_analysis:f.job.id,p_revision:1,p_answers:{'c:requirement:0':{type:'unknown'},'f:dl':{type:'unknown'}},p_confirm:true});
 const r=await f.action({...f.input,revision:2});assert.equal(r.status,409);assert.ok(r.data.submission.missing.includes('dl'));assert.equal(f.copied.length,0);
 for(const value of ['2026-02-30','01.10.2026 или 02.10.2026','x'.repeat(301)]){const s=await f.rpc('confirmation_state',{p_student:student,p_draft:f.draft.id});await f.rpc('confirmation_save',{p_student:student,p_draft:f.draft.id,p_analysis:f.job.id,p_revision:s.revision,p_answers:{'c:requirement:0':{type:'unknown'},'f:dl':{type:'custom',value}},p_confirm:true});const now=await f.rpc('confirmation_state',{p_student:student,p_draft:f.draft.id});assert.equal((await f.action({...f.input,revision:now.revision})).status,409);}
 assert.equal(f.copied.length,0);
 }finally{await f.db.close();}
});
test('source or answer change during copies refuses atomic commit, forged payload is rejected and old files remain',async()=>{
 const f=await fixture();try{const src=await f.snapshot();assert.equal((await f.submit({...src,payload:{...src.payload,t:'forged'}})).invalid,true);
 let changed=false;const r=await f.action(f.input,f.user,{transferIntake:async()=>{if(!changed){changed=true;await f.rpc('notes',{p_student:student,p_draft:f.draft.id,p_revision:(await f.db.query('select revision from studkab_intake_drafts')).rows[0].revision,p_notes:'Материалы изменились'});}}});assert.equal(r.status,409);assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('publication refusal rolls back request and every attachment; foreign owner and browser roles cannot access submissions',async()=>{
 const f=await fixture(false);try{
 await assert.rejects(()=>f.submit(),/INTAKE_ASSIGNMENT_REQUIRED/);assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,0);assert.equal((await f.db.query('select count(*) n from studkab_request_attachments')).rows[0].n,0);
 assert.equal((await f.action(f.input,{...f.user,id:other})).status,404);assert.equal((await f.action(f.input,f.user,{isMember:async()=>false})).status,403);
 for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(()=>f.snapshot(),/permission denied/);await assert.rejects(()=>f.rpc('request_context',{p_request:f.draft.id}),/permission denied/);}
 }finally{await f.db.close();}
});
test('lost final HTTP reply is recovered from stored receipt; client payload/identity cannot replace the server snapshot',async()=>{
 const f=await fixture();try{let lost=true;const db=async(...args)=>{const r=await f.api(...args);if(args[0]==='rpc/studkab_intake_submit'&&lost){lost=false;throw Error('response lost');}return r;};
 const h=handler({...f.deps,db,auth:async()=>f.user});const req=()=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer valid'},body:JSON.stringify({...f.input,payload:{t:'forged'},student:other})});assert.equal((await h(req())).status,503);const r=await h(req());assert.equal(r.status,200);assert.equal((await r.json()).submission.payload.t,'Управление организацией');assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('intake candidate requirements keep sources, conditions and unknown answers, stay unverified and cannot silently truncate',async()=>{
 const f=await fixture();try{const {id}=await f.submit();const ctx=await f.rpc('request_context',{p_request:id});const passport=addIntakeCandidates({items:[{id:'WORK_TYPE',verified:false}]},ctx);assert.equal(passport.items.length,2);assert.equal(passport.items[1].verified,false);assert.ok(passport.items[1].text.includes('не знает'));assert.equal(passport.items[1].source_attachment_id,f.files[0].id);
 assert.equal(addIntakeCandidates(passport,ctx).items.length,2);assert.throws(()=>addIntakeCandidates({items:Array.from({length:100},(_,i)=>({id:String(i)}))},ctx),/больше требований/);assert.throws(()=>addIntakeCandidates({items:[]},{...ctx,analysis:{...ctx.analysis,requirements:[{value:'x'.repeat(2001),refs:[{quote:'s'}]}]}}),/превышают/);
 }finally{await f.db.close();}
});

test('approval cannot drop or weaken a semantic candidate even if the old standard passport is fully marked',async()=>{
 const f=await fixture();try{const {id}=await f.submit(),ctx=await f.rpc('request_context',{p_request:id});
 const items=['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER'].map(id=>({id,category:'method',required:true,verified:true,text:'Подтверждённое условие '+id,source:'STUDKAB',answer_ids:[]}));
 const anti=items.find(x=>x.id==='ANTIPLAGIARISM');anti.originality={mode:'service_only',service:'',thresholdPercent:null};anti.text=originalityText(anti.originality);
 let approved=false;const db=async(path)=>{if(path.startsWith('studkab_requests?'))return [{id,payload:{},revision:4,ready_at:'2026-01-01'}];if(path.startsWith('studkab_request_attachments?'))return [{...f.files[0],intake_file_id:f.files[0].id,category:'assignment',extracted_text:'Текст'}];if(path==='rpc/studkab_intake_request_context')return ctx;approved=true;throw Error('Approval should be blocked before RPC');};
 const base={action:'passport-approve',id,passportId:f.job.id,sourceFingerprint:'a'.repeat(64)};
 for(const candidate of [null,{...addIntakeCandidates({items:[]},ctx).items[0],verified:true,required:false},{...addIntakeCandidates({items:[]},ctx).items[0],verified:true,text:'Подмена'}]){
 const r=await requirementAction({...base,passport:{title:'Паспорт',items:items.concat(candidate?[candidate]:[])}},{email:'executor@example.invalid',id:other},{db,config:async()=>({executor_email:'executor@example.invalid'})});assert.equal(r.status,409);assert.ok(r.data.error.includes('общей загрузки'));
 }assert.equal(approved,false);
 }finally{await f.db.close();}
});
test('deleted or reassigned request does not disclose changed payload to its former intake owner or recreate the request',async()=>{
 const f=await fixture();try{const {id}=await f.submit();await f.db.exec('reset role');await f.db.query('update studkab_requests set student_id=$2 where id=$1',[id,other]);await f.db.exec('set role service_role');assert.equal((await f.snapshot()).gone,true);assert.equal((await f.submit()).gone,true);assert.equal((await f.db.query('select count(*) n from studkab_requests')).rows[0].n,1);
 }finally{await f.db.close();}
});
