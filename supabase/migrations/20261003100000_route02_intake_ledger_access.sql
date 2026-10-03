-- ROUTE-02-C, KIT-02 исправление. Платная отправка разбора (dispatch) читала таблицу
-- studkab_gen_reconciliations напрямую, а доступ service_role к ней закрыт с 12.09.2026.
-- В production каждая отправка падала с отказом доступа до какого-либо расхода.
-- Доступ к таблице не расширяется: сверка выполняется узкой функцией, которая
-- возвращает только признак совпадения журнала и доступна только service_role.
create or replace function public.studkab_intake_ledger_matches(p_reserved bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select p_reserved is not null and p_reserved=
  coalesce((select sum(a.reservation_microusd) from public.studkab_gen_attempts a where not exists(select 1 from public.studkab_gen_reconciliations r where a.request_id=any(r.request_ids))),0)
  +coalesce((select sum(r.retained_microusd) from public.studkab_gen_reconciliations r),0)
  +coalesce((select sum(x.reserved_microusd) from public.studkab_intake_analysis_jobs x),0)
$$;
revoke all on function public.studkab_intake_ledger_matches(bigint) from public,anon,authenticated;
grant execute on function public.studkab_intake_ledger_matches(bigint) to service_role;

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
 -- KIT-02: сверка общего журнала резервов через узкую функцию; сама таблица сверок
 -- по-прежнему закрыта для service_role (с 12.09.2026).
 if not found or not public.studkab_intake_ledger_matches(b.reserved_microusd) then raise exception 'LEDGER_MISMATCH'; end if;
 select * into policy from public.studkab_intake_analysis_policy where id;
 select coalesce(sum(reserved_microusd),0) into total from public.studkab_intake_analysis_jobs;
 if policy.enabled is distinct from true or policy.limit_microusd is null or p_cost>policy.limit_microusd-total or p_cost>b.limit_microusd-b.reserved_microusd then
  update public.studkab_intake_analysis_jobs set state='budget',claim=null,lease_until=null where id=j.id;return null;
 end if;
 rid=gen_random_uuid();update public.studkab_gen_budget set reserved_microusd=reserved_microusd+p_cost where id;
 update public.studkab_intake_analysis_jobs set state='sent',provider_request_id=rid,reserved_microusd=reserved_microusd+p_cost,lease_until=clock_timestamp()+interval '240 seconds' where id=j.id;
 return rid;
end $$;
