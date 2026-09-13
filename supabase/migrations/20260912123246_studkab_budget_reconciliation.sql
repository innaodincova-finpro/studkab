-- Administrator-only. Install does not release funds or change the spending cap.
create table public.studkab_gen_reconciliations (
 id uuid primary key,
 request_ids uuid[] not null,
 retained_microusd bigint not null check(retained_microusd>0),
 released_microusd bigint not null check(released_microusd>=0),
 evidence text not null check(length(evidence) between 20 and 2000),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.studkab_gen_reconciliations enable row level security;
revoke all on public.studkab_gen_reconciliations from public,anon,authenticated,service_role;
create function public.studkab_gen_reconciliation_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'IMMUTABLE_RECONCILIATION'; end $$;
create trigger immutable_reconciliation before update or delete on public.studkab_gen_reconciliations
for each row execute function public.studkab_gen_reconciliation_immutable();
create function public.studkab_gen_reconcile(p_id uuid,p_requests uuid[],p_retained bigint,p_evidence text)
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
 select coalesce(sum(reservation_microusd),0)-(select coalesce(sum(released_microusd),0)
 from public.studkab_gen_reconciliations) into expected from public.studkab_gen_attempts;
 if b.reserved_microusd<>expected then raise exception 'LEDGER_MISMATCH'; end if;
 released=total-p_retained;
 insert into public.studkab_gen_reconciliations(id,request_ids,retained_microusd,released_microusd,evidence)
 values(p_id,ids,p_retained,released,p_evidence);
 update public.studkab_gen_budget set reserved_microusd=reserved_microusd-released where id=true;
 return released;
end $$;
revoke all on function public.studkab_gen_reconcile(uuid,uuid[],bigint,text),public.studkab_gen_reconciliation_immutable()
from public,anon,authenticated,service_role;
