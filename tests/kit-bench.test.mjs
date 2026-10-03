import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {validateBenchKit,benchSnapshot,BENCH_METHODS,scoreBench,benchHandler} from '../supabase/functions/_shared/kit-bench.mjs';
const dir=new URL('./bench/kits/',import.meta.url);
const kits=fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(new URL(n,dir),'utf8')));
const commit='a'.repeat(40),cron='bench-cron-token';

test('BENCH-01: every bench kit is valid, builds the production review part, and never shows expectations to the model',()=>{
 assert.ok(kits.length>=12);
 assert.ok(kits.filter(k=>!k.expected.length).length>=3,'clean kits measure extra questions');
 for(const kit of kits){
  validateBenchKit(kit,kit.id);
  const plan=BENCH_METHODS['whole-kit-2'](benchSnapshot(kit));
  assert.equal(plan.part.kind,'kit_review');
  assert.ok(plan.part.max_cost_microusd>0&&plan.part.max_cost_microusd<=100000);
  const prompt=plan.part.prompt;
  assert.ok(!prompt.includes(kit.title),kit.id+': title must not leak');
  for(const d of kit.expected){assert.ok(!prompt.includes(d.description),kit.id);assert.ok(!prompt.includes(d.key),kit.id);}
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
