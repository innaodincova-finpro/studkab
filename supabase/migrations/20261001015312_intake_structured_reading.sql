-- INTAKE-01 step 3: one persisted reading per immutable file and reader version.
alter table public.studkab_intake_files
 add column read_version text,
 add column read_status text not null default 'idle' check(read_status in ('idle','reading','ready','blocked','failed')),
 add column read_lease uuid,
 add column read_until timestamptz,
 add column read_result jsonb,
 add column extracted_text text;
create function public.studkab_intake_read_begin(p_student uuid,p_draft uuid,p_file uuid,p_version text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare f public.studkab_intake_files; d public.studkab_intake_drafts;
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open' for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select * into f from public.studkab_intake_files where id=p_file and draft_id=p_draft and state='saved' for update;
 if not found then return jsonb_build_object('missing',true); end if;
 if p_version is null or p_version !~ '^[a-z0-9-]{1,60}$' then return jsonb_build_object('invalid',true); end if;
 if f.read_version=p_version and f.read_status in ('ready','blocked') then return jsonb_build_object('cached',true,'file',to_jsonb(f)); end if;
 if f.read_status='reading' and f.read_until>now() then return jsonb_build_object('busy',true); end if;
 update public.studkab_intake_files set read_status='reading',read_version=p_version,read_lease=gen_random_uuid(),read_until=now()+interval '90 seconds',read_result=null,extracted_text=null
 where id=p_file returning * into f;
 return jsonb_build_object('file',to_jsonb(f));
end $$;
create function public.studkab_intake_read_finish(p_student uuid,p_draft uuid,p_file uuid,p_lease uuid,p_version text,p_result jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare f public.studkab_intake_files; d public.studkab_intake_drafts;
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open' for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select * into f from public.studkab_intake_files where id=p_file and draft_id=p_draft and state='saved' for update;
 if not found then return jsonb_build_object('missing',true); end if;
 if f.read_lease is distinct from p_lease or f.read_version is distinct from p_version or f.read_status<>'reading' then return jsonb_build_object('conflict',true); end if;
 if p_result is null or jsonb_typeof(p_result)<>'object' or p_result->>'readerVersion' is distinct from p_version
 or p_result->>'fileId' is distinct from p_file::text or p_result->>'fileHash' is distinct from f.file_hash
 or jsonb_typeof(p_result->'status') is distinct from 'string'
 or p_result->>'status' not in ('ready','blocked','failed') or not (p_result ? 'status')
 or jsonb_typeof(p_result->'blocks') is distinct from 'array' or jsonb_typeof(p_result->'warnings') is distinct from 'array'
 or jsonb_typeof(p_result->'extracted_text') is distinct from 'string' or length(p_result->>'extracted_text')>500000
 or octet_length(p_result::text)>6000000 then return jsonb_build_object('invalid',true); end if;
 update public.studkab_intake_files set read_status=p_result->>'status',read_result=p_result,extracted_text=p_result->>'extracted_text',read_until=null where id=p_file returning * into f;
 return jsonb_build_object('file',to_jsonb(f));
end $$;
revoke all on function public.studkab_intake_read_begin(uuid,uuid,uuid,text),public.studkab_intake_read_finish(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_intake_read_begin(uuid,uuid,uuid,text),public.studkab_intake_read_finish(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
