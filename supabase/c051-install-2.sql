-- C-051, замечания 6–8: перечень изменений базы и полное удержание неподтверждённых запросов
-- Проект Supabase dcpthwmuiodrjepifzsd. Выполняется один раз целиком.
-- При любой ошибке ничего не меняется. Повторный запуск останавливается проверкой.
begin;
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version in ('20260915130100','20260915130200')) then
  raise exception 'Уже установлено';
 end if;
 if to_regclass('public.studkab_gen_jobs') is null then raise exception 'Не та база: нет таблиц STUDKAB'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20260915130000') then raise exception 'Сначала выполните C051_1_baza.sql'; end if;
end $guard$;
-- ===== 20260915130100_studkab_production_drift_recorded.sql
-- C-051, замечание 6 аудита 15.09.2026 (R9, M13): объекты, существующие в рабочей
-- базе с 13.09.2026, но описанные только в reconciliation/studkab-production-drift.sql
-- (файл удалён). Текст объектов не изменён и идемпотентен: таблицы создаются только
-- при отсутствии, функции заменяются тем же текстом, строка тарифа не перезаписывается.
create table if not exists public.studkab_gen_pricing (
  id boolean primary key default true check (id),
  input_microusd_per_mtok bigint not null check (input_microusd_per_mtok > 0),
  output_microusd_per_mtok bigint not null check (output_microusd_per_mtok > 0),
  source text not null check (length(source) between 10 and 500),
  updated_at timestamptz not null default now(),
  ceiling_input_tokens bigint not null default 180000 check (ceiling_input_tokens > 0),
  ceiling_output_tokens bigint not null default 2500 check (ceiling_output_tokens > 0)
);

create table if not exists public.studkab_gen_recoveries (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  ordinal integer not null,
  attempts_before integer not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (job_id, ordinal)
    references public.studkab_gen_parts(job_id, ordinal)
);

alter table public.studkab_gen_pricing enable row level security;
alter table public.studkab_gen_recoveries enable row level security;
revoke all on public.studkab_gen_pricing, public.studkab_gen_recoveries
  from public, anon, authenticated, service_role;

insert into public.studkab_gen_pricing (
  id,
  input_microusd_per_mtok,
  output_microusd_per_mtok,
  source,
  updated_at,
  ceiling_input_tokens,
  ceiling_output_tokens
) values (
  true,
  300000,
  1200000,
  'DeepSeek Flash, пиковый тариф, проверен 12.09.2026 по api-docs.deepseek.com/quick_start/pricing; весь вход считается без скидки за повтор',
  '2026-09-12 15:25:35.236661+00'::timestamptz,
  180000,
  2500
)
on conflict (id) do nothing;

create or replace function public.studkab_gen_recover_unknown()
returns integer language plpgsql security invoker set search_path='' as $$
declare p record; n integer=0; tries integer;
begin
 for p in
  select x.* from public.studkab_gen_parts x
  join public.studkab_gen_jobs j on j.id=x.job_id
  where x.state='unknown' order by x.job_id,x.ordinal limit 200
 loop
  select count(*) into tries from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal;
  if tries>=2 then continue; end if;
  if exists(select 1 from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal and t.state='sent') then continue; end if;
  if exists(select 1 from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal and t.state='unknown'
   and not exists(select 1 from public.studkab_gen_reconciliations r
    where t.request_id=any(r.request_ids))) then continue; end if;
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

create or replace function public.studkab_gen_settle_costs()
returns bigint language plpgsql security invoker set search_path='' as $$
declare a record; p record; retained bigint; released bigint=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('studkab_gen_settle_costs',0)) then return 0; end if;
 select * into p from public.studkab_gen_pricing where id=true;
 if not found then return 0; end if;
 for a in
  select t.* from public.studkab_gen_attempts t
  where t.state='done' and t.finished_at is not null
  and jsonb_typeof(t.detail->'prompt_tokens')='number'
  and jsonb_typeof(t.detail->'completion_tokens')='number'
  and (t.detail->>'prompt_tokens') ~ '^[0-9]{1,9}$'
  and (t.detail->>'completion_tokens') ~ '^[0-9]{1,9}$'
  and not exists(select 1 from public.studkab_gen_reconciliations r
   where t.request_id=any(r.request_ids))
  order by t.started_at limit 500
 loop
  retained=greatest(1::bigint,ceil((
   (a.detail->>'prompt_tokens')::numeric*p.input_microusd_per_mtok+
   (a.detail->>'completion_tokens')::numeric*p.output_microusd_per_mtok
  )/1000000)::bigint);
  if retained>a.reservation_microusd then continue; end if;
  begin
   released=released+public.studkab_gen_reconcile(
    a.request_id,array[a.request_id],retained,
    'Автоматическая сверка расхода. Потолок цены поставщика: '||
    p.input_microusd_per_mtok||' микродолларов за миллион входных единиц и '||
    p.output_microusd_per_mtok||' за миллион выходных. Основание: '||p.source||
    '. Расход взят из сохранённого ответа поставщика, округление вверх. Это потолок цены, а не счёт поставщика.'
   );
  exception when others then continue;
  end;
 end loop;
 return released;
