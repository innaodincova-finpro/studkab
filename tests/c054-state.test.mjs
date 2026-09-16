import {test} from 'node:test';
import assert from 'node:assert/strict';
import {state,STATE_QUERY,MEMBERS_QUERY} from '../scripts/c054-state.mjs';

const env={SUPABASE_ACCESS_TOKEN:'test-supa'};
const base={reg_guard:0,reg_members:0,reg_c051:1,trigger_guard:1,table_members:true,fn_guard:true,fn_current:true,fn_add:true,
 requests:3,cloud:4,subs:2,biggest:1000,active:0,save_member:true,save_limit:true,save_marker:true,save_md5:'abc'};

function world(row={},members=[{source:'backfill',n:6},{source:'executor',n:1}]){
 const queries=[],logs=[];
 const request=async(url,o={})=>{
  const query=JSON.parse(o.body).query;
  queries.push(query);
  return Response.json(query===MEMBERS_QUERY?members:[{...base,...row}]);
 };
 return {queries,logs,args:{env,request,log:m=>logs.push(String(m))}};
}

test('C-054 состояние: выводит перечень, объекты, записи и допуск',async()=>{
 const w=world();
 const result=await state(w.args);
 assert.equal(result.verdict,'объекты есть, в перечне изменений не зарегистрированы');
 const text=w.logs.join('\n');
 assert.match(text,/20260916100000 — нет/);
 assert.match(text,/таблица допущенных есть/);
 assert.match(text,/заявок 3, облачных записей кабинета и реестра 4, подписок 2/);
 assert.match(text,/backfill — 6, executor — 1/);
});

test('C-054 состояние: сценарий только читает',async()=>{
 const w=world();
 await state(w.args);
 for(const q of w.queries)assert.match(q,/^select/i,q.slice(0,40));
 assert.deepEqual(w.queries,[STATE_QUERY,MEMBERS_QUERY]);
});

test('C-054 состояние: без таблицы допущенных второй запрос не выполняется',async()=>{
 const w=world({table_members:false,trigger_guard:0,fn_guard:false,fn_current:false,fn_add:false});
 const result=await state(w.args);
 assert.deepEqual(w.queries,[STATE_QUERY]);
 assert.equal(result.verdict,'не установлено');
});

test('C-054 состояние: различает полную установку, частичную и расхождение с перечнем',async()=>{
 assert.equal((await state(world({reg_guard:1,reg_members:1}).args)).verdict,'установлено и зарегистрировано');
 assert.equal((await state(world({fn_add:false}).args)).verdict,'установлено частично');
 assert.equal((await state(world({reg_guard:1}).args)).verdict,'объекты есть, в перечне изменений не зарегистрированы');
});

test('C-054 состояние: без доступа ничего не запрашивается',async()=>{
 const w=world();
 await assert.rejects(state({...w.args,env:{}}),/SUPABASE_ACCESS_TOKEN/);
 assert.equal(w.queries.length,0);
});
