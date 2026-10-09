-- Stage 3: one shared budget, retained dispatch reservations; no policy/limit changes.
create table public.studkab_assistant_attempts (
 dispatch_id uuid primary key default gen_random_uuid(),
 job_id uuid not null unique,
 claim uuid not null, model text not null check(model='deepseek-flash'),
 reservation_microusd bigint not null check(reservation_microusd between 1 and 75036),
 state text not null check(state in ('sent','unknown','done')),
 started_at timestamptz not null default clock_timestamp(), finished_at timestamptz
);
alter table public.studkab_assistant_attempts enable row level security;
revoke all on public.studkab_assistant_attempts from public,anon,authenticated,service_role;
grant select,insert,update on public.studkab_assistant_attempts to service_role;
create function public.studkab_assistant_attempt_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' or (new.dispatch_id,new.job_id,new.claim,new.model,new.reservation_microusd,new.started_at) is distinct from (old.dispatch_id,old.job_id,old.claim,old.model,old.reservation_microusd,old.started_at)
 or (old.state in ('unknown','done') and new is distinct from old) then raise exception 'IMMUTABLE_ASSISTANT_RESERVE';end if;
 return new;
end $$;
create trigger assistant_attempt_immutable before update or delete on public.studkab_assistant_attempts for each row execute function public.studkab_assistant_attempt_immutable();
create or replace function public.studkab_gen_expected_reserved() returns bigint language sql stable security invoker set search_path='' as $$
 select coalesce((select sum(a.reservation_microusd) from public.studkab_gen_attempts a where not exists(select 1 from public.studkab_gen_reconciliations r where a.request_id=any(r.request_ids))),0)
 +coalesce((select sum(r.retained_microusd) from public.studkab_gen_reconciliations r),0)
 +coalesce((select sum(j.reserved_microusd) from public.studkab_intake_analysis_jobs j),0)
 +coalesce((select sum(a.reservation_microusd) from public.studkab_assistant_attempts a),0)
$$;
revoke all on function public.studkab_gen_expected_reserved() from public,anon,authenticated,service_role;
-- Existing intake dispatch already uses this narrow predicate; no reconciliation rows exposed.
create or replace function public.studkab_intake_ledger_matches(p_reserved bigint) returns boolean language sql stable security definer set search_path='' as $$
 select p_reserved is not null and p_reserved=public.studkab_gen_expected_reserved()
$$;
revoke all on function public.studkab_intake_ledger_matches(bigint) from public,anon,authenticated;
grant execute on function public.studkab_intake_ledger_matches(bigint) to service_role;
create function public.studkab_assistant_budget(p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare available bigint;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select greatest(0,least(b.limit_microusd,p.temporary_total_microusd)-b.reserved_microusd) into available from public.studkab_gen_budget b join public.studkab_gen_policy p using(id) where b.id;
 return jsonb_build_object('remainingMicrousd',coalesce(available,0),'availableMicrousd',coalesce(available,0),'budgetAvailable',coalesce(available,0)>0);
end $$;
create table public.studkab_assistant_quotes (
 id uuid primary key default gen_random_uuid(),job_id uuid not null unique references public.studkab_assistant_jobs(id) on delete cascade,
 actor_id uuid not null,revision integer not null,fingerprint text not null,sections jsonb not null,
 estimated_microusd bigint not null check(estimated_microusd between 1 and 75036),
 created_at timestamptz not null default clock_timestamp(),confirmed_at timestamptz
);
alter table public.studkab_assistant_quotes enable row level security;
revoke all on public.studkab_assistant_quotes from public,anon,authenticated,service_role;
grant select,insert,update(confirmed_at) on public.studkab_assistant_quotes to service_role;
create function public.studkab_assistant_quote_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.studkab_assistant_jobs where id=old.job_id) then return old;end if;
 if tg_op='DELETE' or (new.id,new.job_id,new.actor_id,new.revision,new.fingerprint,new.sections,new.estimated_microusd,new.created_at) is distinct from (old.id,old.job_id,old.actor_id,old.revision,old.fingerprint,old.sections,old.estimated_microusd,old.created_at) or (old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at) then raise exception 'IMMUTABLE_ASSISTANT_QUOTE';end if;
 return new;
