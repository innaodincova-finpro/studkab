-- ROUTE-02-C, BENCH-02. Лимит стенда считается по фактическому расходу (разрешение владельца
-- 03.10.2026: «Согласна»). Перед каждым обращением к модели по-прежнему откладывается полный
-- резерв по худшему случаю, поэтому перерасход невозможен. После ответа резерв уменьшается
-- до фактической стоимости по числу слов-токенов, которые сообщил посредник, с запасом 25%
-- по ценам deepseek-cost.mjs (вход 0,30, выход 1,20 доллара за миллион). Если посредник
-- не сообщил расход, резерв остаётся полным. Резерв никогда не увеличивается.
create or replace function public.studkab_kit_bench_finish(p_run uuid,p_raw text,p_result jsonb,p_error text) returns text
language plpgsql security definer set search_path='' as $$
declare s text; actual bigint;
begin
 s=case when p_error is null then 'done' when p_error like 'invalid%' then 'invalid' else 'failed' end;
 if coalesce(p_result->'usage'->>'prompt','') ~ '^[0-9]{1,9}$' and coalesce(p_result->'usage'->>'completion','') ~ '^[0-9]{1,9}$' then
  actual=ceil(((p_result->'usage'->>'prompt')::numeric*0.30+(p_result->'usage'->>'completion')::numeric*1.20)*1.25);
 end if;
 update public.studkab_kit_bench_runs set state=s,raw=p_raw,result=p_result,error=p_error,finished_at=now(),
  reserved_microusd=case when actual is not null and actual>0 then least(reserved_microusd,actual) else reserved_microusd end
  where id=p_run and state='sent';
 if not found then raise exception 'STALE_RUN'; end if;
 return s;
end $$;
revoke all on function public.studkab_kit_bench_finish(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studkab_kit_bench_finish(uuid,text,jsonb,text) to service_role;

-- Уже завершённые прогоны пересчитываются по тому же правилу.
update public.studkab_kit_bench_runs set reserved_microusd=least(reserved_microusd,
 greatest(1,ceil(((result->'usage'->>'prompt')::numeric*0.30+(result->'usage'->>'completion')::numeric*1.20)*1.25)::bigint))
where state<>'sent' and coalesce(result->'usage'->>'prompt','') ~ '^[0-9]{1,9}$' and coalesce(result->'usage'->>'completion','') ~ '^[0-9]{1,9}$';
