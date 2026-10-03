import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {validateBenchKit,benchSnapshot,BENCH_METHODS,scoreBench,benchHandler} from '../supabase/functions/_shared/kit-bench.mjs';
const dir=new URL('./bench/kits/',import.meta.url);
const kits=fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(new URL(n,dir),'utf8')));
const commit='a'.repeat(40),cron='bench-cron-token';

test('BENCH-01: every bench kit is valid, builds the production review part, and never shows expectations to the model',async()=>{
 assert.ok(kits.length>=12);
 assert.ok(kits.filter(k=>!k.expected.length).length>=3,'clean kits measure extra questions');
 for(const kit of kits){
  validateBenchKit(kit,kit.id);
  const seen=[];const ask=async(system,part,step)=>{seen.push({system,part,step});throw Error('STOP');};
  for(const m of Object.keys(BENCH_METHODS))await assert.rejects(BENCH_METHODS[m](benchSnapshot(kit),ask),/STOP/);
  assert.equal(seen.length,3);assert.equal(seen[0].part.kind,'kit_review');assert.equal(seen[0].part.prompt,seen[1].part.prompt);assert.notEqual(seen[0].system,seen[1].system);
  assert.equal(seen[2].part.kind,'checklist_inventory');
  for(const x of seen)assert.ok(x.part.max_cost_microusd>0&&x.part.max_cost_microusd<=100000);
  for(const prompt of seen.map(x=>x.part.prompt)){
  assert.ok(!prompt.includes(kit.title),kit.id+': title must not leak');
  for(const d of kit.expected){assert.ok(!prompt.includes(d.description),kit.id);assert.ok(!prompt.includes(d.key),kit.id);}
  }
 }
});

test('BENCH-01: scoring counts found, missed and extra questions',()=>{
 const kit={expected:[{key:'a',keywords:['опрос']},{key:'b',keywords:['объём']}]};
 const s=scoreBench(kit,[{question:'Где таблица ОПРОСА?',reason:'нет данных'},{question:'Укажите ФИО',reason:'нет'}]);
 assert.deepEqual(s,{expected:2,found:['a'],missed:['b'],extra:1,questions:2});
 assert.deepEqual(scoreBench({expected:[]},[]),{expected:0,found:[],missed:[],extra:0,questions:0});
});

function harness({budget=true,text}={}){
 const calls=[];const kit=kits.find(k=>k.id==='C1');
 const h=benchHandler({
  authorize:async req=>/^Bearer /.test(req.headers.get('Authorization')||''),
  config:async()=>({cron_token:cron}),
  rpc:async(name,args)=>{calls.push([name,args]);if(name==='studkab_kit_bench_reserve')return budget?'run-1':null;return 'done';},
  fetchKit:async(c,id)=>{calls.push(['fetch',c,id]);return kit;},
  provider:async(c)=>{calls.push(['provider',c.spec.kind]);return {complete:true,text:text(c.spec)};},
 });
 const req=(body,headers={})=>new Request('https://x/',{method:'POST',headers:{Authorization:'Bearer x','X-Studkab-Runner':cron,...headers},body:JSON.stringify(body)});
 return {h,calls,req,kit};
}
test('BENCH-01: handler authorizes before reading the kit and reserves before calling the model',async()=>{
 const gapText=spec=>JSON.stringify({gaps:[{key:'variant',question:'Какой у вас вариант?',reason:'Вариант выбирается по номеру зачётной книжки, номер не указан.',ids:[spec.blocks.find(b=>/зачётной книжки/.test(b.text)).blockId]}],answerReviews:[],returnedReviews:[]});
 let t=harness({text:gapText});
 assert.equal((await t.h(t.req({kit:'C1',commit,method:'whole-kit-2'},{'X-Studkab-Runner':'wrong'}))).status,401);
 assert.equal((await t.h(t.req({kit:'../x',commit,method:'whole-kit-2'}))).status,400);
 assert.equal((await t.h(t.req({kit:'C1',commit,method:'other'}))).status,400);
 assert.deepEqual(t.calls,[]);
 const ok=await (await t.h(t.req({kit:'C1',commit,method:'whole-kit-2'}))).json();
 assert.equal(ok.status,'done');assert.deepEqual(ok.score.found,['variant_unknown']);assert.equal(ok.score.extra,0);
 assert.deepEqual(t.calls.map(c=>c[0]),['fetch','studkab_kit_bench_reserve','provider','studkab_kit_bench_finish']);
 t=harness({budget:false,text:gapText});
 assert.equal((await (await t.h(t.req({kit:'C1',commit,method:'whole-kit-2'}))).json()).status,'budget_or_disabled');
 assert.ok(!t.calls.some(c=>c[0]==='provider'),'no paid call without reserve');
 t=harness({text:()=>'not json'});
 const bad=await (await t.h(t.req({kit:'C1',commit,method:'whole-kit-2'}))).json();
 assert.equal(bad.status,'failed');assert.match(bad.error,/^invalid:/);
 assert.equal(t.calls.at(-1)[1].p_error,bad.error);
});

