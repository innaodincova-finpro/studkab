import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {state,assertReadOnlyQuery,extractBody,statementsMatch,QUERIES,STATE_QUERY,MEMBERS_QUERY,MIGRATION_RECORDS_QUERY,MIGRATIONS_QUERY,DEFS_QUERY,COLUMNS_QUERY,CONSTRAINTS_QUERY,TRIGGER_QUERY,SECURITY_QUERY,ACCESS_QUERY} from '../scripts/c054-state.mjs';

const env={SUPABASE_ACCESS_TOKEN:'test-secret-value'};
const guardFile=await readFile('supabase/migrations/20260916100000_studkab_cloud_write_guard.sql','utf8');
const membersFile=await readFile('supabase/migrations/20260916100100_studkab_members.sql','utf8');
const tag='$'+'function'+'$';
const definition=(name,file)=>`CREATE FUNCTION public.${name}() RETURNS void LANGUAGE plpgsql AS ${tag}${extractBody(file,name)}${tag}`;
const exec=(anon,authenticated,service_role)=>[{grantee:'anon',execute:anon},{grantee:'authenticated',execute:authenticated},{grantee:'service_role',execute:service_role}];
const base={reg_c051:1,requests:3,cloud:4,subs:2,biggest:1000,active:0};
const migrations=[{version:'20260916135700',name:'studkab_cloud_write_guard',statements:[guardFile]},{version:'20260916135724',name:'studkab_members',statements:[membersFile]}];
const defs=[
 {fn:'save_app_data_v2',def:definition('save_app_data_v2',membersFile)},
 {fn:'studkab_app_data_guard',def:definition('studkab_app_data_guard',guardFile)},
 {fn:'studkab_current_member',def:definition('studkab_current_member',membersFile)},
 {fn:'studkab_member_add',def:definition('studkab_member_add',membersFile)},
];
const columns=[
 {column_name:'user_id',data_type:'uuid',udt_name:'uuid',is_nullable:'NO',column_default:''},
 {column_name:'source',data_type:'text',udt_name:'text',is_nullable:'NO',column_default:''},
 {column_name:'added_at',data_type:'timestamp with time zone',udt_name:'timestamptz',is_nullable:'NO',column_default:'now()'},
];
const constraints=[
 {conname:'studkab_members_source_check',contype:'c',definition:"CHECK (source = ANY (ARRAY['backfill'::text, 'invite'::text, 'executor'::text]))"},
 {conname:'studkab_members_user_id_fkey',contype:'f',definition:'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'},
 {conname:'studkab_members_pkey',contype:'p',definition:'PRIMARY KEY (user_id)'},
];
const trigger=[{tgname:'studkab_app_data_guard',tgenabled:'O',is_row:true,is_before:true,on_insert:true,on_delete:true,on_update:true,function_name:'studkab_app_data_guard()'}];
const security={rls:true,policies:0,grants:[{grantee:'service_role',privilege:'INSERT'},{grantee:'service_role',privilege:'SELECT'}]};
const access=[
 {fn:'save_app_data_v2',owner:'postgres',security_definer:false,empty_search_path:true,access:exec(false,true,true)},
 {fn:'studkab_app_data_guard',owner:'postgres',security_definer:false,empty_search_path:true,access:exec(false,false,true)},
 {fn:'studkab_current_member',owner:'postgres',security_definer:true,empty_search_path:true,access:exec(false,true,true)},
 {fn:'studkab_member_add',owner:'postgres',security_definer:true,empty_search_path:true,access:exec(false,false,true)},
];

