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
    'studkab_requirement_passports',
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

  if table_count <> 21 then
    raise exception 'Expected 21 STUDKAB tables, found %', table_count;
  end if;
  if rls_count <> 21 then
    raise exception 'RLS enabled on only % of 21 STUDKAB tables', rls_count;
  end if;
  if to_regclass('public.studkab_request_attachments') is null then
    raise exception 'Request attachments table is missing';
  end if;
end
$$;

do $$
declare
  applied_count integer;
begin
  select count(*) into applied_count
  from supabase_migrations.schema_migrations
  where version between '20260904195115' and '20260915072854';

  if applied_count <> 16 then
    raise exception 'Expected 16 restored migrations, found %', applied_count;
  end if;
end
$$;

do $$
begin
  if to_regprocedure('public.studkab_gen_start(uuid,text,jsonb,jsonb,uuid,text,bigint)') is null
     or to_regprocedure('public.studkab_gen_claim()') is null
     or to_regprocedure('public.studkab_gen_dispatch(uuid,integer,uuid)') is null
     or to_regprocedure('public.studkab_gen_settle(uuid,integer,uuid,uuid,text,jsonb)') is null
     or to_regprocedure('public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text)') is null
     or to_regprocedure('public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text)') is null
     or to_regprocedure('public.deliver_studkab_result(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.studkab_gen_cancel(uuid,uuid)') is null then
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

do $cron$
declare
  jobs integer;
  invalid integer;
begin
  select count(*) into jobs
  from cron.job
  where jobname in (
    'studkab-deadline-push',
    'studkab-request-telegram',
    'studkab-generation-v1',
    'studkab-maintenance'
  );
  if jobs <> 4 then
    raise exception 'Expected 4 STUDKAB cron jobs, found %', jobs;
  end if;

  select count(*) into invalid
  from cron.job
  where jobname in (
    'studkab-deadline-push',
    'studkab-request-telegram',
    'studkab-generation-v1',
    'studkab-maintenance'
  )
  and (schedule <> '* * * * *' or command <> 'select 1;');
  if invalid <> 0 then
    raise exception '% cron jobs have unexpected schedule or unsafe CI command', invalid;
  end if;
end
$cron$;

do $c051$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version in ('20260915130000','20260915130100','20260915130200')) <> 3 then
    raise exception 'C-051 migrations were not applied';
  end if;
  if to_regprocedure('public.studkab_gen_maintenance()') is null
     or to_regprocedure('public.studkab_gen_reconcile_unknown(uuid,bigint,text)') is null then
    raise exception 'C-051 generation maintenance objects are missing';
  end if;
  if has_function_privilege('service_role','public.studkab_gen_reconcile_unknown(uuid,bigint,text)','EXECUTE') then
    raise exception 'Unknown reconciliation is exposed beyond the administrator';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname='studkab_gen_jobs_status_check'))
     not like '%cancelled%' then
    raise exception 'Generation jobs cannot be cancelled';
  end if;
  if has_function_privilege('authenticated','public.studkab_gen_cancel(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','public.studkab_gen_cancel(uuid,uuid)','EXECUTE') then
    raise exception 'Cancellation is exposed to browser roles';
  end if;
end
$c051$;

do $c054$
begin
  if not exists(select 1 from pg_trigger where tgname='studkab_app_data_guard' and tgrelid='public.app_data'::regclass) then
    raise exception 'C-054: cloud write guard is missing';
  end if;
  if has_function_privilege('authenticated','public.studkab_app_data_guard()','EXECUTE') then
    raise exception 'C-054: guard function is exposed';
  end if;
  if to_regclass('public.studkab_members') is null
     or has_table_privilege('authenticated','public.studkab_members','SELECT')
     or has_function_privilege('authenticated','public.studkab_member_add(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.studkab_current_member()','EXECUTE') then
    raise exception 'C-054: student access list is missing or exposed';
  end if;
end
$c054$;

select 'PASS: clean migration replay, schema inventory, RLS and cron isolation verified' as result;