test('BENCH-01: bench limit is separate, off by default, closed to clients and counts unfinished runs',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;`);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261003170000_route02_kit_bench.sql',import.meta.url),'utf8'));
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.r;
 await db.exec('set role service_role');
 assert.equal(await q("select public.studkab_kit_bench_reserve('A1','whole-kit-2',$1,20000) r",[commit]),null,'disabled by default');
 await assert.rejects(db.query('select * from public.studkab_kit_bench_runs'));
 await assert.rejects(db.query('update public.studkab_kit_bench_policy set enabled=true'));
 await db.exec('reset role');await db.exec('update public.studkab_kit_bench_policy set enabled=true,limit_microusd=50000');await db.exec('set role service_role');
 const a=await q("select public.studkab_kit_bench_reserve('A1','whole-kit-2',$1,20000) r",[commit]);
 const b=await q("select public.studkab_kit_bench_reserve('A2','whole-kit-2',$1,20000) r",[commit]);
 assert.ok(a&&b);
 assert.equal(await q("select public.studkab_kit_bench_reserve('A3','whole-kit-2',$1,20000) r",[commit]),null,'limit includes unfinished runs');
 await assert.rejects(db.query("select public.studkab_kit_bench_reserve('A3','whole-kit-2',$1,200000) r",[commit]));
 assert.equal(await q("select public.studkab_kit_bench_finish($1,'{}','{}'::jsonb,null) r",[a]),'done');
 await assert.rejects(db.query("select public.studkab_kit_bench_finish($1,'{}','{}'::jsonb,null) r",[a]),/STALE_RUN/);
 assert.equal(await q("select public.studkab_kit_bench_finish($1,null,null,'invalid:X') r",[b]),'invalid');
 await db.exec('reset role');await db.exec('set role anon');
 await assert.rejects(db.query("select public.studkab_kit_bench_reserve('A1','whole-kit-2',$1,1) r",[commit]));
});

test('BENCH-02: after the answer the reserve shrinks to the actual cost, never grows, and stays full without usage',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;`);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261003170000_route02_kit_bench.sql',import.meta.url),'utf8'));
 await db.exec('update public.studkab_kit_bench_policy set enabled=true,limit_microusd=50000');
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.r;
 const old=await q("select public.studkab_kit_bench_reserve('A1','whole-kit-2',$1,20000) r",[commit]);
 await q("select public.studkab_kit_bench_finish($1,'x',$2::jsonb,null) r",[old,JSON.stringify({usage:{prompt:2000,completion:500}})]);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261003200000_route02_kit_bench_actual.sql',import.meta.url),'utf8'));
 assert.equal(Number(await q('select reserved_microusd r from public.studkab_kit_bench_runs where id=$1',[old])),1500,'finished run recounted: (2000*0.3+500*1.2)*1.25');
 await db.exec('set role service_role');
 const a=await q("select public.studkab_kit_bench_reserve('A1','whole-kit-2',$1,20000) r",[commit]);
 const b=await q("select public.studkab_kit_bench_reserve('A2','whole-kit-2',$1,20000) r",[commit]);
 assert.equal(await q("select public.studkab_kit_bench_reserve('A3','whole-kit-2',$1,20000) r",[commit]),null,'full reserve still required up front');
 await q("select public.studkab_kit_bench_finish($1,'x',$2::jsonb,null) r",[a,JSON.stringify({usage:{prompt:8000,completion:1000}})]);
 await q("select public.studkab_kit_bench_finish($1,null,$2::jsonb,'provider') r",[b,JSON.stringify({usage:null})]);
 await db.exec('reset role');
 const rows=(await db.query('select id,reserved_microusd from public.studkab_kit_bench_runs')).rows,by=Object.fromEntries(rows.map(r=>[r.id,Number(r.reserved_microusd)]));
 assert.equal(by[a],4500);assert.equal(by[b],20000);
 await db.exec('set role service_role');
 assert.ok(await q("select public.studkab_kit_bench_reserve('A3','whole-kit-2',$1,20000) r",[commit]),'freed reserve is reusable');
 await db.exec('reset role');
 const big=(await db.query("select id from public.studkab_kit_bench_runs where kit='A3'")).rows[0].id;
 await db.exec('set role service_role');
 await q("select public.studkab_kit_bench_finish($1,'x',$2::jsonb,null) r",[big,JSON.stringify({usage:{prompt:999999,completion:999999}})]);
 await db.exec('reset role');
 assert.equal(Number((await db.query('select reserved_microusd from public.studkab_kit_bench_runs where id=$1',[big])).rows[0].reserved_microusd),20000,'never grows above reserve');
});

