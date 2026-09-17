-- R1/R2/R4: persist deterministic preparation failures atomically and keep them
-- terminal. Existing jobs and results are not rewritten.
alter table public.studkab_gen_parts
 add column failure_stage text check (failure_stage in ('preparation')),
 add column failure_reason text check (failure_reason in ('CONTEXT_TOO_BIG','PREPARATION_UNAVAILABLE')),
 add column failure_count integer not null default 0 check (failure_count>=0),
 add column failure_at timestamptz;

create function public.studkab_gen_fail_preparation(
 p_job uuid,p_ordinal integer,p_claim uuid,p_reason text
) returns text language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts;
begin
 if p_reason not in ('CONTEXT_TOO_BIG','PREPARATION_UNAVAILABLE') then
  raise exception 'INVALID_PREPARATION_REASON';
 end if;
 perform 1 from public.studkab_gen_jobs where id=p_job for update;
 if not found then raise exception 'JOB_NOT_FOUND'; end if;
 select * into p from public.studkab_gen_parts
  where job_id=p_job and ordinal=p_ordinal for update;
 if not found or p.state!='claimed' or p.claim is distinct from p_claim
    or p.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM'; end if;
 update public.studkab_gen_parts set state='unknown',failure_stage='preparation',
  failure_reason=p_reason,failure_count=failure_count+1,failure_at=clock_timestamp(),
  lease_until=null
  where job_id=p_job and ordinal=p_ordinal;
 update public.studkab_gen_jobs set status='unknown' where id=p_job;
 return p_reason;
end
$$;
revoke all on function public.studkab_gen_fail_preparation(uuid,integer,uuid,text)
 from public,anon,authenticated;
grant execute on function public.studkab_gen_fail_preparation(uuid,integer,uuid,text)
 to service_role;

-- Deterministic preparation failures are terminal. Recovery remains available for
-- provider results whose receipt is genuinely unknown, with the existing two-attempt cap.
create or replace function public.studkab_gen_recover_unknown()
returns integer language plpgsql security invoker set search_path='' as $$
declare p record; n integer=0; tries integer;
begin
 for p in
  select x.* from public.studkab_gen_parts x
  join public.studkab_gen_jobs j on j.id=x.job_id
  where x.state='unknown' and x.failure_stage is null
    and j.status not in ('cancelled','stale')
  order by x.job_id,x.ordinal limit 200
 loop
  select count(*) into tries from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal;
  if tries>=2 then continue; end if;
  if exists(select 1 from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal and t.state='sent') then continue; end if;
  if exists(select 1 from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal and t.detail->>'finish_reason'='length') then continue; end if;
  update public.studkab_gen_parts
   set state='queued',claim=null,lease_until=null,request_id=null
   where job_id=p.job_id and ordinal=p.ordinal and state='unknown' and failure_stage is null;
  if found then
   insert into public.studkab_gen_recoveries(job_id,ordinal,attempts_before)
    values(p.job_id,p.ordinal,tries);
   n=n+1;
  end if;
 end loop;
 update public.studkab_gen_jobs j set status='queued'
 where j.status='unknown'
 and not exists(select 1 from public.studkab_gen_parts x
  where x.job_id=j.id and x.state='unknown');
 return n;
end
$$;
revoke all on function public.studkab_gen_recover_unknown()
 from public,anon,authenticated,service_role;
