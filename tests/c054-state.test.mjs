import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {state,STATE_QUERY,MEMBERS_QUERY,MIGRATIONS_QUERY,DEFS_QUERY,COLUMNS_QUERY,GRANTS_QUERY,bodyFromFile,bodyFromDatabase} from '../scripts/c054-state.mjs';

const env={SUPABASE_ACCESS_TOKEN:'test-supa'};
const GUARD_FILE='supabase/migrations/20260916100000_studkab_cloud_write_guard.sql';
const MEMBERS_FILE='supabase/migrations/20260916100100_studkab_members.sql';
const guardText=await readFile(GUARD_FILE,'utf8');
const membersText=await readFile(MEMBERS_FILE,'utf8');
const TAG='$'+'function'+'$';
// Так текст функции выглядит в базе: своё оформление заголовка, тело — как в файле.
const asDatabase=(name,body)=>`CREATE OR REPLACE FUNCTION public.${name}()\n LANGUAGE plpgsql\n SET search_path TO ''\nAS ${TAG}\n${body}\n${TAG}\n`;

const base={reg_guard:0,reg_members:0,reg_c051:1,trigger_guard:1,table_members:true,fn_guard:true,fn_current:true,fn_add:true,
 requests:3,cloud:4,subs:2,biggest:1000,active:0,save_member:true,save_limit:true,save_marker:true,save_md5:'abc'};
const defsFromFiles=(saveFrom=membersText)=>[
 {fn:'save_app_data_v2',def:asDatabase('save_app_data_v2',bodyFromFile(saveFrom,'save_app_data_v2'))},
 {fn:'studkab_app_data_guard',def:asDatabase('studkab_app_data_guard',bodyFromFile(guardText,'studkab_app_data_guard'))},
 {fn:'studkab_current_member',def:asDatabase('studkab_current_member',bodyFromFile(membersText,'studkab_current_member'))},
 {fn:'studkab_member_add',def:asDatabase('studkab_member_add',bodyFromFile(membersText,'studkab_member_add'))},
];

