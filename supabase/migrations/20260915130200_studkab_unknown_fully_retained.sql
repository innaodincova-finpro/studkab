-- C-051, замечания 7 и 8 аудита 15.09.2026 (R4, M5, M6).
-- 7: резерв запроса с неизвестным результатом удерживается полностью (M6).
--    Автоматическое списание по расчётному потолку отключено: потолок занижал
--    возможный расход. Возврат — только функцией studkab_gen_reconcile_unknown
--    по сверке с кабинетом поставщика, вызывает администратор.
-- 8: ответ, оборванный пределом длины, автоматически не повторяется.
-- Существующие попытки, сверки и резервы не изменяются.

create or replace function public.studkab_gen_writeoff_unknown()
returns bigint language plpgsql security invoker set search_path='' as $$
begin
 -- M6: неподтверждённый запрос удерживается полностью. Функция сохранена,
 -- потому что её вызывает studkab_gen_maintenance().
 return 0;
end
$$;
revoke all on function public.studkab_gen_writeoff_unknown() from public,anon,authenticated,service_role;

-- Повтор неподтверждённой части: не более двух попыток на часть, резерв каждой
-- попытки остаётся удержанным. Не повторяются: остановленные и устаревшие
-- задания, обрыв по пределу длины, часть с попыткой в пути.
create or replace function public.studkab_gen_recover_unknown()
returns integer language plpgsql security invoker set search_path='' as $$
declare p record; n integer=0; tries integer;
begin
 for p in
  select x.* from public.studkab_gen_parts x
  join public.studkab_gen_jobs j on j.id=x.job_id
  where x.state='unknown' and j.status not in ('cancelled','stale')
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
   where job_id=p.job_id and ordinal=p.ordinal and state='unknown';
  insert into public.studkab_gen_recoveries(job_id,ordinal,attempts_before)
   values(p.job_id,p.ordinal,tries);
  n=n+1;
 end loop;
 update public.studkab_gen_jobs j set status='queued'
 where j.status='unknown'
 and not exists(select 1 from public.studkab_gen_parts x
  where x.job_id=j.id and x.state='unknown');
 return n;
end
$$;
revoke all on function public.studkab_gen_recover_unknown() from public,anon,authenticated,service_role;

-- Возврат резерва неподтверждённого запроса по сверке с кабинетом поставщика.
-- Только администратор базы: права не выдаются никому, включая service_role.
create function public.studkab_gen_reconcile_unknown(p_request uuid,p_retained bigint,p_evidence text)
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
 if b.reserved_microusd is distinct from
  (select coalesce(sum(reservation_microusd),0) from public.studkab_gen_attempts)-
  (select coalesce(sum(released_microusd),0) from public.studkab_gen_reconciliations)
 then raise exception 'LEDGER_MISMATCH'; end if;
 released=a.reservation_microusd-p_retained;
 insert into public.studkab_gen_reconciliations(id,request_ids,retained_microusd,released_microusd,evidence)
 values(p_request,array[p_request],p_retained,released,p_evidence);
 update public.studkab_gen_budget set reserved_microusd=reserved_microusd-released where id=true;
 return released;
end
$$;
revoke all on function public.studkab_gen_reconcile_unknown(uuid,bigint,text) from public,anon,authenticated,service_role;
