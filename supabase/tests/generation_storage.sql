-- Run only against an otherwise empty generation queue. Rolls back all fixtures.
begin;

do $$
declare owner uuid; a uuid; b uuid; c jsonb; rid uuid; prior bigint;
 plan jsonb='[{"id":"ch1.1","prompt":"test only","max_cost_microusd":10},{"id":"ch1.2","prompt":"test only","max_cost_microusd":10}]';
begin
 select id into owner from auth.users order by created_at limit 1;
 if owner is null then raise exception 'TEST_NEEDS_EXISTING_USER'; end if;
 update public.studkab_gen_budget set limit_microusd=20 where id=true;
 a=public.studkab_gen_start(owner,'__transactional_test__','{"material":"old"}',plan);
 if a!=public.studkab_gen_start(owner,'__transactional_test__','{"material":"old"}',plan) then raise exception 'DUPLICATE_START'; end if;
 c=public.studkab_gen_claim();
 if (c->>'job_id')::uuid!=a then raise exception 'WRONG_CLAIM'; end if;
 if public.studkab_gen_claim() is not null then raise exception 'CONCURRENT_CLAIM'; end if;
 rid=public.studkab_gen_dispatch(a,0,(c->>'claim')::uuid);
 perform public.studkab_gen_settle(a,0,(c->>'claim')::uuid,rid,'saved part','{"prompt_tokens":15,"secret":"MUST_NOT_PERSIST"}');
 if exists(select 1 from public.studkab_gen_attempts where detail ? 'secret') then raise exception 'DETAIL_LEAK'; end if;
 begin
  update public.studkab_gen_parts set result='overwrite' where job_id=a and ordinal=0;
  raise exception 'IMMUTABILITY_NOT_ENFORCED';
 exception when raise_exception then if sqlerrm!='IMMUTABLE_RESULT' then raise; end if; end;
 c=public.studkab_gen_claim();
 -- Expire un-dispatched claim: safe recovery with a new fencing token.
 update public.studkab_gen_parts set lease_until=now()-interval '1 second' where job_id=a and ordinal=1;
 perform public.studkab_gen_claim();
 begin
  perform public.studkab_gen_dispatch(a,1,(c->>'claim')::uuid);
  raise exception 'OLD_CLAIM_ACCEPTED';
 exception when raise_exception then if sqlerrm!='STALE_CLAIM' then raise; end if; end;
 select jsonb_build_object('claim',claim) into c from public.studkab_gen_parts where job_id=a and ordinal=1;
 rid=public.studkab_gen_dispatch(a,1,(c->>'claim')::uuid);
 -- Expire sent claim: delivery is unknown and must not be retried.
 update public.studkab_gen_parts set lease_until=now()-interval '1 second' where job_id=a and ordinal=1;
 perform public.studkab_gen_claim();
 if (select status from public.studkab_gen_jobs where id=a)!='unknown' then raise exception 'MISSING_UNKNOWN'; end if;
 if (select result from public.studkab_gen_parts where job_id=a and ordinal=0)!='saved part' then raise exception 'CHECKPOINT_LOST'; end if;
 if public.studkab_gen_claim() is not null then raise exception 'UNKNOWN_RETRIED'; end if;
 begin
  perform public.studkab_gen_settle(a,1,(c->>'claim')::uuid,rid,'late','{}');
  raise exception 'LATE_RESULT_ACCEPTED';
 exception when raise_exception then if sqlerrm!='STALE_RESULT' then raise; end if; end;
 b=public.studkab_gen_start(owner,'__transactional_test__','{"material":"new"}',plan);
 if a=b then raise exception 'VERSION_MIX'; end if;
 c=public.studkab_gen_claim();
 if public.studkab_gen_dispatch(b,0,(c->>'claim')::uuid) is not null then raise exception 'GLOBAL_BUDGET_RESET'; end if;
 if (select status from public.studkab_gen_jobs where id=b)!='budget' then raise exception 'BUDGET_NOT_BLOCKED'; end if;
 if (select count(*) from public.studkab_gen_attempts)!=2 then raise exception 'ATTEMPT_DUPLICATION'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform * from public.studkab_gen_jobs; raise exception 'CLIENT_READ_ALLOWED';
 exception when insufficient_privilege then null; end;
 begin perform public.studkab_gen_claim(); raise exception 'CLIENT_DISPATCH_ALLOWED';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform * from public.studkab_gen_parts; raise exception 'ANON_READ_ALLOWED';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: idempotent start, claim exclusion, fencing, immutable checkpoints, unknown delivery, late response, version separation, aggregate budget, diagnostic filtering, client access denied' as result;

rollback;
