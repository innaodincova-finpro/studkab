-- C-051, замечание 2: остановка подготовки
-- Проект Supabase dcpthwmuiodrjepifzsd. Выполняется один раз целиком.
-- При любой ошибке ничего не меняется. Повторный запуск останавливается проверкой.
begin;
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version in ('20260915130000')) then
  raise exception 'Уже установлено';
 end if;
 if to_regclass('public.studkab_gen_jobs') is null then raise exception 'Не та база: нет таблиц STUDKAB'; end if;
end $guard$;
-- ===== 20260915130000_studkab_generation_stop.sql
-- C-051, замечание 2 аудита 15.09.2026 (R2/R3/M4): остановка подготовки и
-- проверка паспорта перед каждой отправкой.
-- Существующие задания, части, попытки и сверки не удаляются и не переписываются.

-- 1. Два новых конечных состояния задания.
--    cancelled — остановлено исполнителем; stale — паспорт или материалы изменились.
do $constraint$
declare c record;
begin
 for c in
  select con.conname from pg_constraint con
  where con.conrelid='public.studkab_gen_jobs'::regclass and con.contype='c'
    and pg_get_constraintdef(con.oid) like '%status%'
 loop
  execute format('alter table public.studkab_gen_jobs drop constraint %I',c.conname);
 end loop;
end
$constraint$;
alter table public.studkab_gen_jobs add constraint studkab_gen_jobs_status_check
 check (status in ('queued','running','unknown','budget','complete','cancelled','stale'));

