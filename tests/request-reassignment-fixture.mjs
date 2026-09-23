import {readFileSync} from 'node:fs';
import {setupSQL} from './material-revision-fixture.mjs';
export const migration='20260923132840_c100_request_reassignment.sql';
export function reassignmentSetupSQL(){
 return setupSQL()+`\nalter table auth.users add column email_confirmed_at timestamptz default now(),add column is_anonymous boolean default false,add column deleted_at timestamptz,add column banned_until timestamptz;
 create table public.app_data(user_id uuid references auth.users(id),app text,data jsonb,rev bigint default 1,updated_at timestamptz default now(),primary key(user_id,app));
 `+['20260923082944_c098_material_manifest.sql','20260923120254_c099_test_delivery.sql',migration].map(f=>readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8')).join('\n');
}
