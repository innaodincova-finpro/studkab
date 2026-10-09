\set ON_ERROR_STOP on

do $$
declare
  missing text[];
begin
  select array_agg(name order by name)
    into missing
  from unnest(array[
    'studkab_intake_drafts',
    'studkab_intake_confirmations',
    'studkab_intake_files',
    'studkab_intake_analysis_policy',
    'studkab_intake_analysis_jobs',
    'studkab_registered_analysis_blocks',
    'studkab_question_proposals',
    'studkab_private_dialog',
    'studkab_telegram_dialog_context',
    'studkab_intake_classifications',
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
    'studkab_request_payload_history',
    'studkab_request_reassignment_permissions',
    'studkab_request_reassignments',
    'studkab_requirement_passports',
    'studkab_clarifications',
    'studkab_dialog_events',
    'studkab_material_revisions',
    'studkab_requests',
    'studkab_quality_evidence',
    'studkab_result_reviews',
    'studkab_result_versions',
    'studkab_results',
    'studkab_test_request_grants',
    'studkab_test_deliveries',
    'studkab_telegram_setup',
    'studkab_assistant_jobs',
    'studkab_assistant_operations',
    'studkab_assistant_events',
    'studkab_assistant_attempts',
    'studkab_assistant_quotes',
    'studkab_assistant_plans',
    'studkab_telegram_accounts',
    'studkab_telegram_links',
    'studkab_process_notifications'
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

  if table_count <> 67 then
    raise exception 'Expected 67 STUDKAB tables, found %', table_count;
  end if;
  if rls_count <> 67 then
    raise exception 'RLS enabled on only % of 67 STUDKAB tables', rls_count;
  end if;
  if to_regclass('public.studkab_request_push_events') is null then
    raise exception 'Request push outbox is missing';
  end if;
  if to_regclass('public.studkab_request_attachments') is null then
    raise exception 'Request attachments table is missing';
  end if;
  if to_regclass('public.studkab_result_passport_bindings') is null
    or to_regclass('public.studkab_result_review_bindings') is null
    or to_regclass('public.studkab_quality_evidence_bindings') is null then
    raise exception 'C109 binding tables are missing';
  end if;
  if to_regclass('public.studkab_result_requirement_snapshots') is null
    or to_regclass('public.studkab_result_requirement_evidence') is null then
    raise exception 'C177 requirement coverage tables are missing';
  end if;
  -- BENCH-01: учебный стенд проверки комплекта, две таблицы с собственным лимитом.
  if to_regclass('public.studkab_kit_bench_policy') is null
    or to_regclass('public.studkab_kit_bench_runs') is null then
    raise exception 'BENCH-01 bench tables are missing';
  end if;
  -- ROUTE-03 R3-C: работа исполнителя по заявке, поданной по форме.
  if to_regclass('public.studkab_r3_work') is null then
    raise exception 'R3-C work table is missing';
  end if;
  -- ROUTE-03 R3-D: версии, возвраты на доработку, файлы с замечаниями.
  if to_regclass('public.studkab_r3_versions') is null
    or to_regclass('public.studkab_r3_returns') is null
    or to_regclass('public.studkab_r3_return_files') is null then
    raise exception 'R3-D tables are missing';
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
     or to_regprocedure('public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text,integer,jsonb)') is null
     or to_regprocedure('public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text,integer,jsonb)') is null
     or to_regprocedure('public.studkab_requirement_coverage_check(uuid,uuid)') is null
     or to_regprocedure('public.studkab_requirement_review_ingest(uuid,uuid,uuid,uuid,jsonb)') is null
     or to_regprocedure('public.studkab_valid_result_review(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.studkab_auto_review_result(uuid,uuid,uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.deliver_studkab_result(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.studkab_gen_cancel(uuid,uuid)') is null
     or to_regprocedure('public.claim_studkab_dialog_telegram()') is null then
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

-- C-080: the new updater must remain service-only after complete replay.
do $$
begin
 if to_regprocedure('public.update_studkab_request(uuid,uuid,jsonb,jsonb)') is null then
  raise exception 'C-080 update function missing';
 end if;
 if has_function_privilege('anon','public.update_studkab_request(uuid,uuid,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.update_studkab_request(uuid,uuid,jsonb,jsonb)','EXECUTE')
 or not has_function_privilege('service_role','public.update_studkab_request(uuid,uuid,jsonb,jsonb)','EXECUTE') then
  raise exception 'C-080 update privileges incorrect';
 end if;
end $$;

do $intake_submission$
declare signature text;role_name text;
begin
 foreach signature in array array['public.studkab_intake_submission_snapshot(uuid,uuid,text)','public.studkab_intake_submit(uuid,uuid,uuid,integer,text,jsonb)','public.studkab_intake_request_context(uuid)'] loop
  foreach role_name in array array['anon','authenticated'] loop
   if has_function_privilege(role_name,signature,'execute') then raise exception 'Public intake submission RPC %',signature; end if;
  end loop;
  if not has_function_privilege('service_role',signature,'execute') then raise exception 'Missing service submission RPC %',signature; end if;
 end loop;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='studkab_request_attachments' and column_name='intake_file_id') then raise exception 'No intake attachment provenance'; end if;
 if not exists(select 1 from storage.buckets where id='studkab-request-materials' and not public and 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'=any(allowed_mime_types)) then raise exception 'No private XLSX destination'; end if;
end $intake_submission$;

-- C098: complete replay must install the evidence contract and every output guard.
do $c098$
declare
  target text;
  guarded record;
begin
  if not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='studkab_requirement_passports'
      and column_name='material_manifest' and data_type='jsonb') then
    raise exception 'C098 material manifest column missing';
  end if;
  foreach target in array array[
    'public.studkab_material_manifest_check(uuid,uuid)',
    'public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text,integer,jsonb)',
    'public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text,integer,jsonb)'
  ] loop
    if to_regprocedure(target) is null then
      raise exception 'C098 required function missing: %', target;
    end if;
    if has_function_privilege('anon',target,'EXECUTE')
      or has_function_privilege('authenticated',target,'EXECUTE')
      or not has_function_privilege('service_role',target,'EXECUTE') then
      raise exception 'C098 function privileges incorrect: %', target;
    end if;
  end loop;
  for guarded in select * from (values
    ('studkab_requirement_passports','passport_manifest_guard'),
    ('studkab_gen_jobs','gen_manifest_guard'),
    ('studkab_result_versions','result_manifest_guard'),
    ('studkab_results','delivery_manifest_guard'),
    ('studkab_result_reviews','review_manifest_guard')
  ) as guards(table_name,trigger_name) loop
    if not exists(select 1 from pg_trigger t
      where t.tgrelid=to_regclass('public.'||guarded.table_name)
        and t.tgname=guarded.trigger_name and t.tgenabled='O' and not t.tgisinternal) then
      raise exception 'C098 enabled manifest guard missing: %', guarded.trigger_name;
    end if;
  end loop;
end
$c098$;

select 'PASS: clean migration replay, schema inventory, RLS, cron isolation and material manifest guards verified' as result;

-- C099: private, explicit test allowance and immutable separate delivery history.
do $$
begin
 if has_table_privilege('service_role','public.studkab_test_request_grants','INSERT')
 or has_table_privilege('service_role','public.studkab_test_request_grants','UPDATE')
 or has_table_privilege('service_role','public.studkab_test_request_grants','DELETE') then raise exception 'Test grant must remain administrative'; end if;
 if has_function_privilege('anon','public.studkab_test_delivery_context(uuid,uuid,boolean)','EXECUTE')
 or has_function_privilege('authenticated','public.studkab_test_result(uuid,uuid,boolean)','EXECUTE') then raise exception 'Test RPC exposed'; end if;
 if not exists(select 1 from pg_trigger where tgname='test_delivery_guard' and not tgisinternal) then raise exception 'Test immutable guard missing'; end if;
 if not exists(select 1 from pg_proc where oid='public.studkab_test_delivery_context(uuid,uuid,boolean)'::regprocedure and prosecdef and proconfig @> array['search_path=""']) then raise exception 'Test read-lock context must pin empty search path'; end if;
end $$;

-- C100 administrative transfer must remain unreachable by API roles after replay.
do $$
declare role_name text; signature text := 'public.studkab_reassign_request(uuid,uuid,uuid,uuid,uuid,text,integer,bigint,bigint,jsonb)';
begin
 if to_regprocedure(signature) is null then raise exception 'C100 transfer function missing'; end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'C100 transfer exposed to %',role_name; end if;
  if has_table_privilege(role_name,'public.studkab_request_reassignment_permissions','SELECT,INSERT,UPDATE,DELETE')
  or has_table_privilege(role_name,'public.studkab_request_reassignments','INSERT,UPDATE,DELETE')
  then raise exception 'C100 administrative state exposed to %',role_name; end if;
 end loop;
 if (select prosecdef from pg_proc where oid=to_regprocedure(signature)) then raise exception 'C100 transfer must be invoker'; end if;
end $$;

-- C102 evidence is closed to clients; immutable review snapshot cannot be omitted.
do $$ begin
 if has_table_privilege('anon','public.studkab_quality_evidence','SELECT') or has_table_privilege('authenticated','public.studkab_quality_evidence','INSERT')
 or has_table_privilege('service_role','public.studkab_quality_evidence','UPDATE') then raise exception 'C102 evidence privileges'; end if;
 if has_function_privilege('anon','public.studkab_quality_save(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text)','EXECUTE')
 or has_function_privilege('authenticated','public.studkab_quality_save(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text)','EXECUTE') then raise exception 'C102 RPC privileges'; end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='studkab_result_reviews' and column_name='quality_evidence_ids') then raise exception 'C102 review evidence binding'; end if;
