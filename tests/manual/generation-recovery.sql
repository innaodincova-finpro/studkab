begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
lock table public.studkab_gen_jobs,public.studkab_gen_parts,public.studkab_gen_attempts,public.studkab_gen_budget in exclusive mode;
do $$
declare owner uuid; jid uuid; oldclaim jsonb; newclaim jsonb; rid uuid; rejected boolean=false; initial_reserved bigint;
begin
 if exists(select 1 from public.studkab_gen_jobs where status in ('queued','running')) then raise exception 'ACTIVE_WORK_ABORT'; end if;
 select reserved_microusd into initial_reserved from public.studkab_gen_budget where id=true;
 if initial_reserved<>750000 then raise exception 'UNEXPECTED_BUDGET'; end if;
 select u.id into strict owner from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) where c.id=true;
 jid=public.studkab_gen_start(owner,'rollback-recovery-check','{"system":"Synthetic recovery test"}', '[{"id":"test","prompt":"No provider call","max_cost_microusd":250000}]');
 oldclaim=public.studkab_gen_claim();
 if (oldclaim->>'job_id')::uuid<>jid then raise exception 'WRONG_CLAIM'; end if;
 update public.studkab_gen_parts set lease_until=clock_timestamp()-interval '1 second' where job_id=jid;
 newclaim=public.studkab_gen_claim();
 if newclaim->>'claim'=oldclaim->>'claim' then raise exception 'CLAIM_NOT_REPLACED'; end if;
 begin
  perform public.studkab_gen_dispatch(jid,0,(oldclaim->>'claim')::uuid);
 exception when others then
  if sqlerrm<>'STALE_CLAIM' then raise; end if; rejected=true;
 end;
 if not rejected then raise exception 'STALE_DISPATCH_ACCEPTED'; end if;
 rid=public.studkab_gen_dispatch(jid,0,(newclaim->>'claim')::uuid);
 if rid is null then raise exception 'DISPATCH_NOT_RESERVED'; end if;
 -- Only database dispatch; no HTTP, no model request, no commit.
 update public.studkab_gen_parts set lease_until=clock_timestamp()-interval '1 second' where job_id=jid;
 if public.studkab_gen_claim() is not null then raise exception 'SENT_WAS_RECLAIMED'; end if;
 if (select status from public.studkab_gen_jobs where id=jid)<>'unknown' then raise exception 'UNKNOWN_MISSING'; end if;
 if (select reason from public.studkab_gen_attempts where request_id=rid)<>'LEASE_EXPIRED_AFTER_DISPATCH' then raise exception 'REASON_MISSING'; end if;
 rejected=false;
 begin
  perform public.studkab_gen_settle(jid,0,(newclaim->>'claim')::uuid,rid,'late result','{}');
 exception when others then
  if sqlerrm<>'STALE_RESULT' then raise; end if; rejected=true;
 end;
 if not rejected then raise exception 'LATE_RESULT_ACCEPTED'; end if;
 if (select count(*) from public.studkab_gen_attempts where job_id=jid)<>1 then raise exception 'DUPLICATED_ATTEMPT'; end if;
end $$;
select 'PASS: expired unsent claim replaced; old dispatch rejected; expired sent attempt unknown without retry; late result rejected; all fixtures rolled back' as result;
rollback;
