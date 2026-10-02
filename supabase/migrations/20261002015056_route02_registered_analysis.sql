-- ROUTE-02-C2. No activation or budget increase. Original fingerprints retained.
create table public.studkab_registered_analysis_blocks (
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 manifest text not null check(manifest ~ '^[a-f0-9]{64}$'),
 reason text not null check(reason in ('preparation','budget','reconciliation')),
 primary key(request_id,manifest)
);
alter table public.studkab_registered_analysis_blocks enable row level security;
revoke all on public.studkab_registered_analysis_blocks from public,anon,authenticated,service_role;
grant select,insert,update on public.studkab_registered_analysis_blocks to service_role;
create function public.studkab_intake_analysis_open_source(p_draft uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('notes',d.notes,'files',coalesce((select jsonb_agg(jsonb_build_object(
 'id',f.id,'file_name',f.file_name,'file_hash',f.file_hash,'state',f.state,
 'read_status',f.read_status,'read_version',f.read_version,'read_result',f.read_result) order by f.created_at,f.id)
 from public.studkab_intake_files f where f.draft_id=d.id and not exists(
 select 1 from public.studkab_intake_files newer where newer.supersedes=f.id and newer.state='saved')),'[]'::jsonb))
 from public.studkab_intake_drafts d where d.id=p_draft and d.state='open'
$$;

create function public.studkab_registered_analysis_source(p_request uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('requestId',r.id,'requestRevision',r.revision,'studentId',r.student_id,
 'deadline',r.payload->>'dl','notes',d.notes,'draftId',d.id,
 'files',coalesce((select jsonb_agg(jsonb_build_object(
 'id',f.id,'file_name',f.file_name,'file_hash',f.file_hash,'state',f.state,
 'read_status',f.read_status,'read_version',f.read_version,'read_result',f.read_result,
 'attachmentId',a.id,'storagePath',a.storage_path,
 'registeredReadRequest',f.registered_read_request,'registeredReadRevision',f.registered_read_revision) order by f.created_at,f.id)
 from public.studkab_request_attachments a join public.studkab_intake_files f on f.id=a.intake_file_id
 where a.request_id=r.id and a.student_id=r.student_id and f.draft_id=d.id
 and f.state='saved' and a.file_hash=f.file_hash and a.storage_path=f.storage_path
 and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id)), '[]'::jsonb))
 from public.studkab_requests r join public.studkab_intake_drafts d on d.submitted_request_id=r.id
 where r.id=p_request and r.intake_received and r.ready_at is not null and r.deleting_at is null
 and d.state='submitted' and d.student_id=r.student_id and d.submitted_request_revision=r.revision
 and exists(select 1 from public.studkab_members m where m.user_id=r.student_id)
 -- Every current attachment must be a matching original from this saved submission.
 and not exists(select 1 from public.studkab_request_attachments a
 left join public.studkab_intake_files f on f.id=a.intake_file_id
 where a.request_id=r.id and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id)
 and (a.student_id is distinct from r.student_id or f.draft_id is distinct from d.id
 or f.state is distinct from 'saved' or a.file_hash is distinct from f.file_hash
 or a.storage_path is distinct from f.storage_path or (f.read_status='ready' and (
 (f.registered_read_request is not null and (f.registered_read_request is distinct from r.id or f.registered_read_revision is distinct from r.revision))
 or f.read_result->>'fileId' is distinct from f.id::text or f.read_result->>'fileHash' is distinct from f.file_hash))))
