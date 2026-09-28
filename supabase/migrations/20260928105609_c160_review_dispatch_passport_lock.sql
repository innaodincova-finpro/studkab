-- C160: serialize passport approval and paid dispatch on the same request row.
begin;

create or replace function public.studkab_gen_dispatch(p_job uuid,p_ordinal integer,p_claim uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts; j public.studkab_gen_jobs; b public.studkab_gen_budget;
 policy public.studkab_gen_policy; cost bigint; used bigint; released bigint; input_bytes bigint; output_tokens bigint; rid uuid;
begin
 select * into j from public.studkab_gen_jobs where id=p_job for update;
 select * into p from public.studkab_gen_parts where job_id=p_job and ordinal=p_ordinal;
 if not found or p.state!='claimed' or p.claim is distinct from p_claim or p.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM'; end if;
 if j.status is distinct from 'running' then
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 -- Passport approval and material changes lock the request row before they
 -- replace the approved snapshot. Hold that same row lock through reserve.
 perform pg_advisory_xact_lock(hashtextextended(j.request_id,713));
 perform 1 from public.studkab_requests r
  where r.id=j.request_id::uuid and r.deleting_at is null for share;
 if not found then
  update public.studkab_gen_jobs set status='stale' where id=p_job;
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 if not exists(select 1 from public.studkab_requirement_passports r
   where r.id=j.passport_id and r.status='approved'
   and r.source_fingerprint=coalesce(j.snapshot->'input'->>'material_fingerprint','')) then
  update public.studkab_gen_jobs set status='stale' where id=p_job;
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 -- The advisory lock also serializes with preparation of a new Word version.
 if j.snapshot#>'{input,review_target}' is not null then
  if not exists (
   select 1 from public.studkab_result_versions v
   where v.id=(j.snapshot#>>'{input,review_target,versionId}')::uuid
    and v.request_id=j.request_id::uuid
    and v.file_hash=j.snapshot#>>'{input,review_target,fileHash}'
    and j.passport_id::text=j.snapshot#>>'{input,review_target,passportId}'
    and exists(select 1 from public.studkab_requests r where r.id=v.request_id
     and length(trim(coalesce(r.payload->>'n','')))>0)
    and v.id=(select latest.id from public.studkab_result_versions latest
              where latest.request_id=j.request_id::uuid order by latest.revision desc limit 1)
  ) then
   update public.studkab_gen_jobs set status='stale' where id=p_job;
   update public.studkab_gen_parts set state='queued',claim=null,lease_until=null
    where job_id=p_job and ordinal=p_ordinal;
   return null;
  end if;
 end if;
 output_tokens=(p.spec->>'max_output_tokens')::bigint;
 select 4096
   +octet_length(coalesce(j.snapshot->'input'->>'system',''))
   +octet_length(coalesce(j.snapshot->'input'->'prompts'->>(p.spec->>'prompt_ref'),'') )
   +octet_length(coalesce(p.spec->>'prompt',''))
   +coalesce(sum(octet_length(x.result)+96),0)
 into input_bytes from public.studkab_gen_parts x
 where x.job_id=p_job and x.ordinal<p_ordinal and x.state='done'
   and (jsonb_typeof(p.spec->'section_id') is distinct from 'string'
     or x.spec->>'section_id'=p.spec->>'section_id');
 cost=(input_bytes*375+output_tokens*1500+999)/1000;
 select coalesce(sum(reservation_microusd),0) into used
 from public.studkab_gen_attempts where job_id=p_job;
 released=studkab_private.gen_job_released(p_job);
 used=used-released;
 if used<0 then raise exception 'LEDGER_MISMATCH'; end if;
 select * into policy from public.studkab_gen_policy where id=true;
 select * into b from public.studkab_gen_budget where id=true for update;
 if j.passport_id is null or j.max_cost_microusd is null or policy is null
    or cost>(p.spec->>'max_cost_microusd')::bigint
    or cost>j.max_cost_microusd-used
    or cost>least(b.limit_microusd,policy.temporary_total_microusd)-b.reserved_microusd then
  update public.studkab_gen_jobs set status='budget' where id=p_job;
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 rid=gen_random_uuid();
 update public.studkab_gen_budget set reserved_microusd=reserved_microusd+cost where id=true;
 insert into public.studkab_gen_attempts(request_id,job_id,ordinal,claim,state,reservation_microusd)
 values(rid,p_job,p_ordinal,p_claim,'sent',cost);
 update public.studkab_gen_parts set state='sent',request_id=rid,lease_until=clock_timestamp()+interval '240 seconds'
  where job_id=p_job and ordinal=p_ordinal;
 return rid;
end $$;

commit;
