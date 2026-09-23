-- C-095. Supabase production role postgres cannot SET session_replication_role.
-- Permit the narrowly scoped, prepared request deletion without disabling FK triggers.

create or replace function public.studkab_result_immutable()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_request uuid;
begin
  if tg_op='DELETE' and current_user='postgres' then
    if tg_table_name='studkab_results' then
      v_request:=old.request_id;
    elsif tg_table_name='studkab_result_versions' then
      v_request:=old.request_id;
    elsif tg_table_name='studkab_result_reviews' then
      select v.request_id into v_request
      from public.studkab_result_versions v
      where v.id=old.version_id;
    end if;
    if v_request is not null and exists(
      select 1 from public.studkab_requests r
      where r.id=v_request and r.deleting_at is not null
    ) then
      return old;
    end if;
  end if;
  raise exception 'Immutable result history';
end $$;

alter function public.studkab_result_immutable() owner to postgres;
revoke all on function public.studkab_result_immutable() from public,anon,authenticated;
grant execute on function public.studkab_result_immutable() to service_role;

create or replace function public.studkab_gen_attempt_financial_immutable()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    if current_user='postgres' and exists(
      select 1 from public.studkab_requests r
      where r.id=old.request_id and r.deleting_at is not null
    ) then
      return old;
    end if;
    raise exception 'IMMUTABLE_GENERATION_ATTEMPT';
  end if;
  if (new.request_id,new.job_id,new.ordinal,new.reservation_microusd,new.started_at)
     is distinct from
     (old.request_id,old.job_id,old.ordinal,old.reservation_microusd,old.started_at)
  then
    raise exception 'IMMUTABLE_GENERATION_ATTEMPT';
  end if;
  return new;
end $$;

alter function public.studkab_gen_attempt_financial_immutable() owner to postgres;
revoke all on function public.studkab_gen_attempt_financial_immutable() from public,anon,authenticated,service_role;

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
    'clarifications',(select count(*) from public.studkab_clarifications where request_id=p_request),
    'payload_history',(select count(*) from public.studkab_request_payload_history where request_id=p_request),
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

  delete from public.studkab_results
    where request_id=p_request or version_id=any(v_versions) or review_id=any(v_reviews);
  delete from public.studkab_result_reviews where id=any(v_reviews);
  delete from public.studkab_result_versions where id=any(v_versions);
  delete from public.studkab_gen_recoveries where job_id=any(v_jobs);
  delete from public.studkab_gen_attempts where job_id=any(v_jobs);
  delete from public.studkab_gen_parts where job_id=any(v_jobs);
  delete from public.studkab_gen_jobs where id=any(v_jobs);
  delete from public.studkab_clarifications where request_id=p_request;
  delete from public.studkab_requirement_passports where request_id=p_request;
  delete from public.studkab_request_attachments where request_id=p_request;
  delete from public.studkab_request_payload_history where request_id=p_request;
  delete from public.studkab_requests where id=p_request;

  insert into public.studkab_request_deletion_audit(request_id,actor_id,reason,deleted_counts)
  values(p_request,p_actor,trim(p_reason),v_counts)
  on conflict(request_id) do nothing;
  return jsonb_build_object('deleted',true,'absent',false,'id',p_request,'counts',v_counts);
end $$;

alter function public.delete_studkab_request(uuid,uuid,text) owner to postgres;
revoke all on function public.delete_studkab_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.delete_studkab_request(uuid,uuid,text) to service_role;

do $$
begin
  if pg_get_userbyid((select proowner from pg_proc where oid='public.delete_studkab_request(uuid,uuid,text)'::regprocedure))<>'postgres' then
    raise exception 'C095_DELETE_OWNER';
  end if;
  if not (select prosecdef from pg_proc where oid='public.delete_studkab_request(uuid,uuid,text)'::regprocedure) then
    raise exception 'C095_DELETE_NOT_SECURITY_DEFINER';
  end if;
  if has_function_privilege('anon','public.delete_studkab_request(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.delete_studkab_request(uuid,uuid,text)','EXECUTE') then
    raise exception 'C095_DELETE_PUBLICLY_EXECUTABLE';
  end if;
  if not has_function_privilege('service_role','public.delete_studkab_request(uuid,uuid,text)','EXECUTE') then
    raise exception 'C095_DELETE_SERVICE_ROLE_MISSING';
  end if;
  if position('session_replication_role' in pg_get_functiondef('public.delete_studkab_request(uuid,uuid,text)'::regprocedure))>0 then
    raise exception 'C095_REPLICA_ROLE_REMAINED';
  end if;
end $$;
