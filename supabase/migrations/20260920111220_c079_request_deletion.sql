-- C-079: executor-only, retry-safe request deletion.
-- Storage objects are removed by the Edge adapter before this transaction.
alter table public.studkab_requests
  add column if not exists deleting_at timestamptz;

create index if not exists studkab_requests_visible
  on public.studkab_requests(number)
  where deleting_at is null;

create table if not exists public.studkab_request_deletion_audit (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  reason text not null check(length(reason) between 10 and 500),
  deleted_counts jsonb not null,
  deleted_at timestamptz not null default clock_timestamp()
);
alter table public.studkab_request_deletion_audit enable row level security;
revoke all on public.studkab_request_deletion_audit from public,anon,authenticated,service_role;

create or replace function public.prepare_studkab_request_delete(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claims jsonb;
  v_jobs uuid[];
  v_paths jsonb;
begin
  begin
    v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then
    v_claims:='{}'::jsonb;
  end;
  if coalesce(v_claims->>'role','')<>'service_role' then raise exception 'REQUEST_DELETE_FORBIDDEN'; end if;
  if p_request is null then raise exception 'REQUEST_DELETE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
  perform 1 from public.studkab_requests where id=p_request for update;
  if not found then return jsonb_build_object('absent',true,'paths','[]'::jsonb); end if;
  select coalesce(array_agg(id),'{}') into v_jobs from public.studkab_gen_jobs where request_id=p_request::text;
  if exists(
    select 1 from public.studkab_gen_attempts a where a.job_id=any(v_jobs)
      and not exists(select 1 from public.studkab_gen_reconciliations r where a.request_id=any(r.request_ids))
  ) then raise exception 'REQUEST_DELETE_UNRECONCILED_COST'; end if;
  update public.studkab_requests set deleting_at=coalesce(deleting_at,clock_timestamp()) where id=p_request;
  select coalesce(jsonb_agg(storage_path order by id),'[]'::jsonb) into v_paths
  from public.studkab_request_attachments where request_id=p_request;
  return jsonb_build_object('absent',false,'paths',v_paths);
end $$;

create or replace function public.delete_studkab_request(
  p_request uuid,
  p_actor uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claims jsonb;
  v_jobs uuid[];
  v_versions uuid[];
  v_reviews uuid[];
  v_counts jsonb;
begin
  begin
    v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then
    v_claims:='{}'::jsonb;
  end;
  if coalesce(v_claims->>'role','')<>'service_role' then
    raise exception 'REQUEST_DELETE_FORBIDDEN';
  end if;
  if p_request is null or p_actor is null or p_reason is null
     or length(trim(p_reason)) not between 10 and 500 then
    raise exception 'REQUEST_DELETE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
  perform 1 from public.studkab_requests where id=p_request for update;
  if not found then
    return jsonb_build_object('deleted',true,'absent',true,'id',p_request);
  end if;
  if (select deleting_at is null from public.studkab_requests where id=p_request) then
    raise exception 'REQUEST_DELETE_NOT_PREPARED';
  end if;

  select coalesce(array_agg(id),'{}') into v_jobs
  from public.studkab_gen_jobs where request_id=p_request::text;
  if exists(
    select 1 from public.studkab_gen_attempts a
    where a.job_id=any(v_jobs)
      and not exists(
        select 1 from public.studkab_gen_reconciliations r
        where a.request_id=any(r.request_ids)
      )
  ) then
    raise exception 'REQUEST_DELETE_UNRECONCILED_COST';
  end if;

  select coalesce(array_agg(id),'{}') into v_versions
  from public.studkab_result_versions where request_id=p_request;
  select coalesce(array_agg(id),'{}') into v_reviews
  from public.studkab_result_reviews where version_id=any(v_versions);
  v_counts:=jsonb_build_object(
    'attachments',(select count(*) from public.studkab_request_attachments where request_id=p_request),
    'passports',(select count(*) from public.studkab_requirement_passports where request_id=p_request),
    'versions',cardinality(v_versions),
    'reviews',cardinality(v_reviews),
    'results',(select count(*) from public.studkab_results where request_id=p_request),
    'jobs',cardinality(v_jobs),
    'parts',(select count(*) from public.studkab_gen_parts where job_id=any(v_jobs)),
    'attempts',(select count(*) from public.studkab_gen_attempts where job_id=any(v_jobs)),
    'recoveries',(select count(*) from public.studkab_gen_recoveries where job_id=any(v_jobs))
  );

  -- The three immutable-history triggers and the generation-attempt trigger are
  -- intentionally bypassed only inside this revoked, service-role-only function.
  perform set_config('session_replication_role','replica',true);
  delete from public.studkab_results
    where request_id=p_request or version_id=any(v_versions) or review_id=any(v_reviews);
  delete from public.studkab_result_reviews where id=any(v_reviews);
  delete from public.studkab_result_versions where id=any(v_versions);
  delete from public.studkab_gen_recoveries where job_id=any(v_jobs);
  delete from public.studkab_gen_attempts where job_id=any(v_jobs);
  delete from public.studkab_gen_parts where job_id=any(v_jobs);
  delete from public.studkab_gen_jobs where id=any(v_jobs);
  delete from public.studkab_requirement_passports where request_id=p_request;
  delete from public.studkab_request_attachments where request_id=p_request;
  delete from public.studkab_requests where id=p_request;
  perform set_config('session_replication_role','origin',true);

  insert into public.studkab_request_deletion_audit(request_id,actor_id,reason,deleted_counts)
  values(p_request,p_actor,trim(p_reason),v_counts)
  on conflict(request_id) do nothing;
  return jsonb_build_object('deleted',true,'absent',false,'id',p_request,'counts',v_counts);
exception when others then
  perform set_config('session_replication_role','origin',true);
  raise;
end $$;

revoke all on function public.delete_studkab_request(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.delete_studkab_request(uuid,uuid,text)
  to service_role;
revoke all on function public.prepare_studkab_request_delete(uuid)
  from public,anon,authenticated;
grant execute on function public.prepare_studkab_request_delete(uuid)
  to service_role;
