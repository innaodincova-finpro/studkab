-- R15 / INTAKE-01 step 4. Private semantic queue; disabled until an operator
-- sets an authorized numeric policy. No request/passport is created or approved.
create table public.studkab_intake_analysis_policy (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 limit_microusd bigint not null default 0 check(limit_microusd>=0)
);
insert into public.studkab_intake_analysis_policy(id) values(true);
create table public.studkab_intake_analysis_jobs (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.studkab_intake_drafts(id),
 manifest text not null check(manifest ~ '^[a-f0-9]{64}$'),
 version text not null check(version='intake-analysis-1'),
 plan jsonb not null check(jsonb_typeof(plan)='array' and jsonb_array_length(plan) between 1 and 120),
 state text not null default 'queued' check(state in ('queued','claimed','sent','unknown','budget','done','invalid','stale')),
 ordinal integer not null default 0 check(ordinal>=0),
 claim uuid, lease_until timestamptz, provider_request_id uuid,
 reserved_microusd bigint not null default 0 check(reserved_microusd>=0),
 part_results jsonb not null default '[]', raw_outputs jsonb not null default '[]',
 result jsonb, created_at timestamptz not null default now(),
 unique(draft_id,manifest,version)
);
create index studkab_intake_analysis_queue on public.studkab_intake_analysis_jobs(created_at) where state in ('queued','claimed','sent','budget');
alter table public.studkab_intake_analysis_policy enable row level security;
alter table public.studkab_intake_analysis_jobs enable row level security;
revoke all on public.studkab_intake_analysis_policy,public.studkab_intake_analysis_jobs from public,anon,authenticated;
grant select on public.studkab_intake_analysis_policy to service_role;
grant select,insert,update on public.studkab_intake_analysis_jobs to service_role;
create function public.studkab_intake_analysis_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.draft_id,new.manifest,new.version,new.plan,new.created_at) is distinct from
    (old.id,old.draft_id,old.manifest,old.version,old.plan,old.created_at)
 or new.reserved_microusd<old.reserved_microusd then raise exception 'IMMUTABLE_INTAKE_ANALYSIS'; end if;
 if old.state in ('done','unknown','invalid','stale') and new is distinct from old then raise exception 'TERMINAL_INTAKE_ANALYSIS'; end if;
 return new;