$$;
create or replace function public.studkab_intake_analysis_source(p_draft uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when d.state='open' then public.studkab_intake_analysis_open_source(d.id)
 when d.state='submitted' then public.studkab_registered_analysis_source(d.submitted_request_id) end
 from public.studkab_intake_drafts d where d.id=p_draft
$$;
create or replace function public.studkab_intake_analysis_snapshot(p_student uuid,p_draft uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb;
begin
 perform 1 from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state in ('open','submitted') for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 src=public.studkab_intake_analysis_source(p_draft);
 if src is null then return jsonb_build_object('missing',true); end if;
 if jsonb_array_length(src->'files')=0 or exists(select 1 from jsonb_array_elements(src->'files') f
 where f->>'state' is distinct from 'saved' or f->>'read_status' is distinct from 'ready'
 or f->'read_result'->>'status' is distinct from 'ready'
 or f->'read_result'->>'readerVersion' is distinct from f->>'read_version') then return jsonb_build_object('unread',true); end if;
 if octet_length(src::text)>16000000 then return jsonb_build_object('limited',true); end if;
 return src||jsonb_build_object('manifest',encode(sha256(convert_to(src::text,'UTF8')),'hex'));
end $$;
create function public.studkab_registered_analysis_next() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r record; src jsonb; m text;
begin
 if not exists(select 1 from public.studkab_intake_analysis_policy where id and enabled and limit_microusd>0) then return null; end if;
 for r in select id from public.studkab_requests where intake_received and ready_at is not null and deleting_at is null order by exists(select 1 from public.studkab_registered_analysis_blocks b where b.request_id=studkab_requests.id and b.reason='budget'),created_at,id loop
  src=public.studkab_registered_analysis_source(r.id);
  if src is null or jsonb_array_length(src->'files')=0 or octet_length(src::text)>16000000
  or exists(select 1 from jsonb_array_elements(src->'files') f where f->>'read_status' is distinct from 'ready' or f->'read_result'->>'status' is distinct from 'ready') then continue; end if;
  m=encode(sha256(convert_to(src::text,'UTF8')),'hex');
  if not exists(select 1 from public.studkab_registered_analysis_blocks where request_id=r.id and manifest=m and reason in ('preparation','reconciliation')) and not exists(select 1 from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid and manifest=m and version='intake-analysis-2') then
   return src||jsonb_build_object('manifest',m);
  end if;
 end loop;
 return null;
end $$;
create function public.studkab_registered_analysis_start(p_request uuid,p_manifest text,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; src jsonb; b public.studkab_gen_budget; policy public.studkab_intake_analysis_policy; cost bigint; used bigint; j public.studkab_intake_analysis_jobs;
begin
 select * into r from public.studkab_requests where id=p_request for update;
 perform 1 from public.studkab_intake_drafts where submitted_request_id=p_request for update;
 src=public.studkab_registered_analysis_source(p_request);
 if src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex') is distinct from p_manifest then return jsonb_build_object('stale',true); end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid and manifest=p_manifest and version='intake-analysis-2';
 if found then return jsonb_build_object('id',j.id,'state',j.state); end if;
 -- Reuse already paid, verified output when the exact source-bound plan matches.
 -- Extra receipt metadata does not justify buying the same analysis again.
 select * into j from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid
 and version='intake-analysis-2' and state='done' and plan=p_plan order by created_at limit 1;
 if found then
  insert into public.studkab_intake_analysis_jobs(draft_id,manifest,version,plan,state,ordinal,part_results,raw_outputs,result)
  values(j.draft_id,p_manifest,j.version,j.plan,'done',j.ordinal,j.part_results,jsonb_build_array(jsonb_build_object('reused_analysis_id',j.id)),j.result)
  returning * into j;
  return jsonb_build_object('id',j.id,'state',j.state,'reused',true);
 end if;
 if exists(select 1 from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid
 and plan=p_plan and reserved_microusd>0 and state<>'done') then
  insert into public.studkab_registered_analysis_blocks(request_id,manifest,reason) values(p_request,p_manifest,'reconciliation') on conflict(request_id,manifest) do update set reason='reconciliation';
  return jsonb_build_object('reconciliation',true);
 end if;
 select * into policy from public.studkab_intake_analysis_policy where id;
 if policy.enabled is distinct from true or coalesce(policy.limit_microusd,0)<=0 then return jsonb_build_object('disabled',true); end if;
 if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) not between 1 and 120 then return jsonb_build_object('invalid',true); end if;
 if exists(select 1 from jsonb_array_elements(p_plan) p where coalesce(p->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$') then return jsonb_build_object('invalid',true); end if;
 select sum((p->>'max_cost_microusd')::bigint) into cost from jsonb_array_elements(p_plan) p;
 select * into b from public.studkab_gen_budget where id for update;
 select coalesce(sum(reserved_microusd),0) into used from public.studkab_intake_analysis_jobs;
 if b.id is null or cost>policy.limit_microusd-used or cost>b.limit_microusd-b.reserved_microusd then
  insert into public.studkab_registered_analysis_blocks(request_id,manifest,reason) values(p_request,p_manifest,'budget') on conflict(request_id,manifest) do update set reason='budget';
  return jsonb_build_object('budget',true);
 end if;
 -- Existing start validates bounded parts; dispatch checks actual ledger and reserves.
 return public.studkab_intake_analysis_start(r.student_id,(src->>'draftId')::uuid,p_manifest,p_plan);
end $$;
create function public.studkab_registered_analysis_state(p_request uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb; j public.studkab_intake_analysis_jobs; d uuid; reads jsonb;
begin
 if not exists(select 1 from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) where u.id=p_actor) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.studkab_requests where id=p_request and intake_received and ready_at is not null and deleting_at is null;
 if not found then return jsonb_build_object('missing',true); end if;
 src=public.studkab_registered_analysis_source(p_request);
 if src is null then return jsonb_build_object('state','stale'); end if;
 d=(src->>'draftId')::uuid;
 select jsonb_agg(jsonb_build_object('id',f->>'id','name',f->>'file_name','status',f->>'read_status','category',(select category from public.studkab_request_attachments where id=(f->>'attachmentId')::uuid)) ) into reads from jsonb_array_elements(src->'files') f;
 if jsonb_array_length(src->'files')=0 or exists(select 1 from jsonb_array_elements(src->'files') f where f->>'read_status' is distinct from 'ready') then return jsonb_build_object('state','reading_blocked','files',reads); end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=d and manifest=encode(sha256(convert_to(src::text,'UTF8')),'hex') and version='intake-analysis-2';
 if not found then return jsonb_build_object('state',coalesce((select case when reason='preparation' then 'preparation_blocked' when reason='reconciliation' then 'unknown' else 'budget' end from public.studkab_registered_analysis_blocks where request_id=p_request and manifest=encode(sha256(convert_to(src::text,'UTF8')),'hex')),case when exists(select 1 from public.studkab_intake_analysis_policy where id and enabled and limit_microusd>0) then 'awaiting_analysis' else 'disabled' end),'files',reads); end if;
 return jsonb_build_object('state',j.state,'analysisId',j.id,'manifest',j.manifest,'files',reads,'completed',j.ordinal,'parts',jsonb_array_length(j.plan),'result',case when j.state='done' then j.result else null end);
end $$;
revoke all on function public.studkab_intake_analysis_open_source(uuid),public.studkab_registered_analysis_source(uuid),public.studkab_registered_analysis_next(),public.studkab_registered_analysis_start(uuid,text,jsonb),public.studkab_registered_analysis_state(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studkab_intake_analysis_open_source(uuid),public.studkab_registered_analysis_source(uuid),public.studkab_registered_analysis_next(),public.studkab_registered_analysis_start(uuid,text,jsonb),public.studkab_registered_analysis_state(uuid,uuid) to service_role;

create or replace function public.studkab_intake_analysis_dispatch(p_job uuid,p_claim uuid,p_cost bigint) returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; b public.studkab_gen_budget; policy public.studkab_intake_analysis_policy; rid uuid; total bigint; src jsonb;
begin
 -- Same lock order as registration/material changes: request, draft, job, budget.
 perform 1 from public.studkab_requests where id=(select d.submitted_request_id
 from public.studkab_intake_drafts d join public.studkab_intake_analysis_jobs queued_job on queued_job.draft_id=d.id where queued_job.id=p_job) for update;
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

create or replace function public.studkab_intake_analysis_finish(p_job uuid,p_claim uuid,p_request uuid,p_part jsonb,p_result jsonb,p_raw text,p_error text) returns text language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; src jsonb; s text;
begin
 -- Same lock order as registration/material changes: request, draft, job, budget.
 perform 1 from public.studkab_requests where id=(select d.submitted_request_id
 from public.studkab_intake_drafts d join public.studkab_intake_analysis_jobs queued_job on queued_job.draft_id=d.id where queued_job.id=p_job) for update;
 perform 1 from public.studkab_intake_drafts where id=(select draft_id from public.studkab_intake_analysis_jobs where id=p_job) for update;
 select * into j from public.studkab_intake_analysis_jobs where id=p_job for update;
 if not found or j.state<>'sent' or j.claim is distinct from p_claim or j.provider_request_id is distinct from p_request or j.lease_until<=clock_timestamp() then raise exception 'STALE_RESULT'; end if;
 if octet_length(p_raw)>100000 or octet_length(p_part::text)>2000000 or octet_length(p_result::text)>4000000 then raise exception 'RESULT_TOO_BIG'; end if;
 src=public.studkab_intake_analysis_source(j.draft_id);
 s=case when p_error='length' then 'output_limited' when p_error='invalid' then 'invalid' when p_part is null then 'unknown'
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


create function public.studkab_registered_analysis_block(p_request uuid,p_manifest text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare src jsonb;
begin
 perform 1 from public.studkab_requests where id=p_request for update;
 src=public.studkab_registered_analysis_source(p_request);
 if src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex') is distinct from p_manifest then return false;end if;
 insert into public.studkab_registered_analysis_blocks(request_id,manifest,reason) values(p_request,p_manifest,'preparation') on conflict(request_id,manifest) do update set reason='preparation';
 return true;
end $$;
revoke all on function public.studkab_registered_analysis_block(uuid,text) from public,anon,authenticated;
grant execute on function public.studkab_registered_analysis_block(uuid,text) to service_role;
