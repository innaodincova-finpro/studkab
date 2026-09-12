-- C023: administrator-only bounded policy for the explicitly approved FIN-UAT run.
create function public.studkab_test_reconcile_20260912() returns bigint
language plpgsql security invoker set search_path='' as $$
declare a record; retained bigint; released bigint=0; job uuid='527f1587-c41e-4268-8f45-650484515008';
begin
 if clock_timestamp()>='2026-09-13 00:00:00+00'::timestamptz then return 0; end if;
 perform 1 from public.studkab_gen_jobs where id=job for update;
 if not found then return 0; end if;
 for a in select t.* from public.studkab_gen_attempts t
 where t.job_id=job and t.state='done' and t.finished_at is not null
 and t.started_at>='2026-09-12 13:03:53+00'::timestamptz
 and t.detail->>'finish_reason'='stop'
 and jsonb_typeof(t.detail->'prompt_tokens')='number'
 and jsonb_typeof(t.detail->'completion_tokens')='number'
 and (t.detail->>'prompt_tokens') ~ '^[0-9]{1,9}$'
 and (t.detail->>'completion_tokens') ~ '^[0-9]{1,9}$'
 and not exists(select 1 from public.studkab_gen_reconciliations r where t.request_id=any(r.request_ids))
 order by t.ordinal
 loop
  if (a.detail->>'prompt_tokens')::bigint<1 or (a.detail->>'completion_tokens')::bigint<1 then continue; end if;
  retained=ceil(((a.detail->>'prompt_tokens')::numeric*3+(a.detail->>'completion_tokens')::numeric*12)/10)::bigint;
  if retained>a.reservation_microusd then continue; end if;
  released=released+public.studkab_gen_reconcile(a.request_id,array[a.request_id],retained,
   'C023 bounded FIN-UAT job; DeepSeek Flash peak ceiling verified 2026-09-12 https://api-docs.deepseek.com/quick_start/pricing/; input USD0.3/M (all miss), output USD1.2/M; ceil microUSD. Usage from stored successful provider response. Ceiling, not actual invoice. Expires2026-09-13UTC.');
 end loop;
 if released>0 and exists(select 1 from public.studkab_gen_budget where id=true and limit_microusd-reserved_microusd>=250000) then
  update public.studkab_gen_jobs set status='running' where id=job and status='budget';
 end if;
 return released;
end $$;
revoke all on function public.studkab_test_reconcile_20260912() from public,anon,authenticated,service_role;