end $$;
create trigger immutable_intake_analysis before update on public.studkab_intake_analysis_jobs for each row execute function public.studkab_intake_analysis_immutable();
-- Internal fingerprint includes source content, not only the upload hash: a new
-- reader result, notes, pending upload or saved replacement invalidates output.
create function public.studkab_intake_analysis_source(p_draft uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('notes',d.notes,'files',coalesce((select jsonb_agg(jsonb_build_object(
 'id',f.id,'file_name',f.file_name,'file_hash',f.file_hash,'state',f.state,
 'read_status',f.read_status,'read_version',f.read_version,'read_result',f.read_result) order by f.created_at,f.id)
 from public.studkab_intake_files f where f.draft_id=d.id and not exists(
 select 1 from public.studkab_intake_files newer where newer.supersedes=f.id and newer.state='saved')),'[]'::jsonb))
 from public.studkab_intake_drafts d where d.id=p_draft and d.state='open'
$$;
create function public.studkab_intake_analysis_snapshot(p_student uuid,p_draft uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare src jsonb; m text;
begin
 perform 1 from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open' for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 src=public.studkab_intake_analysis_source(p_draft);
 if jsonb_array_length(src->'files')=0 or exists(select 1 from jsonb_array_elements(src->'files') f where f->>'state'<>'saved' or f->>'read_status' is distinct from 'ready') then return jsonb_build_object('unread',true); end if;
 if octet_length(src::text)>16000000 then return jsonb_build_object('limited',true); end if;
 m=encode(sha256(convert_to(src::text,'UTF8')),'hex');
 return src||jsonb_build_object('manifest',m);
end $$;
create function public.studkab_intake_analysis_start(p_student uuid,p_draft uuid,p_manifest text,p_plan jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare src jsonb; j public.studkab_intake_analysis_jobs; x jsonb;
begin
 src=public.studkab_intake_analysis_snapshot(p_student,p_draft);
 if src ? 'missing' or src ? 'unread' or src ? 'limited' then return src; end if;
 if src->>'manifest' is distinct from p_manifest then return jsonb_build_object('conflict',true); end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=p_manifest and version='intake-analysis-1';
 if found then return jsonb_build_object('id',j.id,'state',j.state); end if;
 if not exists(select 1 from public.studkab_intake_analysis_policy where id and enabled and limit_microusd>0) then return jsonb_build_object('disabled',true); end if;
 if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) not between 1 and 120 or octet_length(p_plan::text)>16000000 then return jsonb_build_object('limited',true); end if;
 for x in select value from jsonb_array_elements(p_plan) loop
  if jsonb_typeof(x->'blocks') is distinct from 'array' or coalesce(x->>'prompt','')='' or octet_length(x->>'prompt')>40000 or x->>'max_output_tokens' is distinct from '4000' or coalesce(x->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$' then return jsonb_build_object('invalid',true); end if;
 end loop;
 insert into public.studkab_intake_analysis_jobs(draft_id,manifest,version,plan) values(p_draft,p_manifest,'intake-analysis-1',p_plan) returning * into j;
 return jsonb_build_object('id',j.id,'state',j.state);
end $$;
create function public.studkab_intake_analysis_state(p_student uuid,p_draft uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare src jsonb; m text; j public.studkab_intake_analysis_jobs;
begin
 perform 1 from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open';
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 src=public.studkab_intake_analysis_source(p_draft);m=encode(sha256(convert_to(src::text,'UTF8')),'hex');
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=m and version='intake-analysis-1';
 if not found then return jsonb_build_object('state',case when exists(select 1 from public.studkab_intake_analysis_jobs where draft_id=p_draft) then 'stale' else 'idle' end); end if;
 return jsonb_build_object('id',j.id,'state',j.state,'completed',j.ordinal,'parts',jsonb_array_length(j.plan),'result',case when j.state='done' then j.result else null end);
end $$;
create function public.studkab_intake_analysis_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; src jsonb; c uuid;
begin
 for j in select * from public.studkab_intake_analysis_jobs where state in ('queued','claimed','sent','budget') order by created_at for update skip locked loop
  if j.state='sent' then
   if j.lease_until<=clock_timestamp() then update public.studkab_intake_analysis_jobs set state='unknown' where id=j.id; end if;
   continue;
  end if;
  if j.state='claimed' and j.lease_until>clock_timestamp() then continue; end if;
  src=public.studkab_intake_analysis_source(j.draft_id);
  if src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex')<>j.manifest or not exists(select 1 from public.studkab_members m join public.studkab_intake_drafts d on d.student_id=m.user_id where d.id=j.draft_id) then
   update public.studkab_intake_analysis_jobs set state='stale' where id=j.id;continue;
  end if;
  if not exists(select 1 from public.studkab_intake_analysis_policy where id and enabled and limit_microusd>0) then continue; end if;
  c=gen_random_uuid();update public.studkab_intake_analysis_jobs set state='claimed',claim=c,lease_until=clock_timestamp()+interval '240 seconds' where id=j.id;
  return jsonb_build_object('job_id',j.id,'claim',c,'ordinal',j.ordinal,'part',j.plan->j.ordinal,'parts',jsonb_array_length(j.plan),'previous',j.part_results);
 end loop;
 return null;
end $$;
create function public.studkab_intake_analysis_fail_claim(p_job uuid,p_claim uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.studkab_intake_analysis_jobs set state='invalid',lease_until=null,raw_outputs=raw_outputs||jsonb_build_array(jsonb_build_object('error','preparation'))
 where id=p_job and state='claimed' and claim=p_claim and lease_until>clock_timestamp();
 return found;
end $$;
-- Preserve the existing generation ledger; intake reserves are retained in full.
-- No automatic release, writeoff or repeat payment after an unknown outcome.
create or replace function public.studkab_gen_expected_reserved() returns bigint language sql stable security invoker set search_path='' as $$
 select coalesce((select sum(a.reservation_microusd) from public.studkab_gen_attempts a where not exists(select 1 from public.studkab_gen_reconciliations r where a.request_id=any(r.request_ids))),0)
 +coalesce((select sum(r.retained_microusd) from public.studkab_gen_reconciliations r),0)
 +coalesce((select sum(j.reserved_microusd) from public.studkab_intake_analysis_jobs j),0)
$$;
revoke all on function public.studkab_gen_expected_reserved() from public,anon,authenticated,service_role;
create function public.studkab_intake_analysis_dispatch(p_job uuid,p_claim uuid,p_cost bigint) returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; b public.studkab_gen_budget; policy public.studkab_intake_analysis_policy; rid uuid; total bigint; src jsonb;
begin
 perform 1 from public.studkab_intake_drafts where id=(select draft_id from public.studkab_intake_analysis_jobs where id=p_job) for update;
 select * into j from public.studkab_intake_analysis_jobs where id=p_job for update;
 if not found or j.state<>'claimed' or j.claim is distinct from p_claim or j.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM'; end if;
 src=public.studkab_intake_analysis_source(j.draft_id);
 if src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex')<>j.manifest or not exists(select 1 from public.studkab_members m join public.studkab_intake_drafts d on d.student_id=m.user_id where d.id=j.draft_id) then update public.studkab_intake_analysis_jobs set state='stale' where id=j.id;return null; end if;
 if p_cost is null or p_cost<=0 or p_cost<>(j.plan->j.ordinal->>'max_cost_microusd')::bigint then raise exception 'INVALID_RESERVE'; end if;
 select * into b from public.studkab_gen_budget where id for update;
 if not found or b.reserved_microusd<>(
 coalesce((select sum(a.reservation_microusd) from public.studkab_gen_attempts a where not exists(select 1 from public.studkab_gen_reconciliations r where a.request_id=any(r.request_ids))),0)
 +coalesce((select sum(r.retained_microusd) from public.studkab_gen_reconciliations r),0)
 +coalesce((select sum(x.reserved_microusd) from public.studkab_intake_analysis_jobs x),0)) then raise exception 'LEDGER_MISMATCH'; end if;
 select * into policy from public.studkab_intake_analysis_policy where id;
 select coalesce(sum(reserved_microusd),0) into total from public.studkab_intake_analysis_jobs;
 if policy.enabled is distinct from true or policy.limit_microusd is null or p_cost>policy.limit_microusd-total or p_cost>b.limit_microusd-b.reserved_microusd then
  update public.studkab_intake_analysis_jobs set state='budget',claim=null,lease_until=null where id=j.id;return null;
 end if;
 rid=gen_random_uuid();update public.studkab_gen_budget set reserved_microusd=reserved_microusd+p_cost where id;
 update public.studkab_intake_analysis_jobs set state='sent',provider_request_id=rid,reserved_microusd=reserved_microusd+p_cost,lease_until=clock_timestamp()+interval '240 seconds' where id=j.id;
 return rid;
end $$;
create function public.studkab_intake_analysis_finish(p_job uuid,p_claim uuid,p_request uuid,p_part jsonb,p_result jsonb,p_raw text,p_error text) returns text language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; src jsonb; s text;
begin
 perform 1 from public.studkab_intake_drafts where id=(select draft_id from public.studkab_intake_analysis_jobs where id=p_job) for update;
 select * into j from public.studkab_intake_analysis_jobs where id=p_job for update;
 if not found or j.state<>'sent' or j.claim is distinct from p_claim or j.provider_request_id is distinct from p_request or j.lease_until<=clock_timestamp() then raise exception 'STALE_RESULT'; end if;
 if octet_length(p_raw)>100000 or octet_length(p_part::text)>2000000 or octet_length(p_result::text)>4000000 then raise exception 'RESULT_TOO_BIG'; end if;
 src=public.studkab_intake_analysis_source(j.draft_id);
 s=case when p_error='invalid' then 'invalid' when p_part is null then 'unknown'
 when src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex')<>j.manifest then 'stale'
 when j.ordinal+1=jsonb_array_length(j.plan) then 'done' else 'queued' end;
 if s in ('queued','done') and (jsonb_typeof(p_part->'candidates') is distinct from 'array' or jsonb_typeof(p_part->'roles') is distinct from 'array') then raise exception 'INVALID_RESULT'; end if;
 if s='done' and (p_result->>'analysisVersion' is distinct from j.version or p_result->>'status' is distinct from 'candidate') then raise exception 'INVALID_RESULT'; end if;
 update public.studkab_intake_analysis_jobs set state=s,ordinal=ordinal+case when s in ('done','queued') then 1 else 0 end,
 part_results=part_results||case when s in ('done','queued') then jsonb_build_array(p_part) else '[]'::jsonb end,
 raw_outputs=raw_outputs||jsonb_build_array(jsonb_build_object('request_id',p_request,'text',p_raw,'error',p_error)),
 result=case when s='done' then p_result else null end,lease_until=null where id=j.id;
 return s;
end $$;
revoke all on function public.studkab_intake_analysis_immutable(),public.studkab_intake_analysis_source(uuid),public.studkab_intake_analysis_snapshot(uuid,uuid),public.studkab_intake_analysis_start(uuid,uuid,text,jsonb),public.studkab_intake_analysis_state(uuid,uuid),public.studkab_intake_analysis_claim(),public.studkab_intake_analysis_dispatch(uuid,uuid,bigint),public.studkab_intake_analysis_finish(uuid,uuid,uuid,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.studkab_intake_analysis_source(uuid),public.studkab_intake_analysis_snapshot(uuid,uuid),public.studkab_intake_analysis_start(uuid,uuid,text,jsonb),public.studkab_intake_analysis_state(uuid,uuid),public.studkab_intake_analysis_claim(),public.studkab_intake_analysis_dispatch(uuid,uuid,bigint),public.studkab_intake_analysis_finish(uuid,uuid,uuid,jsonb,jsonb,text,text) to service_role;

revoke all on function public.studkab_intake_analysis_fail_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studkab_intake_analysis_fail_claim(uuid,uuid) to service_role;