function world(change={}){
 const data={state:[base],migrations,migrationList:[{version:'20260915130200',name:'studkab_generation_stop'},...migrations.map(({version,name})=>({version,name}))],defs,columns,constraints,trigger,security:[security],access,members:[{source:'backfill',n:6},{source:'executor',n:1}],...change};
 const queries=[],logs=[];
 const request=async(_url,o)=>{
  const q=JSON.parse(o.body).query; queries.push(q);
  if(q===STATE_QUERY)return Response.json(data.state);
  if(q===MIGRATION_RECORDS_QUERY)return Response.json(data.migrations);
  if(q===MIGRATIONS_QUERY)return Response.json(data.migrationList);
  if(q===DEFS_QUERY)return Response.json(data.defs);
  if(q===COLUMNS_QUERY)return Response.json(data.columns);
  if(q===CONSTRAINTS_QUERY)return Response.json(data.constraints);
  if(q===TRIGGER_QUERY)return Response.json(data.trigger);
  if(q===SECURITY_QUERY)return Response.json(data.security);
  if(q===ACCESS_QUERY)return Response.json(data.access);
  if(q===MEMBERS_QUERY)return Response.json(data.members);
  throw Error('unexpected query');
 };
 return {queries,logs,args:{env,request,read:readFile,log:x=>logs.push(String(x))}};
}

test('C-054 expanded: полное соответствие обеих фактических миграций и объектов',async()=>{
 const w=world(),r=await state(w.args);
 assert.equal(r.verdict,'соответствует');
 assert.ok(Object.values(r.checks).every(Boolean));
 assert.match(w.logs.join('\n'),/допущенных 7/);
});

test('C-054 expanded: отсутствующая и чужая запись миграции дают несоответствие',async()=>{
 assert.equal((await state(world({migrations:migrations.slice(0,1)}).args)).checks.migration_records,false);
 const wrong=structuredClone(migrations); wrong[1].statements=['select private_data from users'];
 const w=world({migrations:wrong}),r=await state(w.args);
 assert.equal(r.checks.migration_records,false);
 assert.doesNotMatch(w.logs.join('\n'),/private_data|select/i);
});

test('C-054 expanded: migration statements принимаются полным файлом и последовательными фрагментами',()=>{
 assert.equal(statementsMatch([guardFile],guardFile),true);
 assert.equal(statementsMatch([guardFile.slice(0,500),guardFile.slice(500)],guardFile),true);
 assert.equal(statementsMatch(guardFile.split(';'),guardFile),true);
 assert.equal(statementsMatch([guardFile,'select 1'],guardFile),false);
});

test('C-054 expanded: сохраняет проверку C-051 и полный безопасный список миграций',async()=>{
 const w=world(),r=await state(w.args),out=w.logs.join('\n');
 assert.equal(r.reg_c051,1);
 assert.match(out,/C-051 \(20260915130200\): зарегистрирована/);
 assert.match(out,/20260916135724 studkab_members/);
 assert.ok(!MIGRATIONS_QUERY.includes('statements'));
 assert.equal((await state(world({state:[{...base,reg_c051:0}]}).args)).verdict,'не соответствует');
});

test('C-054 expanded: неправильный trigger, statement-level BEFORE и отсутствующие события обнаруживаются',async()=>{
 for(const key of ['is_row','is_before','on_insert','on_update','on_delete']){
  const bad={...trigger[0],[key]:false};
  assert.equal((await state(world({trigger:[bad]}).args)).checks.trigger,false,key);
 }
 assert.equal((await state(world({trigger:[{...trigger[0],function_name:'other()'}]}).args)).checks.trigger,false);
});

test('C-054 expanded: проверяются столбцы и default',async()=>{
 assert.equal((await state(world({columns:columns.slice(0,2)}).args)).checks.columns,false);
 assert.equal((await state(world({columns:columns.map(x=>x.column_name==='added_at'?{...x,column_default:'clock_timestamp()'}:x)}).args)).checks.columns,false);
});

