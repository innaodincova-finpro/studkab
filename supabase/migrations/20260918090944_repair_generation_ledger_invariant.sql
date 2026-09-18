-- C-062: reconciliations are append-only and can outlive operational attempts.
-- The canonical retained reserve is therefore:
--   unreconciled attempt reservations + all immutable reconciled retainers.
create or replace function public.studkab_gen_expected_reserved()
returns bigint language sql stable security invoker set search_path='' as $$
 select
  coalesce((select sum(a.reservation_microusd)
   from public.studkab_gen_attempts a
   where not exists(select 1 from public.studkab_gen_reconciliations r
    where a.request_id=any(r.request_ids))),0)
  +coalesce((select sum(r.retained_microusd)
   from public.studkab_gen_reconciliations r),0)
$$;
revoke all on function public.studkab_gen_expected_reserved() from public,anon,authenticated,service_role;

create or replace function public.studkab_gen_attempt_financial_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_GENERATION_ATTEMPT'; end if;
 if (new.request_id,new.job_id,new.ordinal,new.reservation_microusd,new.started_at)
   is distinct from
   (old.request_id,old.job_id,old.ordinal,old.reservation_microusd,old.started_at)
 then raise exception 'IMMUTABLE_GENERATION_ATTEMPT'; end if;
 return new;
end $$;
drop trigger if exists immutable_generation_attempt_finance on public.studkab_gen_attempts;
create trigger immutable_generation_attempt_finance
before delete or update of request_id,job_id,ordinal,reservation_microusd,started_at
on public.studkab_gen_attempts for each row
execute function public.studkab_gen_attempt_financial_immutable();
revoke all on function public.studkab_gen_attempt_financial_immutable() from public,anon,authenticated,service_role;

create or replace function public.studkab_gen_reconcile(p_id uuid,p_requests uuid[],p_retained bigint,p_evidence text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; existing public.studkab_gen_reconciliations; b public.studkab_gen_budget;
 total bigint; expected bigint; n integer; released bigint;
begin
 if p_id is null or p_requests is null or cardinality(p_requests) not between 1 and 1000
 or p_retained is null or p_retained<=0 or p_evidence is null or length(p_evidence) not between 20 and 2000
 then raise exception 'INVALID_RECONCILIATION'; end if;
 select array_agg(distinct x order by x) into ids from unnest(p_requests) x where x is not null;
 if cardinality(ids) is distinct from cardinality(p_requests) then raise exception 'INVALID_REQUEST_IDS'; end if;
 select * into b from public.studkab_gen_budget where id=true for update;
 if not found then raise exception 'MISSING_BUDGET'; end if;
 select * into existing from public.studkab_gen_reconciliations where id=p_id;
 if found then
  if existing.request_ids=ids and existing.retained_microusd=p_retained and existing.evidence=p_evidence
  then return existing.released_microusd; end if;
  raise exception 'RECONCILIATION_CONFLICT';
 end if;
 if exists(select 1 from public.studkab_gen_reconciliations where request_ids && ids)
 then raise exception 'ALREADY_RECONCILED'; end if;
 select count(*),sum(reservation_microusd) into n,total from public.studkab_gen_attempts
 where request_id=any(ids) and state='done' and finished_at is not null;
 if n<>cardinality(ids) then raise exception 'UNCONFIRMED_ATTEMPTS'; end if;
 if p_retained>total then raise exception 'INVALID_COST_CEILING'; end if;
 expected=public.studkab_gen_expected_reserved();
 if b.reserved_microusd<>expected then raise exception 'LEDGER_MISMATCH'; end if;
 released=total-p_retained;
 insert into public.studkab_gen_reconciliations(id,request_ids,retained_microusd,released_microusd,evidence)
 values(p_id,ids,p_retained,released,p_evidence);
 update public.studkab_gen_budget set reserved_microusd=reserved_microusd-released where id=true;
 return released;
end $$;
revoke all on function public.studkab_gen_reconcile(uuid,uuid[],bigint,text) from public,anon,authenticated,service_role;

create or replace function public.studkab_gen_reconcile_unknown(p_request uuid,p_retained bigint,p_evidence text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare a public.studkab_gen_attempts; b public.studkab_gen_budget; released bigint;
begin
 if p_request is null or p_retained is null or p_retained<=0 or p_evidence is null
    or length(p_evidence) not between 20 and 2000 then raise exception 'INVALID_RECONCILIATION'; end if;
 select * into b from public.studkab_gen_budget where id=true for update;
 if not found then raise exception 'MISSING_BUDGET'; end if;
 select * into a from public.studkab_gen_attempts where request_id=p_request for update;
 if not found or a.state<>'unknown' or a.finished_at is null then raise exception 'NOT_UNKNOWN_ATTEMPT'; end if;
 if exists(select 1 from public.studkab_gen_reconciliations where p_request=any(request_ids))
 then raise exception 'ALREADY_RECONCILED'; end if;
 if p_retained>a.reservation_microusd then raise exception 'INVALID_COST_CEILING'; end if;
 if b.reserved_microusd is distinct from public.studkab_gen_expected_reserved()
 then raise exception 'LEDGER_MISMATCH'; end if;
 released=a.reservation_microusd-p_retained;
 insert into public.studkab_gen_reconciliations(id,request_ids,retained_microusd,released_microusd,evidence)
 values(p_request,array[p_request],p_retained,released,p_evidence);
 update public.studkab_gen_budget set reserved_microusd=reserved_microusd-released where id=true;
 return released;
end $$;
revoke all on function public.studkab_gen_reconcile_unknown(uuid,bigint,text) from public,anon,authenticated,service_role;

create or replace function public.studkab_gen_writeoff_unknown()
returns bigint language plpgsql security invoker set search_path='' as $$
begin
 -- Preserve C-051 M6: unknown provider outcomes retain the full reserve until
 -- an administrator reconciles them against provider evidence.
 return 0;
end $$;
revoke all on function public.studkab_gen_writeoff_unknown() from public,anon,authenticated,service_role;