end $$;

-- INTAKE-01 step 3: both reading functions remain service-only after complete replay.
do $$
declare signature text;
begin
 foreach signature in array array['public.studkab_intake_read_begin(uuid,uuid,uuid,text)','public.studkab_intake_read_finish(uuid,uuid,uuid,uuid,text,jsonb)'] loop
  if to_regprocedure(signature) is null or has_function_privilege('anon',signature,'EXECUTE')
   or has_function_privilege('authenticated',signature,'EXECUTE') or not has_function_privilege('service_role',signature,'EXECUTE') then raise exception 'INTAKE reading function privileges: %',signature; end if;
 end loop;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='studkab_intake_files' and column_name='read_result') then raise exception 'INTAKE persisted reading missing'; end if;
end $$;

do $intake_analysis$
declare signature text; role_name text;
begin
 foreach signature in array array['public.studkab_intake_analysis_snapshot(uuid,uuid)','public.studkab_intake_analysis_start(uuid,uuid,text,jsonb)','public.studkab_intake_analysis_state(uuid,uuid)','public.studkab_intake_analysis_claim()','public.studkab_intake_analysis_fail_claim(uuid,uuid)','public.studkab_intake_analysis_dispatch(uuid,uuid,bigint)','public.studkab_intake_analysis_finish(uuid,uuid,uuid,jsonb,jsonb,text,text)'] loop
  foreach role_name in array array['anon','authenticated'] loop
   if has_function_privilege(role_name,signature,'execute') then raise exception 'Public intake analysis RPC %',signature; end if;
  end loop;
 end loop;
 if has_table_privilege('service_role','public.studkab_intake_analysis_policy','update') then raise exception 'Runner can raise intake budget'; end if;
 if exists(select 1 from public.studkab_intake_analysis_policy where enabled or limit_microusd<>0) then raise exception 'Intake policy must start disabled'; end if;