end
$$;

create or replace function public.studkab_gen_writeoff_unknown()
returns bigint language plpgsql security invoker set search_path='' as $$
declare a record; p record; retained bigint; released bigint=0; b public.studkab_gen_budget;
begin
 select * into p from public.studkab_gen_pricing where id=true;
 if not found then return 0; end if;
 retained=greatest(1::bigint,ceil((
  p.ceiling_input_tokens::numeric*p.input_microusd_per_mtok+
  p.ceiling_output_tokens::numeric*p.output_microusd_per_mtok
 )/1000000)::bigint);
 select * into b from public.studkab_gen_budget where id=true for update;
 if not found then return 0; end if;
 if b.reserved_microusd is distinct from
  (select coalesce(sum(reservation_microusd),0) from public.studkab_gen_attempts)-
  (select coalesce(sum(released_microusd),0) from public.studkab_gen_reconciliations)
 then raise exception 'LEDGER_MISMATCH'; end if;
 for a in
  select t.* from public.studkab_gen_attempts t
  where t.state='unknown' and t.finished_at is not null
  and t.reservation_microusd>retained
  and not exists(select 1 from public.studkab_gen_reconciliations r
   where t.request_id=any(r.request_ids))
  order by t.started_at limit 500
 loop
  insert into public.studkab_gen_reconciliations(
   id,request_ids,retained_microusd,released_microusd,evidence
  ) values(
   a.request_id,array[a.request_id],retained,a.reservation_microusd-retained,
   'Списание по неподтверждённой попытке. Фактический расход неизвестен, поэтому удержан потолок, который эта попытка физически не могла превысить: '||
   p.ceiling_input_tokens||' входных и '||p.ceiling_output_tokens||
   ' выходных единиц по цене '||p.input_microusd_per_mtok||' и '||
   p.output_microusd_per_mtok||
   ' микродолларов за миллион. Остаток залога возвращён в лимит. Это потолок, а не счёт поставщика.'
  );
  released=released+(a.reservation_microusd-retained);
 end loop;
 if released>0 then
  update public.studkab_gen_budget
   set reserved_microusd=reserved_microusd-released where id=true;
 end if;
 return released;
end
$$;

create or replace function public.studkab_gen_resume_budget()
returns integer language plpgsql security invoker set search_path='' as $resume$
declare n integer=0; free bigint;
begin
 select limit_microusd-reserved_microusd into free
 from public.studkab_gen_budget where id=true;
 if free is null then return 0; end if;
 with ready as (
  select j.id from public.studkab_gen_jobs j
  where j.status='budget'
  and exists(select 1 from public.studkab_gen_parts x
   where x.job_id=j.id and x.state='queued'
   and (x.spec->>'max_cost_microusd')::bigint<=free)
 )
 update public.studkab_gen_jobs j set status='queued'
 from ready where j.id=ready.id;
 get diagnostics n=row_count;
 return n;
end
$resume$;

create or replace function public.studkab_gen_maintenance()
returns jsonb language plpgsql security invoker set search_path='' as $maintenance$
declare released bigint; written bigint; recovered integer; resumed integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('studkab_gen_maintenance',0))
 then return jsonb_build_object('skipped',true); end if;
 released=public.studkab_gen_settle_costs();
 written=public.studkab_gen_writeoff_unknown();
 recovered=public.studkab_gen_recover_unknown();
 resumed=public.studkab_gen_resume_budget();
 return jsonb_build_object(
  'vozvrashcheno',released,
  'spisano_po_neizvestnym',written,
  'vozobnovleno_chastey',recovered,
  'razblokirovano_rabot',resumed
 );
end
$maintenance$;

revoke all on function
  public.studkab_gen_recover_unknown(),
  public.studkab_gen_settle_costs(),
  public.studkab_gen_writeoff_unknown(),
  public.studkab_gen_resume_budget(),
  public.studkab_gen_maintenance()
from public, anon, authenticated, service_role;