test('C-054 expanded: проверяются PK, FK, cascade и CHECK',async()=>{
 for(let i=0;i<constraints.length;i++)assert.equal((await state(world({constraints:constraints.filter((_,n)=>n!==i)}).args)).checks.constraints,false);
 assert.equal((await state(world({constraints:constraints.map(x=>x.contype==='f'?{...x,definition:'FOREIGN KEY (user_id) REFERENCES auth.users(id)'}:x)}).args)).checks.constraints,false);
 assert.equal((await state(world({constraints:constraints.map(x=>x.contype==='c'?{...x,definition:"CHECK (source = 'invite')"}:x)}).args)).checks.constraints,false);
 assert.equal((await state(world({constraints:constraints.map(x=>x.contype==='c'?{...x,definition:"CHECK (source = ANY (ARRAY['backfill'::text, 'invite'::text, 'executor'::text, 'other'::text]))"}:x)}).args)).checks.constraints,false);
 assert.equal((await state(world({constraints:constraints.map(x=>x.contype==='c'?{...x,definition:"CHECK (source IS NOT NULL OR source = ANY (ARRAY['backfill'::text, 'invite'::text, 'executor'::text]))"}:x)}).args)).checks.constraints,false);
});

test('C-054 expanded: проверяются RLS, policies и лишние grants',async()=>{
 assert.equal((await state(world({security:[{...security,rls:false}]}).args)).checks.security,false);
 assert.equal((await state(world({security:[{...security,policies:1}]}).args)).checks.security,false);
 assert.equal((await state(world({security:[{...security,grants:[...security.grants,{grantee:'authenticated',privilege:'SELECT'}]}]}).args)).checks.security,false);
});

test('C-054 expanded: проверяются owner, SECURITY DEFINER и search_path',async()=>{
 assert.equal((await state(world({access:access.map((x,i)=>i?x:{...x,owner:'other'})}).args)).checks.access,false);
 assert.equal((await state(world({access:access.map(x=>x.fn==='studkab_member_add'?{...x,security_definer:false}:x)}).args)).checks.access,false);
 assert.equal((await state(world({access:access.map(x=>x.fn==='studkab_current_member'?{...x,empty_search_path:false}:x)}).args)).checks.access,false);
});

test('C-054 expanded: изменение каждой функции обнаруживается',async()=>{
 for(let i=0;i<defs.length;i++){
  const changed=defs.map((x,n)=>n===i?{...x,def:'CREATE FUNCTION changed() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$'}:x);
  assert.equal((await state(world({defs:changed}).args)).checks.functions,false,defs[i].fn);
 }
});

test('C-054 expanded: guard запрещает DML, DDL и второй statement',()=>{
 for(const q of Object.values(QUERIES))assert.equal(assertReadOnlyQuery(q),true);
 for(const q of ['DELETE FROM x','UPDATE x SET a=1','CREATE TABLE x(a int)','SELECT 1; DROP TABLE x'])assert.throws(()=>assertReadOnlyQuery(q),/только один SELECT/);
});

test('C-054 expanded: журнал не раскрывает UUID, email, SQL, содержимое и токен',async()=>{
 const w=world(); await state(w.args); const out=w.logs.join('\n');
 assert.doesNotMatch(out,/test-secret-value|@|[0-9a-f]{8}-[0-9a-f-]{27,}|create function|select private_data|settings/i);
});

test('C-054 expanded: без таблицы не запрашивает members и даёт несоответствие',async()=>{
 const w=world({columns:[],constraints:[],trigger:[],security:[{rls:null,policies:0,grants:[]}],access:[],defs:[]});
 const r=await state(w.args); assert.equal(r.verdict,'не соответствует');
 assert.ok(!w.queries.includes(MEMBERS_QUERY));
});

test('C-054 expanded: без токена сетевых запросов нет, ошибка API не раскрывает тело',async()=>{
 const w=world(); await assert.rejects(state({...w.args,env:{}}),/SUPABASE_ACCESS_TOKEN/); assert.equal(w.queries.length,0);
 const request=async()=>new Response('email=a@example.test token=secret',{status:500});
 await assert.rejects(state({env,request,read:readFile}),/Supabase 500; подробности скрыты/);
});