test('KIT-05: checklist method — two steps with separate reserves; absent data and differing parameter values become questions',async()=>{
 const kit=kits.find(k=>k.id==='B2');
 const reserves=[];
 const provider=async c=>{
  const b=t=>c.spec.blocks.find(x=>x.text.includes(t)).blockId;
  if(c.spec.kind==='checklist_inventory')return {complete:true,text:JSON.stringify({needs:[
   {need:'баланс за 2022–2024',required_ids:[b('Исходные данные — бухгалтерский')],found_ids:[b('Валюта баланса')],status:'present',question:''},
   {need:'расшифровка запасов',required_ids:[b('Рассчитать коэффициенты')],found_ids:[],status:'absent',question:'Где расшифровка запасов?'},
   {need:'выдумка',required_ids:['b999'],found_ids:[],status:'absent',question:'?'},
   {need:'ФИО для титула',required_ids:[b('Рассчитать коэффициенты')],found_ids:[],status:'absent',question:'Ваше ФИО?'}],
   params:[{kind:'deadline',value:'15 декабря 2026 года',ids:[b('Срок сдачи')]},{kind:'deadline',value:'2026-11-20',ids:[b('Срок, указанный студентом')]},
    {kind:'volume',value:'30–35 страниц',ids:[b('Объём')]},{kind:'colour',value:'5',ids:[b('Объём')]}]}),detail:{prompt_tokens:100,completion_tokens:10}};
  // Второй шаг получает все три принятых пункта; баланс подтверждён, запасов нет, ФИО не нужно.
  assert.deepEqual(JSON.parse(c.spec.prompt).checks.map(x=>x.n),[0,1,2]);
  assert.deepEqual(JSON.parse(c.spec.prompt).checks[0].claimed_ids,[b('Валюта баланса')]);
  return {complete:true,text:JSON.stringify({checks:[{n:0,status:'found',ids:[b('Валюта баланса')]},{n:1,status:'absent',ids:[]},{n:2,status:'not_needed',ids:[]}]}),detail:{prompt_tokens:100,completion_tokens:5}};
 };
 const calls=[];
 const h=benchHandler({authorize:async()=>true,config:async()=>({cron_token:cron}),fetchKit:async()=>kit,provider,
  rpc:async(name,args)=>{calls.push([name,args]);if(name==='studkab_kit_bench_reserve'){reserves.push(args.p_method);return 'run-'+reserves.length;}return 'done';}});
 const r=await (await h(new Request('https://x/',{method:'POST',headers:{Authorization:'Bearer x','X-Studkab-Runner':cron},body:JSON.stringify({kit:'B2',commit,method:'checklist-3'})}))).json();
 assert.equal(r.status,'done');assert.deepEqual(reserves,['checklist-3-s1','checklist-3-s2']);
 assert.deepEqual(r.score.found,['deadline_conflict']);assert.equal(r.score.questions,2);
 const fin=calls.filter(c=>c[0]==='studkab_kit_bench_finish');assert.equal(fin.length,2);
 assert.equal(fin[0][1].p_result.score,undefined);assert.deepEqual(fin[1][1].p_result.gaps.map(g=>g.type),['missing','conflict']);
});
test('KIT-05: parameter values are compared as numbers and dates, not as phrases',async()=>{
 const {paramKey}=await import('../supabase/functions/_shared/kit-checklist.mjs');
 assert.equal(paramKey('30 октября 2026 года'),paramKey('2026-10-30'));
 assert.notEqual(paramKey('15 декабря 2026 года'),paramKey('2026-11-20'));
 assert.equal(paramKey('25–30 страниц'),paramKey('25-30 страниц от введения до заключения'));
 assert.notEqual(paramKey('25–30 страниц'),paramKey('40–45 страниц'));
 assert.equal(paramKey('120 000 руб.'),paramKey('120000'));
 assert.equal(paramKey('Times New Roman 14 пт, интервал 1,5'),paramKey('14 пт; 1.5'));
 assert.equal(paramKey('по методичке'),null);
});
test('KIT-05: checklist-3 second step can overturn a wrong «present» and keeps unanswered absences',async()=>{
 const {verifyChecks}=await import('../supabase/functions/_shared/kit-checklist.mjs');
 const blocks=[{blockId:'b0',text:'Требование'},{blockId:'b1',text:'Вводный абзац'},{blockId:'b2',text:'Данные'}];
 const checks=[{need:'опрос',required:['b0'],found:['b1'],absent:false},{need:'затраты',required:['b0'],found:[],absent:true},{need:'цены',required:['b0'],found:[],absent:true},{need:'выручка',required:['b0'],found:['b2'],absent:false}];
 const part={blocks,checks};
 const out=verifyChecks(JSON.stringify({checks:[{n:0,status:'absent',ids:[]},{n:1,status:'found',ids:['b0']},{n:3,status:'found',ids:['b2']}]}),part);
 // опрос: «есть» опровергнуто; затраты: сведение стоит в самом требовании — найдено; цены: ответа нет — остаётся отсутствующим.
 assert.deepEqual(out.map(n=>n.need),['опрос','цены']);
 assert.deepEqual(verifyChecks(JSON.stringify({checks:[{n:1,status:'found',ids:['b999']}]}),part).map(n=>n.need),['затраты','цены']);
});
test('KIT-05: inventory treats data found only in the requirement itself as absent',async()=>{
 const {verifyInventory}=await import('../supabase/functions/_shared/kit-checklist.mjs');
 const blocks=[{blockId:'b0',text:'Ежегодные затраты 900 000, расшифровка в исходных данных',fileId:'f'},{blockId:'b1',text:'Таблица',fileId:'f'}];
 const r=verifyInventory(JSON.stringify({needs:[{need:'расшифровка',required_ids:['b0'],found_ids:['b0'],status:'present',question:''}],params:[]}),{blocks});
 assert.equal(r.needs[0].absent,true);assert.deepEqual(r.needs[0].found,[]);
});
test('KIT-05: a range of years equals the same years listed; analysis and forecast periods are separate kinds',async()=>{
 const {paramKey,PARAM_KINDS}=await import('../supabase/functions/_shared/kit-checklist.mjs');
 assert.equal(paramKey('2023–2025 годы'),paramKey('2023, 2024 и 2025 годы'));
 assert.notEqual(paramKey('2023–2025 годы'),paramKey('2022–2024 годы'));
 assert.ok(PARAM_KINDS.period&&PARAM_KINDS.forecast_period);
});
test('KIT-05: a less detailed value of the same parameter is not a conflict',async()=>{
 const {checklistGaps}=await import('../supabase/functions/_shared/kit-checklist.mjs');
 const blocks=[{blockId:'b0',text:'x',fileId:'f'},{blockId:'b1',text:'y',fileId:'f'},{blockId:'b2',text:'z',fileId:'f'}];
 const P=(kind,value,id)=>({kind,value,ids:[id]});
 assert.equal(checklistGaps(blocks,{params:[P('forecast_period','2027 год','b0'),P('forecast_period','январь–декабрь 2027 года','b1')]},[]).length,0);
 assert.equal(checklistGaps(blocks,{params:[P('deadline','15 декабря 2026','b0'),P('deadline','2026-11-20','b1')]},[]).length,1);
});
test('KIT-05: a step-1 «absent» is not overturned by pointing at the requirement itself',async()=>{
 const {verifyChecks}=await import('../supabase/functions/_shared/kit-checklist.mjs');
 const blocks=[{blockId:'b0',text:'Ежегодные затраты 900 000, расшифровка в исходных данных'},{blockId:'b1',text:'Тема: ...'}];
 const checks=[{need:'расшифровка ежегодных затрат',required:['b0'],found:[],absent:true,said:true},{need:'тема',required:['b1'],found:[],absent:true,said:false}];
 const out=verifyChecks(JSON.stringify({checks:[{n:0,status:'found',ids:['b0']},{n:1,status:'found',ids:['b1']}]}),{blocks,checks});
 assert.deepEqual(out.map(n=>n.need),['расшифровка ежегодных затрат']);
});
