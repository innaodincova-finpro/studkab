import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const file='supabase/migrations/20260917120817_c054_service_role_grants.sql';
const sql=await readFile(file,'utf8');
const rows=async(db,query)=>(await db.query(query)).rows;

test('C-054 grants repair: оставляет service_role только SELECT и INSERT, не меняя строки и владельца',async()=>{
 const db=new PGlite();
 await db.exec(`create role service_role nologin;
  create table public.studkab_members(user_id uuid primary key,source text not null);
  insert into public.studkab_members values('00000000-0000-4000-8000-000000000001','backfill');
  grant all privileges on table public.studkab_members to service_role;`);
 const [{owner:beforeOwner}]=await rows(db,`select pg_get_userbyid(relowner) owner from pg_class where oid='public.studkab_members'::regclass`);
 await db.exec(sql);
 const privileges=(await rows(db,`select privilege_type from information_schema.role_table_grants
  where table_schema='public' and table_name='studkab_members' and grantee='service_role' order by privilege_type`)).map(x=>x.privilege_type);
 const [{owner:afterOwner}]=await rows(db,`select pg_get_userbyid(relowner) owner from pg_class where oid='public.studkab_members'::regclass`);
 const [{n}]=await rows(db,'select count(*)::int n from public.studkab_members');
 assert.deepEqual(privileges,['INSERT','SELECT']);
 assert.equal(afterOwner,beforeOwner);
 assert.equal(n,1);
});

test('C-054 grants repair: forward-only файл не содержит изменения строк или структуры',()=>{
 assert.match(sql,/revoke all privileges on table public\.studkab_members from service_role/i);
 assert.match(sql,/grant select, insert on table public\.studkab_members to service_role/i);
 assert.doesNotMatch(sql,/\b(delete|update|insert\s+into|drop|truncate|alter\s+table|create\s+table)\b/i);
});