insert into supabase_migrations.schema_migrations(version,name,statements) values('20260915130100','studkab_production_drift_recorded',array[$c051_body$-- C-051, замечание 6 аудита 15.09.2026 (R9, M13): объекты, существующие в рабочей
-- базе с 13.09.2026, но описанные только в reconciliation/studkab-production-drift.sql
-- (файл удалён). Текст объектов не изменён и идемпотентен: таблицы создаются только
-- при отсутствии, функции заменяются тем же текстом, строка тарифа не перезаписывается.
create table if not exists public.studkab_gen_pricing (
  id boolean primary key default true check (id),
  input_microusd_per_mtok bigint not null check (input_microusd_per_mtok > 0),
  output_microusd_per_mtok bigint not null check (output_microusd_per_mtok > 0),
  source text not null check (length(source) between 10 and 500),
  updated_at timestamptz not null default now(),
  ceiling_input_tokens bigint not null default 180000 check (ceiling_input_tokens > 0),
  ceiling_output_tokens bigint not null default 2500 check (ceiling_output_tokens > 0)
);

create table if not exists public.studkab_gen_recoveries (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  ordinal integer not null,
  attempts_before integer not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (job_id, ordinal)
    references public.studkab_gen_parts(job_id, ordinal)
);

alter table public.studkab_gen_pricing enable row level security;
alter table public.studkab_gen_recoveries enable row level security;
revoke all on public.studkab_gen_pricing, public.studkab_gen_recoveries
  from public, anon, authenticated, service_role;

insert into public.studkab_gen_pricing (
  id,
  input_microusd_per_mtok,
  output_microusd_per_mtok,
  source,
  updated_at,
  ceiling_input_tokens,
  ceiling_output_tokens
) values (
  true,
  300000,
  1200000,
  'DeepSeek Flash, пиковый тариф, проверен 12.09.2026 по api-docs.deepseek.com/quick_start/pricing; весь вход считается без скидки за повтор',
  '2026-09-12 15:25:35.236661+00'::timestamptz,
  180000,
  2500
)
on conflict (id) do nothing;

create or replace function public.studkab_gen_recover_unknown()
returns integer language plpgsql security invoker set search_path='' as $$
declare p record; n integer=0; tries integer;
begin
 for p in
  select x.* from public.studkab_gen_parts x
  join public.studkab_gen_jobs j on j.id=x.job_id
  where x.state='unknown' order by x.job_id,x.ordinal limit 200
 loop
  select count(*) into tries from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal;
  if tries>=2 then continue; end if;
  if exists(select 1 from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal and t.state='sent') then continue; end if;
  if exists(select 1 from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal and t.state='unknown'
   and not exists(select 1 from public.studkab_gen_reconciliations r
    where t.request_id=any(r.request_ids))) then continue; end if;
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

create or replace function public.studkab_gen_settle_costs()
returns bigint language plpgsql security invoker set search_path='' as $$
declare a record; p record; retained bigint; released bigint=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('studkab_gen_settle_costs',0)) then return 0; end if;
 select * into p from public.studkab_gen_pricing where id=true;
 if not found then return 0; end if;
 for a in
  select t.* from public.studkab_gen_attempts t
  where t.state='done' and t.finished_at is not null
  and jsonb_typeof(t.detail->'prompt_tokens')='number'
  and jsonb_typeof(t.detail->'completion_tokens')='number'
  and (t.detail->>'prompt_tokens') ~ '^[0-9]{1,9}$'
  and (t.detail->>'completion_tokens') ~ '^[0-9]{1,9}$'
  and not exists(select 1 from public.studkab_gen_reconciliations r
   where t.request_id=any(r.request_ids))
  order by t.started_at limit 500
 loop
  retained=greatest(1::bigint,ceil((
   (a.detail->>'prompt_tokens')::numeric*p.input_microusd_per_mtok+
   (a.detail->>'completion_tokens')::numeric*p.output_microusd_per_mtok
  )/1000000)::bigint);
  if retained>a.reservation_microusd then continue; end if;
  begin
   released=released+public.studkab_gen_reconcile(
    a.request_id,array[a.request_id],retained,
    'Автоматическая сверка расхода. Потолок цены поставщика: '||
    p.input_microusd_per_mtok||' микродолларов за миллион входных единиц и '||
    p.output_microusd_per_mtok||' за миллион выходных. Основание: '||p.source||
    '. Расход взят из сохранённого ответа поставщика, округление вверх. Это потолок цены, а не счёт поставщика.'
   );
  exception when others then continue;
  end;
 end loop;
 return released;
end
$$;

create or replace function public.studkab_gen_writeoff_unknown()
returns bigint language plpgsql security invoker set search_path='' as $$
declare a record; p record; retained bigint; released bigint=0; b public.studkab_gen_budget;
begin
 select * into p from public.studkab_gen_pricing where id=true;
 if not found then return 0; end if;
 retained=greatest(1::bigint,ceil((
  p.ceiling_input_tokens::numeric*p.input_microusd_per_mtok+
  p.ceiling_output_tokens::numeric*p.output_microusd_per_mtok
 )/1000000)::bigint);
 select * into b from public.studkab_gen_budget where id=true for update;
 if not found then return 0; end if;
 if b.reserved_microusd is distinct from
  (select coalesce(sum(reservation_microusd),0) from public.studkab_gen_attempts)-
  (select coalesce(sum(released_microusd),0) from public.studkab_gen_reconciliations)
 then raise exception 'LEDGER_MISMATCH'; end if;
 for a in
  select t.* from public.studkab_gen_attempts t
  where t.state='unknown' and t.finished_at is not null
  and t.reservation_microusd>retained
  and not exists(select 1 from public.studkab_gen_reconciliations r
   where t.request_id=any(r.request_ids))
  order by t.started_at limit 500
 loop
  insert into public.studkab_gen_reconciliations(
   id,request_ids,retained_microusd,released_microusd,evidence
  ) values(
   a.request_id,array[a.request_id],retained,a.reservation_microusd-retained,
   'Списание по неподтверждённой попытке. Фактический расход неизвестен, поэтому удержан потолок, который эта попытка физически не могла превысить: '||
   p.ceiling_input_tokens||' входных и '||p.ceiling_output_tokens||
   ' выходных единиц по цене '||p.input_microusd_per_mtok||' и '||
   p.output_microusd_per_mtok||
   ' микродолларов за миллион. Остаток залога возвращён в лимит. Это потолок, а не счёт поставщика.'
  );
  released=released+(a.reservation_microusd-retained);
 end loop;
 if released>0 then
  update public.studkab_gen_budget
   set reserved_microusd=reserved_microusd-released where id=true;
 end if;
 return released;
end
$$;

create or replace function public.studkab_gen_resume_budget()
returns integer language plpgsql security invoker set search_path='' as $resume$
declare n integer=0; free bigint;
begin
 select limit_microusd-reserved_microusd into free
 from public.studkab_gen_budget where id=true;
 if free is null then return 0; end if;
 with ready as (
  select j.id from public.studkab_gen_jobs j
  where j.status='budget'
  and exists(select 1 from public.studkab_gen_parts x
   where x.job_id=j.id and x.state='queued'
   and (x.spec->>'max_cost_microusd')::bigint<=free)
 )
 update public.studkab_gen_jobs j set status='queued'
 from ready where j.id=ready.id;
 get diagnostics n=row_count;
 return n;
end
$resume$;

create or replace function public.studkab_gen_maintenance()
returns jsonb language plpgsql security invoker set search_path='' as $maintenance$
declare released bigint; written bigint; recovered integer; resumed integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('studkab_gen_maintenance',0))
 then return jsonb_build_object('skipped',true); end if;
 released=public.studkab_gen_settle_costs();
 written=public.studkab_gen_writeoff_unknown();
 recovered=public.studkab_gen_recover_unknown();
 resumed=public.studkab_gen_resume_budget();
 return jsonb_build_object(
  'vozvrashcheno',released,
  'spisano_po_neizvestnym',written,
  'vozobnovleno_chastey',recovered,
  'razblokirovano_rabot',resumed
 );
end
$maintenance$;

revoke all on function
  public.studkab_gen_recover_unknown(),
  public.studkab_gen_settle_costs(),
  public.studkab_gen_writeoff_unknown(),
  public.studkab_gen_resume_budget(),
  public.studkab_gen_maintenance()
from public, anon, authenticated, service_role;
$c051_body$]);
-- ===== 20260915130200_studkab_unknown_fully_retained.sql
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

insert into supabase_migrations.schema_migrations(version,name,statements) values('20260915130200','studkab_unknown_fully_retained',array[$c051_body$-- C-051, замечания 7 и 8 аудита 15.09.2026 (R4, M5, M6).
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
$c051_body$]);
commit;
-- Проверка: ожидается одна строка «Установлено».
select 'Установлено' as result where (select count(*) from supabase_migrations.schema_migrations where version in ('20260915130100','20260915130200'))=2;