end $intake_analysis$;

-- INTAKE-01 step 5: default grants cannot make answer history mutable/public.
do $$ declare signature text; role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
  if has_table_privilege(role_name,'public.studkab_intake_confirmations','select,insert,update,delete') then raise exception 'Public confirmation history'; end if;
 end loop;
 if has_table_privilege('service_role','public.studkab_intake_confirmations','update,delete') then raise exception 'Mutable confirmation history'; end if;
 foreach signature in array array['public.studkab_intake_confirmation_rules(jsonb)','public.studkab_intake_confirmation_state(uuid,uuid)','public.studkab_intake_confirmation_save(uuid,uuid,uuid,integer,jsonb,boolean)'] loop
  if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'Confirmation RPC grants: %',signature; end if;
 end loop;
end $$;

-- ROUTE-02-B: receipt capability and private RPCs preserve the study barrier.
do $$ declare name text; begin
 foreach name in array array['public.studkab_intake_receive_snapshot(uuid,uuid)','public.studkab_intake_receive(uuid,uuid,integer,text,text,text)'] loop
  if has_function_privilege('anon',name,'execute') or has_function_privilege('authenticated',name,'execute') or not has_function_privilege('service_role',name,'execute') then raise exception 'Receipt RPC grants: %',name; end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgname='studkab_received_passport_guard' and not tgisinternal) then raise exception 'Missing receipt study barrier'; end if;
end $$;