-- 2. Остановка. Уже отправленный запрос не отзывается: его результат сохраняется,
--    а резерв сверяется обычным порядком. Новые отправки больше не выполняются.
create function public.studkab_gen_cancel(p_owner uuid,p_job uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare j public.studkab_gen_jobs;
begin
 select * into j from public.studkab_gen_jobs where id=p_job and owner_id=p_owner for update;
 if not found then return 'not_found'; end if;
 if j.status in ('complete','cancelled','stale') then return j.status; end if;
 update public.studkab_gen_jobs set status='cancelled' where id=p_job;
 update public.studkab_gen_parts set state='queued',claim=null,lease_until=null
  where job_id=p_job and state='claimed';
 return 'cancelled';
end $$;
revoke all on function public.studkab_gen_cancel(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studkab_gen_cancel(uuid,uuid) to service_role;

-- 3. Захват: как раньше, плюс истечение срока отправленных частей
--    остановленных заданий, чтобы их резерв прошёл обычную сверку.
create or replace function public.studkab_gen_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studkab_gen_jobs; p public.studkab_gen_parts; v_claim uuid;
begin
 update public.studkab_gen_attempts a set state='unknown',reason='LEASE_EXPIRED_AFTER_DISPATCH',finished_at=clock_timestamp()
  where a.state='sent' and exists(select 1 from public.studkab_gen_parts x join public.studkab_gen_jobs y on y.id=x.job_id
   where x.job_id=a.job_id and x.ordinal=a.ordinal and x.state='sent' and x.lease_until<=clock_timestamp()
   and y.status in ('cancelled','stale'));
 update public.studkab_gen_parts x set state='unknown'
  from public.studkab_gen_jobs y
  where y.id=x.job_id and y.status in ('cancelled','stale') and x.state='sent' and x.lease_until<=clock_timestamp();
 -- Lock job first in every operation; skip jobs currently used by other handlers.
 for j in select * from public.studkab_gen_jobs where status in ('queued','running')
 order by created_at for update skip locked loop
  update public.studkab_gen_attempts a set state='unknown',reason='LEASE_EXPIRED_AFTER_DISPATCH',finished_at=clock_timestamp()
   where a.job_id=j.id and a.state='sent' and exists(select 1 from public.studkab_gen_parts x where x.job_id=a.job_id and x.ordinal=a.ordinal and x.state='sent' and x.lease_until<=clock_timestamp());
  update public.studkab_gen_parts set state='unknown' where job_id=j.id and state='sent' and lease_until<=clock_timestamp();
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=j.id and state='claimed' and lease_until<=clock_timestamp();
  if exists(select 1 from public.studkab_gen_parts where job_id=j.id and state='unknown') then
   update public.studkab_gen_jobs set status='unknown' where id=j.id; continue;
  end if;
  select * into p from public.studkab_gen_parts where job_id=j.id and state!='done' order by ordinal limit 1;
  if not found then update public.studkab_gen_jobs set status='complete' where id=j.id; continue; end if;
  if p.state!='queued' then continue; end if;
  v_claim=gen_random_uuid();
  update public.studkab_gen_parts set state='claimed',claim=v_claim,lease_until=clock_timestamp()+interval '240 seconds' where job_id=j.id and ordinal=p.ordinal;
  update public.studkab_gen_jobs set status='running' where id=j.id;
  return jsonb_build_object('job_id',j.id,'ordinal',p.ordinal,'claim',v_claim,'version',j.version,'input',j.snapshot->'input','spec',p.spec);
 end loop;
 return null;
end $$;

-- 4. Отправка: перед резервом задание должно выполняться, а его паспорт —
--    оставаться утверждённым для тех же материалов.
create or replace function public.studkab_gen_dispatch(p_job uuid,p_ordinal integer,p_claim uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts; j public.studkab_gen_jobs; b public.studkab_gen_budget;
 policy public.studkab_gen_policy; cost bigint; used bigint; input_bytes bigint; output_tokens bigint; rid uuid;
begin
 select * into j from public.studkab_gen_jobs where id=p_job for update;
 select * into p from public.studkab_gen_parts where job_id=p_job and ordinal=p_ordinal;
 if not found or p.state!='claimed' or p.claim is distinct from p_claim or p.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM'; end if;
 if j.status is distinct from 'running' then
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 if not exists(select 1 from public.studkab_requirement_passports r
   where r.id=j.passport_id and r.status='approved'
   and r.source_fingerprint=coalesce(j.snapshot->'input'->>'material_fingerprint','')) then
  update public.studkab_gen_jobs set status='stale' where id=p_job;
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 output_tokens=(p.spec->>'max_output_tokens')::bigint;
 select 4096
   +octet_length(coalesce(j.snapshot->'input'->>'system',''))
   +octet_length(coalesce(j.snapshot->'input'->'prompts'->>(p.spec->>'prompt_ref'),''))
   +octet_length(coalesce(p.spec->>'prompt',''))
   +coalesce(sum(octet_length(result)+96),0)
 into input_bytes from public.studkab_gen_parts
 where job_id=p_job and ordinal<p_ordinal and state='done';
 -- Peak cache-miss input $0.30/M + output $1.20/M, with a 25% margin.
 -- UTF-8 bytes intentionally upper-bound input tokens.
 cost=(input_bytes*375+output_tokens*1500+999)/1000;
 select coalesce(sum(reservation_microusd),0) into used from public.studkab_gen_attempts where job_id=p_job;
 select * into policy from public.studkab_gen_policy where id=true;
 select * into b from public.studkab_gen_budget where id=true for update;
 if j.passport_id is null or j.max_cost_microusd is null or policy is null
    or cost>(p.spec->>'max_cost_microusd')::bigint
    or cost>j.max_cost_microusd-used
    or cost>least(b.limit_microusd,policy.temporary_total_microusd)-b.reserved_microusd then
  update public.studkab_gen_jobs set status='budget' where id=p_job;
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 rid=gen_random_uuid();
 update public.studkab_gen_budget set reserved_microusd=reserved_microusd+cost where id=true;
 insert into public.studkab_gen_attempts(request_id,job_id,ordinal,claim,state,reservation_microusd)
 values(rid,p_job,p_ordinal,p_claim,'sent',cost);
 update public.studkab_gen_parts set state='sent',request_id=rid,lease_until=clock_timestamp()+interval '240 seconds'
  where job_id=p_job and ordinal=p_ordinal;
 return rid;
end $$;

-- 5. Сохранение ответа: текст сохраняется всегда, но остановленное или
--    устаревшее задание не возвращается в работу.
create or replace function public.studkab_gen_settle(p_job uuid,p_ordinal integer,p_claim uuid,p_request uuid,p_text text,p_detail jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts; v_state text; safe jsonb='{}'; k text; v_job text;
begin
 select status into v_job from public.studkab_gen_jobs where id=p_job for update;
 select * into p from public.studkab_gen_parts where job_id=p_job and ordinal=p_ordinal;
 if not found or p.state!='sent' or p.claim is distinct from p_claim or p.request_id is distinct from p_request or p.lease_until<=clock_timestamp() then raise exception 'STALE_RESULT'; end if;
 v_state=case when length(trim(p_text))>0 then 'done' else 'unknown' end;
 if octet_length(p_text)>100000 then raise exception 'RESULT_TOO_BIG'; end if;
 foreach k in array array['finish_reason','request_id'] loop
  if (p_detail->>k) ~ '^[a-zA-Z0-9_.-]{1,120}$' then safe=safe||jsonb_build_object(k,p_detail->>k); end if;
 end loop;
 foreach k in array array['prompt_tokens','completion_tokens'] loop
  if (p_detail->>k) ~ '^[0-9]{1,10}$' then safe=safe||jsonb_build_object(k,(p_detail->>k)::bigint); end if;
 end loop;
 update public.studkab_gen_parts set state=v_state,result=case when v_state='done' then p_text else null end where job_id=p_job and ordinal=p_ordinal;
 update public.studkab_gen_attempts set state=v_state,reason=case when v_state='unknown' then 'RESULT_UNKNOWN' else null end,detail=safe,finished_at=clock_timestamp() where request_id=p_request;
 if v_job in ('cancelled','stale') then return v_state; end if;
 update public.studkab_gen_jobs set status=case when v_state='unknown' then 'unknown'
 when not exists(select 1 from public.studkab_gen_parts where job_id=p_job and state!='done') then 'complete' else 'running' end where id=p_job;
 return v_state;
end $$;

-- 6. Новый запуск с теми же материалами после остановки создаёт новое задание,
--    а не возвращает остановленное.
create or replace function public.studkab_gen_start(
 p_owner uuid,p_request text,p_input jsonb,p_plan jsonb,p_passport uuid,
 p_work_kind text,p_max_cost_microusd bigint
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_snapshot jsonb; v_base text; v_version text; v_id uuid; v_status text; v_n integer; s jsonb; approved uuid; allowed bigint;
begin
 if p_request !~ '^[a-f0-9-]{36}$' then raise exception 'INVALID_REQUEST'; end if;
 select id into approved from public.studkab_requirement_passports
  where id=p_passport and request_id=p_request::uuid and status='approved'
    and source_fingerprint=coalesce(p_input->>'material_fingerprint','') for share;
 if approved is null then raise exception 'PASSPORT_REQUIRED'; end if;
 select max_cost_microusd into allowed from public.studkab_gen_limits where work_kind=p_work_kind;
 if allowed is null or allowed<>p_max_cost_microusd then raise exception 'INVALID_WORK_LIMIT'; end if;
 if p_input is null or jsonb_typeof(p_input)!='object' or p_plan is null or jsonb_typeof(p_plan)!='array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_plan) not between 1 and 100 then raise exception 'INVALID_PLAN'; end if;
 for s in select value from jsonb_array_elements(p_plan) loop
  if jsonb_typeof(s)!='object' or coalesce(s->>'id','')='' or coalesce(s->>'prompt','')=''
     or coalesce(s->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,11}$'
     or coalesce(s->>'max_output_tokens','') !~ '^[1-9][0-9]{0,3}$'
     or (s->>'max_output_tokens')::integer>8000 then raise exception 'INVALID_PART'; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_plan))!=jsonb_array_length(p_plan) then raise exception 'DUPLICATE_PART'; end if;
 v_snapshot=jsonb_build_object('input',p_input,'plan',p_plan,'passport_id',p_passport,
  'work_kind',p_work_kind,'max_cost_microusd',p_max_cost_microusd);
 if octet_length(v_snapshot::text)>1000000 then raise exception 'INPUT_TOO_BIG'; end if;
 v_base=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_request,0));
 select id,status into v_id,v_status from public.studkab_gen_jobs
  where owner_id=p_owner and request_id=p_request and (version=v_base or version like v_base||':r%')
  order by created_at desc limit 1;
 if v_id is not null and v_status not in ('cancelled','stale') then return v_id; end if;
 select count(*) into v_n from public.studkab_gen_jobs
  where owner_id=p_owner and request_id=p_request and (version=v_base or version like v_base||':r%');
 v_version=case when v_n=0 then v_base else v_base||':r'||v_n end;
 insert into public.studkab_gen_jobs(owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd)
 values(p_owner,p_request,v_version,v_snapshot,p_passport,p_work_kind,p_max_cost_microusd) returning id into v_id;
 insert into public.studkab_gen_parts(job_id,ordinal,spec)
 select v_id,(ordinality-1)::integer,value from jsonb_array_elements(p_plan) with ordinality;
 return v_id;
end $$;

insert into supabase_migrations.schema_migrations(version,name,statements) values('20260915130000','studkab_generation_stop',array[$c051_body$-- C-051, замечание 2 аудита 15.09.2026 (R2/R3/M4): остановка подготовки и
-- проверка паспорта перед каждой отправкой.
-- Существующие задания, части, попытки и сверки не удаляются и не переписываются.

-- 1. Два новых конечных состояния задания.
--    cancelled — остановлено исполнителем; stale — паспорт или материалы изменились.
do $constraint$
declare c record;
begin
 for c in
  select con.conname from pg_constraint con
  where con.conrelid='public.studkab_gen_jobs'::regclass and con.contype='c'
    and pg_get_constraintdef(con.oid) like '%status%'
 loop
  execute format('alter table public.studkab_gen_jobs drop constraint %I',c.conname);
 end loop;
end
$constraint$;
alter table public.studkab_gen_jobs add constraint studkab_gen_jobs_status_check
 check (status in ('queued','running','unknown','budget','complete','cancelled','stale'));

-- 2. Остановка. Уже отправленный запрос не отзывается: его результат сохраняется,
--    а резерв сверяется обычным порядком. Новые отправки больше не выполняются.
create function public.studkab_gen_cancel(p_owner uuid,p_job uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare j public.studkab_gen_jobs;
begin
 select * into j from public.studkab_gen_jobs where id=p_job and owner_id=p_owner for update;
 if not found then return 'not_found'; end if;
 if j.status in ('complete','cancelled','stale') then return j.status; end if;
 update public.studkab_gen_jobs set status='cancelled' where id=p_job;
 update public.studkab_gen_parts set state='queued',claim=null,lease_until=null
  where job_id=p_job and state='claimed';
 return 'cancelled';
end $$;
revoke all on function public.studkab_gen_cancel(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studkab_gen_cancel(uuid,uuid) to service_role;

-- 3. Захват: как раньше, плюс истечение срока отправленных частей
--    остановленных заданий, чтобы их резерв прошёл обычную сверку.
create or replace function public.studkab_gen_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studkab_gen_jobs; p public.studkab_gen_parts; v_claim uuid;
begin
 update public.studkab_gen_attempts a set state='unknown',reason='LEASE_EXPIRED_AFTER_DISPATCH',finished_at=clock_timestamp()
  where a.state='sent' and exists(select 1 from public.studkab_gen_parts x join public.studkab_gen_jobs y on y.id=x.job_id
   where x.job_id=a.job_id and x.ordinal=a.ordinal and x.state='sent' and x.lease_until<=clock_timestamp()
   and y.status in ('cancelled','stale'));
 update public.studkab_gen_parts x set state='unknown'
  from public.studkab_gen_jobs y
  where y.id=x.job_id and y.status in ('cancelled','stale') and x.state='sent' and x.lease_until<=clock_timestamp();
 -- Lock job first in every operation; skip jobs currently used by other handlers.
 for j in select * from public.studkab_gen_jobs where status in ('queued','running')
 order by created_at for update skip locked loop
  update public.studkab_gen_attempts a set state='unknown',reason='LEASE_EXPIRED_AFTER_DISPATCH',finished_at=clock_timestamp()
   where a.job_id=j.id and a.state='sent' and exists(select 1 from public.studkab_gen_parts x where x.job_id=a.job_id and x.ordinal=a.ordinal and x.state='sent' and x.lease_until<=clock_timestamp());
  update public.studkab_gen_parts set state='unknown' where job_id=j.id and state='sent' and lease_until<=clock_timestamp();
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=j.id and state='claimed' and lease_until<=clock_timestamp();
  if exists(select 1 from public.studkab_gen_parts where job_id=j.id and state='unknown') then
   update public.studkab_gen_jobs set status='unknown' where id=j.id; continue;
  end if;
  select * into p from public.studkab_gen_parts where job_id=j.id and state!='done' order by ordinal limit 1;
  if not found then update public.studkab_gen_jobs set status='complete' where id=j.id; continue; end if;
  if p.state!='queued' then continue; end if;
  v_claim=gen_random_uuid();
  update public.studkab_gen_parts set state='claimed',claim=v_claim,lease_until=clock_timestamp()+interval '240 seconds' where job_id=j.id and ordinal=p.ordinal;
  update public.studkab_gen_jobs set status='running' where id=j.id;
  return jsonb_build_object('job_id',j.id,'ordinal',p.ordinal,'claim',v_claim,'version',j.version,'input',j.snapshot->'input','spec',p.spec);
 end loop;
 return null;
end $$;

-- 4. Отправка: перед резервом задание должно выполняться, а его паспорт —
--    оставаться утверждённым для тех же материалов.
create or replace function public.studkab_gen_dispatch(p_job uuid,p_ordinal integer,p_claim uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts; j public.studkab_gen_jobs; b public.studkab_gen_budget;
 policy public.studkab_gen_policy; cost bigint; used bigint; input_bytes bigint; output_tokens bigint; rid uuid;
begin
 select * into j from public.studkab_gen_jobs where id=p_job for update;
 select * into p from public.studkab_gen_parts where job_id=p_job and ordinal=p_ordinal;
 if not found or p.state!='claimed' or p.claim is distinct from p_claim or p.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM'; end if;
 if j.status is distinct from 'running' then
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 if not exists(select 1 from public.studkab_requirement_passports r
   where r.id=j.passport_id and r.status='approved'
   and r.source_fingerprint=coalesce(j.snapshot->'input'->>'material_fingerprint','')) then
  update public.studkab_gen_jobs set status='stale' where id=p_job;
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 output_tokens=(p.spec->>'max_output_tokens')::bigint;
 select 4096
   +octet_length(coalesce(j.snapshot->'input'->>'system',''))
   +octet_length(coalesce(j.snapshot->'input'->'prompts'->>(p.spec->>'prompt_ref'),''))
   +octet_length(coalesce(p.spec->>'prompt',''))
   +coalesce(sum(octet_length(result)+96),0)
 into input_bytes from public.studkab_gen_parts
 where job_id=p_job and ordinal<p_ordinal and state='done';
 -- Peak cache-miss input $0.30/M + output $1.20/M, with a 25% margin.
 -- UTF-8 bytes intentionally upper-bound input tokens.
 cost=(input_bytes*375+output_tokens*1500+999)/1000;
 select coalesce(sum(reservation_microusd),0) into used from public.studkab_gen_attempts where job_id=p_job;
 select * into policy from public.studkab_gen_policy where id=true;
 select * into b from public.studkab_gen_budget where id=true for update;
 if j.passport_id is null or j.max_cost_microusd is null or policy is null
    or cost>(p.spec->>'max_cost_microusd')::bigint
    or cost>j.max_cost_microusd-used
    or cost>least(b.limit_microusd,policy.temporary_total_microusd)-b.reserved_microusd then
  update public.studkab_gen_jobs set status='budget' where id=p_job;
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 rid=gen_random_uuid();
 update public.studkab_gen_budget set reserved_microusd=reserved_microusd+cost where id=true;
 insert into public.studkab_gen_attempts(request_id,job_id,ordinal,claim,state,reservation_microusd)
 values(rid,p_job,p_ordinal,p_claim,'sent',cost);
 update public.studkab_gen_parts set state='sent',request_id=rid,lease_until=clock_timestamp()+interval '240 seconds'
  where job_id=p_job and ordinal=p_ordinal;
 return rid;
end $$;

-- 5. Сохранение ответа: текст сохраняется всегда, но остановленное или
--    устаревшее задание не возвращается в работу.
create or replace function public.studkab_gen_settle(p_job uuid,p_ordinal integer,p_claim uuid,p_request uuid,p_text text,p_detail jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts; v_state text; safe jsonb='{}'; k text; v_job text;
begin
 select status into v_job from public.studkab_gen_jobs where id=p_job for update;
 select * into p from public.studkab_gen_parts where job_id=p_job and ordinal=p_ordinal;
 if not found or p.state!='sent' or p.claim is distinct from p_claim or p.request_id is distinct from p_request or p.lease_until<=clock_timestamp() then raise exception 'STALE_RESULT'; end if;
 v_state=case when length(trim(p_text))>0 then 'done' else 'unknown' end;
 if octet_length(p_text)>100000 then raise exception 'RESULT_TOO_BIG'; end if;
 foreach k in array array['finish_reason','request_id'] loop
  if (p_detail->>k) ~ '^[a-zA-Z0-9_.-]{1,120}$' then safe=safe||jsonb_build_object(k,p_detail->>k); end if;
 end loop;
 foreach k in array array['prompt_tokens','completion_tokens'] loop
  if (p_detail->>k) ~ '^[0-9]{1,10}$' then safe=safe||jsonb_build_object(k,(p_detail->>k)::bigint); end if;
 end loop;
 update public.studkab_gen_parts set state=v_state,result=case when v_state='done' then p_text else null end where job_id=p_job and ordinal=p_ordinal;
 update public.studkab_gen_attempts set state=v_state,reason=case when v_state='unknown' then 'RESULT_UNKNOWN' else null end,detail=safe,finished_at=clock_timestamp() where request_id=p_request;
 if v_job in ('cancelled','stale') then return v_state; end if;
 update public.studkab_gen_jobs set status=case when v_state='unknown' then 'unknown'
 when not exists(select 1 from public.studkab_gen_parts where job_id=p_job and state!='done') then 'complete' else 'running' end where id=p_job;
 return v_state;
end $$;

-- 6. Новый запуск с теми же материалами после остановки создаёт новое задание,
--    а не возвращает остановленное.
create or replace function public.studkab_gen_start(
 p_owner uuid,p_request text,p_input jsonb,p_plan jsonb,p_passport uuid,
 p_work_kind text,p_max_cost_microusd bigint
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_snapshot jsonb; v_base text; v_version text; v_id uuid; v_status text; v_n integer; s jsonb; approved uuid; allowed bigint;
begin
 if p_request !~ '^[a-f0-9-]{36}$' then raise exception 'INVALID_REQUEST'; end if;
 select id into approved from public.studkab_requirement_passports
  where id=p_passport and request_id=p_request::uuid and status='approved'
    and source_fingerprint=coalesce(p_input->>'material_fingerprint','') for share;
 if approved is null then raise exception 'PASSPORT_REQUIRED'; end if;
 select max_cost_microusd into allowed from public.studkab_gen_limits where work_kind=p_work_kind;
 if allowed is null or allowed<>p_max_cost_microusd then raise exception 'INVALID_WORK_LIMIT'; end if;
 if p_input is null or jsonb_typeof(p_input)!='object' or p_plan is null or jsonb_typeof(p_plan)!='array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_plan) not between 1 and 100 then raise exception 'INVALID_PLAN'; end if;
 for s in select value from jsonb_array_elements(p_plan) loop
  if jsonb_typeof(s)!='object' or coalesce(s->>'id','')='' or coalesce(s->>'prompt','')=''
     or coalesce(s->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,11}$'
     or coalesce(s->>'max_output_tokens','') !~ '^[1-9][0-9]{0,3}$'
     or (s->>'max_output_tokens')::integer>8000 then raise exception 'INVALID_PART'; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_plan))!=jsonb_array_length(p_plan) then raise exception 'DUPLICATE_PART'; end if;
 v_snapshot=jsonb_build_object('input',p_input,'plan',p_plan,'passport_id',p_passport,
  'work_kind',p_work_kind,'max_cost_microusd',p_max_cost_microusd);
 if octet_length(v_snapshot::text)>1000000 then raise exception 'INPUT_TOO_BIG'; end if;
 v_base=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_request,0));
 select id,status into v_id,v_status from public.studkab_gen_jobs
  where owner_id=p_owner and request_id=p_request and (version=v_base or version like v_base||':r%')
  order by created_at desc limit 1;
 if v_id is not null and v_status not in ('cancelled','stale') then return v_id; end if;
 select count(*) into v_n from public.studkab_gen_jobs
  where owner_id=p_owner and request_id=p_request and (version=v_base or version like v_base||':r%');
 v_version=case when v_n=0 then v_base else v_base||':r'||v_n end;
 insert into public.studkab_gen_jobs(owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd)
 values(p_owner,p_request,v_version,v_snapshot,p_passport,p_work_kind,p_max_cost_microusd) returning id into v_id;
 insert into public.studkab_gen_parts(job_id,ordinal,spec)
 select v_id,(ordinality-1)::integer,value from jsonb_array_elements(p_plan) with ordinality;
 return v_id;
end $$;
$c051_body$]);
commit;
-- Проверка: ожидается одна строка «Установлено».
select 'Установлено' as result where (select count(*) from supabase_migrations.schema_migrations where version in ('20260915130000'))=1;
