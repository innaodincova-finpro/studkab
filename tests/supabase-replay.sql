\set ON_ERROR_STOP on

do $$
declare
  missing text[];
begin
  select array_agg(name order by name)
    into missing
  from unnest(array[
    'studkab_gen_attempts',
    'studkab_gen_budget',
    'studkab_gen_jobs',
    'studkab_gen_parts',
    'studkab_gen_pricing',
    'studkab_gen_reconciliations',
    'studkab_gen_recoveries',
    'studkab_push_configuration',
    'studkab_push_deliveries',
    'studkab_push_subscriptions',
    'studkab_request_config',
    'studkab_requests',
    'studkab_result_reviews',
    'studkab_result_versions',
    'studkab_results',
    'studkab_telegram_setup'
  ]) as expected(name)
  where to_regclass('public.' || name) is null;

  if missing is not null then
    raise exception 'Missing STUDKAB tables: %', missing;
  end if;
end
$$;

do $$
declare
  table_count integer;
  rls_count integer;
begin
  select count(*), count(*) filter (where c.relrowsecurity)
    into table_count, rls_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname like 'studkab_%';

  if table_count <> 16 then
    raise exception 'Expected 16 STUDKAB tables, found %', table_count;
  end if;
  if rls_count <> 16 then
    raise exception 'RLS enabled on only % of 16 STUDKAB tables', rls_count;
  end if;
end
$$;

do $$
declare
  applied_count integer;
begin
  select count(*) into applied_count
  from supabase_migrations.schema_migrations
  where version between '20260904195115' and '20260912131239';

  if applied_count <> 13 then
    raise exception 'Expected 13 restored migrations, found %', applied_count;
  end if;
end
$$;

do $$
begin
  if to_regprocedure('public.studkab_gen_start(uuid,text,jsonb,jsonb)') is null
     or to_regprocedure('public.studkab_gen_claim()') is null
     or to_regprocedure('public.studkab_gen_dispatch(uuid,integer,uuid)') is null
     or to_regprocedure('public.studkab_gen_settle(uuid,integer,uuid,uuid,text,jsonb)') is null
     or to_regprocedure('public.deliver_studkab_result(uuid,uuid,jsonb)') is null then
    raise exception 'One or more required STUDKAB functions are missing';
  end if;
end
$$;

do $$
declare
  exposed integer;
begin
  select count(*) into exposed
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname like 'studkab_%'
    and (
      has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    );

  if exposed <> 0 then
    raise exception '% STUDKAB tables expose DML to anon/authenticated', exposed;
  end if;
end
$$;

do $$
declare
  jobs integer;
begin
  select count(*) into jobs from cron.job;
  if jobs <> 0 then
    raise exception 'Replay safety failure: % cron jobs became active', jobs;
  end if;
end
$$;

select 'PASS: clean migration replay, schema inventory, RLS and cron isolation verified' as result;