-- ROUTE-02-C: private study/decisions, immutable classification provenance and guards.
do $$ declare signature text;begin
 foreach signature in array array[
 'public.studkab_registered_read_claim(text)',
 'public.studkab_registered_read_finish(uuid,integer,uuid,uuid,text,jsonb)',
 'public.studkab_registered_analysis_source(uuid)',
 'public.studkab_registered_analysis_original_source(uuid)',
 'public.studkab_registered_field_questions_refresh(uuid)',
 'public.studkab_registered_analysis_next()',
 'public.studkab_registered_analysis_start(uuid,text,jsonb)',
 'public.studkab_registered_analysis_state(uuid,uuid)',
 'public.studkab_registered_analysis_block(uuid,text)',
 'public.studkab_registered_questions_refresh(uuid)',
 'public.studkab_registered_question_decide(uuid,uuid,uuid,text,text)',
 'public.studkab_registered_material_classify(uuid,uuid,uuid,uuid,text)'] loop
  if to_regprocedure(signature) is null
   or has_function_privilege('anon',signature,'execute')
   or has_function_privilege('authenticated',signature,'execute')
   or not has_function_privilege('service_role',signature,'execute')
   or (select prosecdef from pg_proc where oid=to_regprocedure(signature)) then raise exception 'ROUTE-02-C RPC security: %',signature;end if;
 end loop;
 if has_table_privilege('service_role','public.studkab_intake_classifications','update,delete') then raise exception 'Mutable classification provenance';end if;
 if has_column_privilege('service_role','public.studkab_request_attachments','file_hash','update')
 or has_column_privilege('service_role','public.studkab_request_attachments','storage_path','update')
 or not has_column_privilege('service_role','public.studkab_request_attachments','category','update')
 or not has_column_privilege('service_role','public.studkab_request_attachments','extracted_text','update') then raise exception 'Classification column grants';end if;
 if not exists(select 1 from pg_trigger where tgname='immutable_question_proposal' and not tgisinternal)
 or not exists(select 1 from pg_trigger where tgname='registered_study_passport_gate' and not tgisinternal) then raise exception 'ROUTE-02-C immutable/approval barrier missing';end if;
end $$;

-- ROUTE-02-D: append-only private conversation and context RPCs.
do $$ declare signature text;role_name text;begin
 foreach signature in array array[
 'public.studkab_registered_analysis_kit_source(uuid)',
 'public.studkab_registered_question_base_decide(uuid,uuid,uuid,text,text)',
 'public.studkab_private_dialog_send(uuid,uuid,text,text,text,text)',
 'public.studkab_private_dialog_read(uuid,uuid)',
 'public.studkab_telegram_executor(bigint)',
 'public.studkab_telegram_dialog_context_save(bigint,bigint,uuid,text,text,uuid)',
 'public.studkab_telegram_registered_action(bigint,text,uuid,uuid,text,text,bigint)'] loop
 if to_regprocedure(signature) is null or (select prosecdef from pg_proc where oid=to_regprocedure(signature)) then raise exception 'Missing/private invoker dialog RPC: %',signature;end if;
 foreach role_name in array array['anon','authenticated'] loop
 if has_function_privilege(role_name,signature,'execute') then raise exception 'Exposed private dialog RPC: %',signature;end if;end loop;
 end loop;
 if has_table_privilege('service_role','public.studkab_private_dialog','update,delete') or has_table_privilege('service_role','public.studkab_telegram_dialog_context','update,delete') then raise exception 'Mutable private dialog history';end if;
end $$;

-- ROUTE-03 R3-C: работа исполнителя закрыта для браузера; функции — только для сервера, с правами вызывающего.
do $$ declare signature text;role_name text;begin
 foreach signature in array array[
 'public.studkab_r3_take(uuid)',
 'public.studkab_r3_result_set(uuid,text,text,integer,text,text)',
 'public.studkab_r3_deliver(uuid,text)',
 'public.studkab_r3_downloaded(uuid,uuid)'] loop
  if to_regprocedure(signature) is null
   or (select prosecdef from pg_proc where oid=to_regprocedure(signature))
   or not has_function_privilege('service_role',signature,'execute') then raise exception 'R3-C RPC missing or not service-only: %',signature;end if;
  foreach role_name in array array['anon','authenticated'] loop
   if has_function_privilege(role_name,signature,'execute') then raise exception 'R3-C RPC exposed: %',signature;end if;
  end loop;
 end loop;
 foreach role_name in array array['anon','authenticated'] loop
  if has_table_privilege(role_name,'public.studkab_r3_work','select,insert,update,delete') then raise exception 'R3-C work table exposed to %',role_name;end if;
 end loop;
 if not (has_table_privilege('service_role','public.studkab_r3_work','select') and has_table_privilege('service_role','public.studkab_r3_work','insert') and has_table_privilege('service_role','public.studkab_r3_work','update')) then raise exception 'R3-C work table not writable by server';end if;
end $$;