function world({row={},members=[{source:'backfill',n:6},{source:'executor',n:1}],
 migrations=[{version:'20260915130200',name:'studkab_unknown_fully_retained'}],
 defs=defsFromFiles(),
 columns=[{column_name:'user_id',data_type:'uuid',is_nullable:'NO',column_default:''},
  {column_name:'source',data_type:'text',is_nullable:'NO',column_default:''},
  {column_name:'added_at',data_type:'timestamp with time zone',is_nullable:'NO',column_default:'now()'}],
 access={grants:'service_role: INSERT, service_role: SELECT',rls:true,policies:0}}={}){
 const queries=[],logs=[];
 const request=async(url,o={})=>{
  const query=JSON.parse(o.body).query;
  queries.push(query);
  if(query===MEMBERS_QUERY)return Response.json(members);
  if(query===MIGRATIONS_QUERY)return Response.json(migrations);
  if(query===DEFS_QUERY)return Response.json(defs);
  if(query===COLUMNS_QUERY)return Response.json(columns);
  if(query===GRANTS_QUERY)return Response.json([access]);
  return Response.json([{...base,...row}]);
 };
 return {queries,logs,args:{env,request,read:readFile,log:m=>logs.push(String(m))}};
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

test('C-054 состояние: перечень изменений с 20260915 выводится номером и названием',async()=>{
 const w=world({migrations:[{version:'20260915130000',name:'studkab_generation_stop'},{version:'20260916100000',name:'studkab_cloud_write_guard'}]});
 await state(w.args);
 assert.match(w.logs.join('\n'),/Перечень изменений с 20260915: 20260915130000 studkab_generation_stop; 20260916100000 studkab_cloud_write_guard\./);
 assert.ok(!DEFS_QUERY.includes('statements')&&!MIGRATIONS_QUERY.includes('statements'),'текст изменений не запрашивается');
});

test('C-054 состояние: текст функций сверяется с файлами изменений',async()=>{
 const w=world();
 const result=await state(w.args);
 assert.deepEqual(result.comparison,{
  save_app_data_v2:'совпадает с 20260916100100',
  studkab_app_data_guard:'совпадает с 20260916100000',
  studkab_current_member:'совпадает с 20260916100100',
  studkab_member_add:'совпадает с 20260916100100',
 });
 assert.match(w.logs.join('\n'),/save_app_data_v2 — совпадает с 20260916100100/);
});

test('C-054 состояние: различает прежнюю версию save_app_data_v2, чужой текст и отсутствие функции',async()=>{
 const early=await state(world({defs:defsFromFiles(guardText)}).args);
 assert.equal(early.comparison.save_app_data_v2,'совпадает с 20260916100000');
 const changed=await state(world({defs:[{fn:'save_app_data_v2',def:asDatabase('save_app_data_v2','begin return; end')},
  {fn:'studkab_app_data_guard',def:null},{fn:'studkab_current_member',def:null},{fn:'studkab_member_add',def:null}]}).args);
 assert.equal(changed.comparison.save_app_data_v2,'не совпадает');
 assert.equal(changed.comparison.studkab_member_add,'функции нет в базе');
});

test('C-054 состояние: выводит состав столбцов и права таблицы допущенных',async()=>{
 const w=world();
 const result=await state(w.args);
 const text=w.logs.join('\n');
 assert.match(text,/user_id uuid not null; source text not null; added_at timestamp with time zone not null по умолчанию now\(\)/);
 assert.match(text,/Права studkab_members: service_role: INSERT, service_role: SELECT; защита строк включена; политик 0/);
 assert.equal(result.columns.length,3);
});

test('C-054 состояние: сценарий только читает',async()=>{
 const w=world();
 await state(w.args);
 for(const q of w.queries)assert.match(q,/^select/i,q.slice(0,40));
 assert.deepEqual(w.queries,[STATE_QUERY,MEMBERS_QUERY,MIGRATIONS_QUERY,DEFS_QUERY,COLUMNS_QUERY,GRANTS_QUERY]);
});

test('C-054 состояние: без таблицы допущенных запросы по ней не выполняются',async()=>{
 const w=world({row:{table_members:false,trigger_guard:0,fn_guard:false,fn_current:false,fn_add:false},
  defs:[{fn:'save_app_data_v2',def:null},{fn:'studkab_app_data_guard',def:null},{fn:'studkab_current_member',def:null},{fn:'studkab_member_add',def:null}]});
 const result=await state(w.args);
 assert.deepEqual(w.queries,[STATE_QUERY,MIGRATIONS_QUERY,DEFS_QUERY]);
 assert.equal(result.verdict,'не установлено');
 assert.match(w.logs.join('\n'),/Таблица studkab_members: таблицы нет/);
});

test('C-054 состояние: различает полную установку, частичную и расхождение с перечнем',async()=>{
 assert.equal((await state(world({row:{reg_guard:1,reg_members:1}}).args)).verdict,'установлено и зарегистрировано');
 assert.equal((await state(world({row:{fn_add:false}}).args)).verdict,'установлено частично');
 assert.equal((await state(world({row:{reg_guard:1}}).args)).verdict,'объекты есть, в перечне изменений не зарегистрированы');
});

test('C-054 состояние: без доступа ничего не запрашивается',async()=>{
 const w=world();
 await assert.rejects(state({...w.args,env:{}}),/SUPABASE_ACCESS_TOKEN/);
 assert.equal(w.queries.length,0);
});

test('C-054 состояние: тело функции выделяется из файла и из ответа базы',()=>{
 assert.notEqual(bodyFromFile(guardText,'save_app_data_v2'),bodyFromFile(membersText,'save_app_data_v2'));
 assert.match(bodyFromFile(membersText,'studkab_current_member'),/studkab_members/);
 assert.equal(bodyFromDatabase(asDatabase('x','тело функции')),'тело функции');
 assert.equal(bodyFromDatabase(null),null);
 assert.equal(bodyFromFile(membersText,'нет_такой_функции'),null);
});