end $$;
create trigger assistant_quote_immutable before update or delete on public.studkab_assistant_quotes for each row execute function public.studkab_assistant_quote_immutable();
-- Only the trusted server computes p_estimated from its full verified prompt.
create function public.studkab_assistant_quote(p_job uuid,p_actor uuid,p_estimated bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;q public.studkab_assistant_quotes;b jsonb;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.studkab_requests where id=(select request_id from public.studkab_assistant_jobs where id=p_job) for update;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found or j.provider!='deepseek' or j.state!='prepared' or j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'QUOTE_BINDING_CHANGED';end if;
 if jsonb_array_length(j.expected_sections)=0 then raise exception 'PLAN_REQUIRED';end if;
 if p_estimated is null or p_estimated not between 1 and 75036 then raise exception 'INVALID_RESERVE';end if;
 b=public.studkab_assistant_budget(p_actor);
 if (b->>'remainingMicrousd')::bigint<p_estimated then return jsonb_build_object('ok',false,'reason','budget','remainingMicrousd',(b->>'remainingMicrousd')::bigint);end if;
 select * into q from public.studkab_assistant_quotes where job_id=j.id;
 if found and q.estimated_microusd<>p_estimated then raise exception 'QUOTE_PRICE_CHANGED';end if;
 if not found then insert into public.studkab_assistant_quotes(job_id,actor_id,revision,fingerprint,sections,estimated_microusd) values(j.id,p_actor,j.revision,j.fingerprint,j.expected_sections,p_estimated) returning * into q;end if;
 return jsonb_build_object('ok',true,'quoteId',q.id,'estimatedMicrousd',q.estimated_microusd,'confirmed',q.confirmed_at is not null);
end $$;
create function public.studkab_assistant_confirm_queue(p_job uuid,p_actor uuid,p_quote uuid,p_confirmed_microusd bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;q public.studkab_assistant_quotes;b jsonb;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.studkab_requests where id=(select request_id from public.studkab_assistant_jobs where id=p_job) for update;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 select * into q from public.studkab_assistant_quotes where id=p_quote and job_id=p_job and actor_id=p_actor for update;
 if j.id is null or q.id is null or q.estimated_microusd is distinct from p_confirmed_microusd or q.revision<>j.revision or q.fingerprint<>j.fingerprint or q.sections<>j.expected_sections or j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'QUOTE_BINDING_CHANGED';end if;
 if q.confirmed_at is not null then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if j.state!='prepared' then raise exception 'JOB_NOT_READY';end if;
 b=public.studkab_assistant_budget(p_actor);
 if (b->>'remainingMicrousd')::bigint<q.estimated_microusd then return jsonb_build_object('ok',false,'reason','budget','remainingMicrousd',(b->>'remainingMicrousd')::bigint);end if;
 update public.studkab_assistant_quotes set confirmed_at=clock_timestamp() where id=q.id;
 update public.studkab_assistant_jobs set state='queued',queued_at=clock_timestamp() where id=j.id;
 return jsonb_build_object('ok',true);
end $$;
create function public.studkab_assistant_reserve_dispatch(p_job uuid,p_actor uuid,p_claim uuid,p_estimated bigint,p_model text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;b public.studkab_gen_budget;policy public.studkab_gen_policy;a public.studkab_assistant_attempts;available bigint;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.studkab_requests where id=(select request_id from public.studkab_assistant_jobs where id=p_job) for update;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found or j.state!='claimed' or j.claim is distinct from p_claim or j.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM';end if;
 if j.provider!='deepseek' or p_model is distinct from 'deepseek-flash' or p_estimated is null or p_estimated not between 1 and 75036 then raise exception 'INVALID_RESERVE';end if;
 if jsonb_array_length(j.expected_sections)=0 then raise exception 'PLAN_REQUIRED';end if;
 if not exists(select 1 from public.studkab_assistant_quotes q where q.job_id=j.id and q.actor_id=p_actor and q.confirmed_at is not null and q.estimated_microusd=p_estimated and q.revision=j.revision and q.fingerprint=j.fingerprint and q.sections=j.expected_sections) then raise exception 'PAID_CONFIRMATION_REQUIRED';end if;
 if j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 select * into policy from public.studkab_gen_policy where id;
 select * into b from public.studkab_gen_budget where id for update;
 available=greatest(0,least(b.limit_microusd,policy.temporary_total_microusd)-b.reserved_microusd);
 if b.id is null or policy.id is null or p_estimated>available then
  update public.studkab_assistant_jobs set state='queued',claim=null,lease_until=null where id=j.id;
  return jsonb_build_object('ok',false,'reason','budget','remainingMicrousd',coalesce(available,0));
 end if;
 if not public.studkab_intake_ledger_matches(b.reserved_microusd) then raise exception 'LEDGER_MISMATCH';end if;
 insert into public.studkab_assistant_attempts(job_id,claim,model,reservation_microusd,state) values(j.id,p_claim,p_model,p_estimated,'sent') returning * into a;
 update public.studkab_gen_budget set reserved_microusd=reserved_microusd+p_estimated where id;
 update public.studkab_assistant_jobs set state='dispatched',started_at=a.started_at,lease_until=clock_timestamp()+interval '4 minutes' where id=j.id;
 return jsonb_build_object('ok',true,'dispatchId',a.dispatch_id,'reservedMicrousd',a.reservation_microusd);
end $$;
-- Ledger proof is mandatory for DeepSeek even if an old internal caller uses stage 2 dispatch.
create or replace function public.studkab_assistant_dispatch(p_job uuid,p_actor uuid,p_claim uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found or j.state!='claimed' or j.claim is distinct from p_claim or j.lease_until<=now() then raise exception 'STALE_CLAIM';end if;
 if j.provider='deepseek' then raise exception 'FINANCIAL_DISPATCH_REQUIRED';end if;
 if j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 update public.studkab_assistant_jobs set state='dispatched',started_at=now(),lease_until=now()+interval '4 minutes' where id=j.id;
 return jsonb_build_object('ok',true,'dispatchId',j.claim);
end $$;

create function public.studkab_assistant_financial_transition() returns trigger language plpgsql security invoker set search_path='' as $$
declare a public.studkab_assistant_attempts;
begin
 if new.provider!='deepseek' then return new;end if;
 if new.state='completed' and old.state!='completed' then
  select * into a from public.studkab_assistant_attempts where job_id=new.id;
  if not found or new.response->>'dispatchId' is distinct from a.dispatch_id::text then raise exception 'DISPATCH_RECEIPT_REQUIRED';end if;
  if old.state='returning' and a.state='done' and new.response=old.response then return new;end if;
  if old.state!='dispatched' or a.state!='sent' or a.claim is distinct from old.claim then raise exception 'DISPATCH_RECEIPT_REQUIRED';end if;
  update public.studkab_assistant_attempts set state='done',finished_at=clock_timestamp() where dispatch_id=a.dispatch_id;
 elsif new.state='unknown' and old.state='dispatched' then
  update public.studkab_assistant_attempts set state='unknown',finished_at=clock_timestamp() where job_id=new.id and state='sent';
 end if;
 return new;
end $$;
create trigger assistant_financial_transition before update on public.studkab_assistant_jobs for each row execute function public.studkab_assistant_financial_transition();
create function public.studkab_assistant_unknown(p_job uuid,p_actor uuid,p_claim uuid,p_dispatch uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found or j.claim is distinct from p_claim or not exists(select 1 from public.studkab_assistant_attempts where job_id=j.id and dispatch_id=p_dispatch and claim=p_claim) then raise exception 'STALE_DISPATCH';end if;
 if j.state='unknown' then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if j.state!='dispatched' then raise exception 'STALE_DISPATCH';end if;
 update public.studkab_assistant_jobs set state='unknown',lease_until=null where id=j.id;
 return jsonb_build_object('ok',true);
end $$;
create function public.studkab_assistant_claim_next(p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare candidate record;j public.studkab_assistant_jobs;permit jsonb;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 for candidate in select id,request_id from public.studkab_assistant_jobs where owner_id=p_actor and provider='deepseek' and state in ('queued','claimed','dispatched','completed','returning') order by accepted_at,id loop
  -- Consistent request -> job order; both locks skip occupied work.
  perform 1 from public.studkab_requests where id=candidate.request_id for update skip locked;
  if not found then continue;end if;
  select * into j from public.studkab_assistant_jobs where id=candidate.id for update skip locked;
  if not found then continue;end if;
  if j.state='returning' and j.return_lease_until>clock_timestamp() then continue;end if;
  if j.state in ('completed','returning') then return jsonb_build_object('allowed',false,'recovery',true,'jobId',j.id);end if;
  if j.state='dispatched' then
   if j.lease_until<=clock_timestamp() then update public.studkab_assistant_jobs set state='unknown' where id=j.id;end if;
   continue;
  end if;
  if j.state='claimed' and j.lease_until>clock_timestamp() then continue;end if;
  if j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then continue;end if;
  permit=public.studkab_assistant_claim(j.id,p_actor);
  if permit->>'allowed'='true' then return permit||jsonb_build_object('jobId',j.id,'basis',j.basis);end if;
 end loop;
 return jsonb_build_object('allowed',false);
end $$;
revoke all on function public.studkab_assistant_attempt_immutable(),public.studkab_assistant_financial_transition(),public.studkab_assistant_budget(uuid),public.studkab_assistant_reserve_dispatch(uuid,uuid,uuid,bigint,text),public.studkab_assistant_unknown(uuid,uuid,uuid,uuid),public.studkab_assistant_claim_next(uuid) from public,anon,authenticated;
grant execute on function public.studkab_assistant_budget(uuid),public.studkab_assistant_reserve_dispatch(uuid,uuid,uuid,bigint,text),public.studkab_assistant_unknown(uuid,uuid,uuid,uuid),public.studkab_assistant_claim_next(uuid) to service_role;

create function public.studkab_assistant_runner_actor() returns uuid language sql stable security invoker set search_path='' as $$
 select case when count(*)=1 then (array_agg(u.id))[1] else null end from auth.users u where lower(u.email)=(select lower(executor_email) from public.studkab_request_config limit 1)
$$;
create function public.studkab_assistant_fail_claim(p_job uuid,p_actor uuid,p_claim uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 update public.studkab_assistant_jobs set state='prepared',claim=null,lease_until=null where id=p_job and owner_id=p_actor and state='claimed' and claim=p_claim and started_at is null;
 return found;
end $$;
create table public.studkab_assistant_plans (
 job_id uuid primary key references public.studkab_assistant_jobs(id) on delete cascade,
 fingerprint text not null, sections jsonb not null, evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.studkab_assistant_plans enable row level security;
revoke all on public.studkab_assistant_plans from public,anon,authenticated,service_role;
grant select,insert on public.studkab_assistant_plans to service_role;
create function public.studkab_assistant_plan_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.studkab_assistant_jobs where id=old.job_id) then return old;end if;
 raise exception 'IMMUTABLE_ASSISTANT_PLAN';end $$;
create trigger assistant_plan_immutable before update or delete on public.studkab_assistant_plans for each row execute function public.studkab_assistant_plan_immutable();
create or replace function public.studkab_assistant_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.request_id,new.owner_id,new.operation_id,new.provider,new.revision,new.fingerprint,new.basis,new.snapshot,new.accepted_at)
 is distinct from (old.id,old.request_id,old.owner_id,old.operation_id,old.provider,old.revision,old.fingerprint,old.basis,old.snapshot,old.accepted_at) then raise exception 'IMMUTABLE_ASSISTANT_SNAPSHOT';end if;
 if new.expected_sections is distinct from old.expected_sections and not (old.state='prepared' and new.state='prepared' and old.expected_sections='[]'::jsonb and exists(select 1 from public.studkab_assistant_plans p where p.job_id=new.id and p.fingerprint=new.fingerprint and p.sections=new.expected_sections)) then raise exception 'IMMUTABLE_ASSISTANT_PLAN';end if;
 if old.response is not null and new.response is distinct from old.response then raise exception 'IMMUTABLE_ASSISTANT_RESPONSE';end if;
 if old.returned_at is not null and (new.returned_at,new.result_hash,new.result_path) is distinct from (old.returned_at,old.result_hash,old.result_path) then raise exception 'IMMUTABLE_ASSISTANT_RECEIPT';end if;
 return new;
end $$;
create function public.studkab_assistant_freeze_plan(p_job uuid,p_actor uuid,p_revision integer,p_fingerprint text,p_sections jsonb,p_evidence jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;s jsonb;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.studkab_requests where id=(select request_id from public.studkab_assistant_jobs where id=p_job) for update;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found or j.state!='prepared' or j.revision is distinct from p_revision or j.fingerprint is distinct from p_fingerprint or j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'PLAN_BINDING_CHANGED';end if;
 if j.expected_sections=p_sections then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if j.expected_sections!='[]'::jsonb then raise exception 'IMMUTABLE_ASSISTANT_PLAN';end if;
 if jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections) not between 1 and 96 or (select count(distinct value) from jsonb_array_elements(p_sections))<>jsonb_array_length(p_sections) then raise exception 'INVALID_PLAN';end if;
 for s in select value from jsonb_array_elements(p_sections) loop
  if jsonb_typeof(s) is distinct from 'string' or (s#>>'{}') !~ '^[a-zA-Z0-9_-]{1,80}$' then raise exception 'INVALID_PLAN';end if;
 end loop;
 if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence->>'method' is distinct from 'server-source-plan' or p_evidence->>'sourceFingerprint' is distinct from j.fingerprint or coalesce(p_evidence->>'readerVersion','')='' or jsonb_typeof(p_evidence->'sourceRefs') is distinct from 'array' or jsonb_array_length(p_evidence->'sourceRefs')=0 or octet_length(p_evidence::text)>100000 then raise exception 'SOURCE_PLAN_REQUIRED';end if;
 for s in select value from jsonb_array_elements(p_evidence->'sourceRefs') loop
  if jsonb_typeof(s) is distinct from 'string' or not (exists(select 1 from jsonb_array_elements(j.basis->'attachments') a where a->>'id'=s#>>'{}') or ((s#>>'{}') in ('request.rq','request.mn','request.requirements','request.instructions') and length(btrim(coalesce(j.basis->'payload'->>substring(s#>>'{}' from 9),'')))>0)) then raise exception 'SOURCE_PLAN_REQUIRED';end if;
 end loop;
 insert into public.studkab_assistant_plans(job_id,fingerprint,sections,evidence) values(j.id,j.fingerprint,p_sections,p_evidence);
 update public.studkab_assistant_jobs set expected_sections=p_sections where id=j.id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.studkab_assistant_runner_actor(),public.studkab_assistant_fail_claim(uuid,uuid,uuid),public.studkab_assistant_plan_immutable(),public.studkab_assistant_freeze_plan(uuid,uuid,integer,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_assistant_runner_actor(),public.studkab_assistant_fail_claim(uuid,uuid,uuid),public.studkab_assistant_freeze_plan(uuid,uuid,integer,text,jsonb,jsonb) to service_role;

revoke all on function public.studkab_assistant_quote_immutable(),public.studkab_assistant_quote(uuid,uuid,bigint),public.studkab_assistant_confirm_queue(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.studkab_assistant_quote(uuid,uuid,bigint),public.studkab_assistant_confirm_queue(uuid,uuid,uuid,bigint) to service_role;

create or replace function public.studkab_assistant_return_snapshot(p_job uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor;
 if not found then raise exception 'JOB_NOT_FOUND';end if;
 return jsonb_build_object('snapshot',j.snapshot,'response',j.response,'revision',j.revision,'fingerprint',j.fingerprint,'provider',j.provider,'requestId',j.request_id,'basis',j.basis,'expectedSections',j.expected_sections);
end $$;

create or replace function public.studkab_assistant_complete(p_job uuid,p_actor uuid,p_claim uuid,p_response jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.studkab_requests where id=(select request_id from public.studkab_assistant_jobs where id=p_job) for update;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found then raise exception 'JOB_NOT_FOUND';end if;
 if j.response is not null and j.response=p_response then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if j.state!='dispatched' or j.claim is distinct from p_claim or j.lease_until<=now() or jsonb_typeof(p_response) is distinct from 'object' or octet_length(p_response::text)>5000000 then raise exception 'UNCONFIRMED_RESULT';end if;
 if j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 if p_response->>'status' is distinct from 'completed' or p_response->>'jobId' is distinct from j.id::text or p_response->>'requestId' is distinct from j.request_id::text or p_response->>'provider' is distinct from j.provider or p_response->>'revision' is distinct from j.revision::text or p_response->>'fingerprint' is distinct from j.fingerprint or jsonb_typeof(p_response->'sections') is distinct from 'array' then raise exception 'RESULT_BINDING_CHANGED';end if;
 if jsonb_array_length(j.expected_sections)=0 or jsonb_array_length(p_response->'sections')<>jsonb_array_length(j.expected_sections) then raise exception 'INCOMPLETE_DOCUMENT';end if;
 if exists(select 1 from jsonb_array_elements(p_response->'sections') with ordinality as s(value,n)
 where s.value->>'id' is distinct from j.expected_sections->>(s.n::integer-1) or jsonb_typeof(s.value->'text') is distinct from 'string' or length(btrim(s.value->>'text'))=0) then raise exception 'INCOMPLETE_DOCUMENT';end if;
 update public.studkab_assistant_jobs set state='completed',response=p_response,claim=null,lease_until=null where id=j.id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.studkab_assistant_accept(p_request uuid,p_actor uuid,p_provider text,p_operation uuid,p_revision integer,p_fingerprint text,p_basis jsonb,p_snapshot jsonb,p_sections jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests;j public.studkab_assistant_jobs;s jsonb;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into r from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then raise exception 'REQUEST_NOT_FOUND';end if;
 select z.* into j from public.studkab_assistant_jobs z join public.studkab_assistant_operations o on o.job_id=z.id where o.owner_id=p_actor and o.operation_id=p_operation;
 if found then
  if (j.request_id,j.provider,j.revision,j.fingerprint,j.basis,j.snapshot) is distinct from (p_request,p_provider,p_revision,p_fingerprint,p_basis,p_snapshot) or not (j.expected_sections=p_sections or (p_sections='[]'::jsonb and exists(select 1 from public.studkab_assistant_plans plan where plan.job_id=j.id and plan.fingerprint=j.fingerprint and plan.sections=j.expected_sections))) then raise exception 'OPERATION_CONFLICT';end if;
  return jsonb_build_object('jobId',j.id,'duplicate',true,'state',j.state,'acceptedAt',j.accepted_at);
 end if;
 if p_provider not in ('claude','chatgpt','deepseek') or p_operation is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_revision is distinct from r.revision or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>36000000 or jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections) not between 0 and 96 then raise exception 'INVALID_JOB';end if;
 if exists(select 1 from jsonb_array_elements(p_sections) x where jsonb_typeof(x)!='string' or (x#>>'{}') !~ '^[a-zA-Z0-9_-]{1,80}$') or (select count(distinct x) from jsonb_array_elements(p_sections) x)<>jsonb_array_length(p_sections) then raise exception 'INVALID_PLAN';end if;
 s:=public.studkab_assistant_snapshot(p_request,p_actor);
 if p_basis is distinct from s->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 select * into j from public.studkab_assistant_jobs where request_id=p_request and provider=p_provider and basis=p_basis and state!='cancelled' order by accepted_at desc,id desc limit 1;
 if found then
  if j.fingerprint is distinct from p_fingerprint or not (j.expected_sections=p_sections or (p_sections='[]'::jsonb and exists(select 1 from public.studkab_assistant_plans plan where plan.job_id=j.id and plan.fingerprint=j.fingerprint and plan.sections=j.expected_sections))) or j.snapshot is distinct from p_snapshot then raise exception 'OPERATION_CONFLICT';end if;
  insert into public.studkab_assistant_operations(owner_id,operation_id,request_id,job_id) values(p_actor,p_operation,p_request,j.id);
  return jsonb_build_object('jobId',j.id,'duplicate',true,'state',j.state,'acceptedAt',j.accepted_at);
 end if;
 if exists(select 1 from public.studkab_assistant_jobs where request_id=p_request and state in ('prepared','queued','claimed','dispatched','completed','returning','unknown')) then raise exception 'ACTIVE_JOB_EXISTS';end if;
 insert into public.studkab_assistant_jobs(request_id,owner_id,operation_id,provider,revision,fingerprint,basis,snapshot,expected_sections)
 values(p_request,p_actor,p_operation,p_provider,p_revision,p_fingerprint,p_basis,p_snapshot,p_sections) returning * into j;
 insert into public.studkab_assistant_operations(owner_id,operation_id,request_id,job_id) values(p_actor,p_operation,p_request,j.id);
 return jsonb_build_object('jobId',j.id,'duplicate',false,'state',j.state,'acceptedAt',j.accepted_at);
end $$;
-- Recovery only: no queued claim, provider connection or new budget is needed.
create function public.studkab_assistant_recover_next(p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare candidate record;j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 for candidate in select id,request_id from public.studkab_assistant_jobs where owner_id=p_actor and state in ('completed','returning') order by accepted_at,id loop
  perform 1 from public.studkab_requests where id=candidate.request_id for update skip locked;
  if not found then continue;end if;
  select * into j from public.studkab_assistant_jobs where id=candidate.id for update skip locked;
  if not found or (j.state='returning' and j.return_lease_until>clock_timestamp()) then continue;end if;
  if j.state not in ('completed','returning') or j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then continue;end if;
  return jsonb_build_object('recovery',true,'jobId',j.id);
 end loop;
 return jsonb_build_object('recovery',false);
end $$;
revoke all on function public.studkab_assistant_recover_next(uuid) from public,anon,authenticated;
grant execute on function public.studkab_assistant_recover_next(uuid) to service_role;