-- ROUTE-03 R3-D: «Я сдал работу» и «Вернули на доработку» — только для сервера; новые таблицы закрыты для браузера.
do $$ declare signature text;role_name text;tbl text;begin
 foreach signature in array array[
 'public.studkab_r3_hand(uuid,uuid)',
 'public.studkab_r3_return_file_add(uuid,uuid,text,text,integer,text,text)',
 'public.studkab_r3_return_file_remove(uuid,uuid,uuid)',
 'public.studkab_r3_return(uuid,uuid,text)',
 'public.studkab_r3_deliver(uuid,text)'] loop
  if to_regprocedure(signature) is null
   or (select prosecdef from pg_proc where oid=to_regprocedure(signature))
   or not has_function_privilege('service_role',signature,'execute') then raise exception 'R3-D RPC missing or not service-only: %',signature;end if;
  foreach role_name in array array['anon','authenticated'] loop
   if has_function_privilege(role_name,signature,'execute') then raise exception 'R3-D RPC exposed: %',signature;end if;
  end loop;
 end loop;
 foreach tbl in array array['public.studkab_r3_versions','public.studkab_r3_returns','public.studkab_r3_return_files'] loop
  foreach role_name in array array['anon','authenticated'] loop
   if has_table_privilege(role_name,tbl,'select,insert,update,delete') then raise exception 'R3-D table % exposed to %',tbl,role_name;end if;
  end loop;
  if not (has_table_privilege('service_role',tbl,'select') and has_table_privilege('service_role',tbl,'insert')) then raise exception 'R3-D table % not writable by server',tbl;end if;
 end loop;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='studkab_r3_work' and column_name='returned_at') then raise exception 'R3-D work columns missing';end if;
end $$;

-- ROUTE-03 R3-F: уведомления о возврате — функции только для сервера.
do $$ declare signature text;role_name text;begin
 foreach signature in array array['public.claim_studkab_r3_return_telegram()','public.studkab_r3_return_push_targets(uuid)'] loop
  if to_regprocedure(signature) is null or not has_function_privilege('service_role',signature,'execute') then raise exception 'R3-F RPC missing: %',signature;end if;
  foreach role_name in array array['anon','authenticated'] loop
   if has_function_privilege(role_name,signature,'execute') then raise exception 'R3-F RPC exposed: %',signature;end if;
  end loop;
 end loop;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='studkab_r3_returns' and column_name='telegram_sent_at') then raise exception 'R3-F columns missing';end if;
end $$;

-- Полное удаление заявки: перечень оставшихся файлов и очистка черновика — только для сервера.
do $$ declare signature text;role_name text;begin
 foreach signature in array array['public.prepare_studkab_request_delete(uuid)','public.studkab_request_delete_intake(uuid[],uuid,jsonb)'] loop
  if to_regprocedure(signature) is null or not has_function_privilege('service_role',signature,'execute') then raise exception 'Delete RPC missing: %',signature;end if;
  foreach role_name in array array['anon','authenticated'] loop
   if has_function_privilege(role_name,signature,'execute') then raise exception 'Delete RPC exposed: %',signature;end if;
  end loop;
 end loop;
 if to_regclass('public.studkab_storage_leftovers') is null then raise exception 'Leftovers table missing';end if;
 foreach role_name in array array['anon','authenticated'] loop
  if has_table_privilege(role_name,'public.studkab_storage_leftovers','select,insert,update,delete') then raise exception 'Leftovers table exposed to %',role_name;end if;
 end loop;
end $$;

-- «Передать Claude»: таблицы и функции только для сервера.
do $$ declare signature text;role_name text;tbl text;begin
 foreach signature in array array['public.studkab_claude_queue(uuid,text)','public.studkab_claude_file_put(uuid,uuid,text,text,integer,text,text)','public.studkab_claude_attached(uuid)'] loop
  if to_regprocedure(signature) is null or not has_function_privilege('service_role',signature,'execute') then raise exception 'Claude RPC missing: %',signature;end if;
  foreach role_name in array array['anon','authenticated'] loop
   if has_function_privilege(role_name,signature,'execute') then raise exception 'Claude RPC exposed: %',signature;end if;
  end loop;
 end loop;
 foreach tbl in array array['public.studkab_claude_jobs','public.studkab_claude_files','public.studkab_claude_results'] loop
  if to_regclass(tbl) is null then raise exception 'Claude table missing: %',tbl;end if;
  foreach role_name in array array['anon','authenticated'] loop
   if has_table_privilege(role_name,tbl,'select,insert,update,delete') then raise exception 'Claude table % exposed to %',tbl,role_name;end if;
  end loop;
 end loop;
end $$;
