-- A1.2-A1.4 closed fault-injection fixture.
-- This schema exists only in the disposable Safety PostgreSQL service.
drop schema if exists studkab_a1_fault cascade;
create schema studkab_a1_fault;

create table studkab_a1_fault.runs (
 id uuid primary key default gen_random_uuid(),
 marker text not null default 'A1-SYNTHETIC' check(marker='A1-SYNTHETIC'),
 scenario text not null check(scenario in ('worker-stop','concurrent-workers','post-send-loss')),
 status text not null default 'queued' check(status in ('queued','running','unknown','complete'))
);
create table studkab_a1_fault.parts (
 run_id uuid primary key references studkab_a1_fault.runs(id) on delete cascade,
 marker text not null default 'A1-SYNTHETIC' check(marker='A1-SYNTHETIC'),
 state text not null default 'queued' check(state in ('queued','claimed','sent','unknown','done')),
 claim uuid, lease_until timestamptz, request_id uuid, result text
);
create table studkab_a1_fault.attempts (
 request_id uuid primary key,
 run_id uuid not null references studkab_a1_fault.runs(id) on delete cascade,
 marker text not null default 'A1-SYNTHETIC' check(marker='A1-SYNTHETIC'),
 claim uuid not null,
 state text not null check(state in ('sent','unknown','done')),
 reason text
);
create table studkab_a1_fault.provider_receipts (
 request_id uuid primary key references studkab_a1_fault.attempts(request_id) on delete cascade,
 marker text not null default 'A1-SYNTHETIC' check(marker='A1-SYNTHETIC'),
 accepted_at timestamptz not null default clock_timestamp()
);
create table studkab_a1_fault.events (
 sequence bigint generated always as identity primary key,
 run_id uuid not null references studkab_a1_fault.runs(id) on delete cascade,
 marker text not null default 'A1-SYNTHETIC' check(marker='A1-SYNTHETIC'),
 event text not null, detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default clock_timestamp()
);

create function studkab_a1_fault.start_run(p_scenario text) returns uuid
language plpgsql set search_path='' as $$
declare v_run uuid;
begin
 insert into studkab_a1_fault.runs(scenario) values(p_scenario) returning id into v_run;
 insert into studkab_a1_fault.parts(run_id) values(v_run);
 insert into studkab_a1_fault.events(run_id,event) values(v_run,'started');
 return v_run;
end $$;

create function studkab_a1_fault.claim(p_run uuid) returns uuid
language plpgsql set search_path='' as $$
declare p studkab_a1_fault.parts; v_claim uuid;
begin
 select * into p from studkab_a1_fault.parts where run_id=p_run for update;
 if not found then raise exception 'A1_RUN_NOT_FOUND'; end if;
 if p.state='sent' and p.lease_until<=clock_timestamp() then
  update studkab_a1_fault.attempts set state='unknown',reason='LEASE_EXPIRED_AFTER_DISPATCH'
   where request_id=p.request_id and state='sent';
  update studkab_a1_fault.parts set state='unknown' where run_id=p_run;
  update studkab_a1_fault.runs set status='unknown' where id=p_run;
  insert into studkab_a1_fault.events(run_id,event,detail)
   values(p_run,'sent-recovered-as-unknown',jsonb_build_object('request_id',p.request_id));
  return null;
 end if;
 if p.state='claimed' and p.lease_until<=clock_timestamp() then
  update studkab_a1_fault.parts set state='queued',claim=null,lease_until=null where run_id=p_run;
  insert into studkab_a1_fault.events(run_id,event) values(p_run,'expired-claim-requeued');
  p.state='queued';
 end if;
 if p.state!='queued' then return null; end if;
 v_claim=gen_random_uuid();
 update studkab_a1_fault.parts set state='claimed',claim=v_claim,
  lease_until=clock_timestamp()+interval '30 seconds' where run_id=p_run;
 update studkab_a1_fault.runs set status='running' where id=p_run;
 insert into studkab_a1_fault.events(run_id,event,detail)
  values(p_run,'claimed',jsonb_build_object('claim',v_claim));
 return v_claim;
end $$;

create function studkab_a1_fault.dispatch(p_run uuid,p_claim uuid) returns uuid
language plpgsql set search_path='' as $$
declare p studkab_a1_fault.parts; v_request uuid;
begin
 select * into p from studkab_a1_fault.parts where run_id=p_run for update;
 if not found or p.state!='claimed' or p.claim is distinct from p_claim
  or p.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM'; end if;
 v_request=gen_random_uuid();
 insert into studkab_a1_fault.attempts(request_id,run_id,claim,state)
  values(v_request,p_run,p_claim,'sent');
 update studkab_a1_fault.parts set state='sent',request_id=v_request,
  lease_until=clock_timestamp()+interval '30 seconds' where run_id=p_run;
 insert into studkab_a1_fault.events(run_id,event,detail)
  values(p_run,'dispatched',jsonb_build_object('request_id',v_request));
 return v_request;
end $$;

create function studkab_a1_fault.provider_accept(p_run uuid,p_request uuid) returns void
language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from studkab_a1_fault.attempts where run_id=p_run
  and request_id=p_request and marker='A1-SYNTHETIC' and state='sent')
  then raise exception 'INVALID_SYNTHETIC_REQUEST'; end if;
 insert into studkab_a1_fault.provider_receipts(request_id) values(p_request);
 insert into studkab_a1_fault.events(run_id,event,detail)
  values(p_run,'synthetic-provider-accepted',jsonb_build_object('request_id',p_request));
end $$;

create function studkab_a1_fault.expire_lease(p_run uuid) returns void
language plpgsql set search_path='' as $$
begin
 update studkab_a1_fault.parts set lease_until=clock_timestamp()-interval '1 second'
  where run_id=p_run and state in ('claimed','sent') and marker='A1-SYNTHETIC';
 if not found then raise exception 'NO_SYNTHETIC_LEASE'; end if;
 insert into studkab_a1_fault.events(run_id,event) values(p_run,'lease-expired-by-harness');
end $$;

revoke all on schema studkab_a1_fault from public;
revoke all on all tables in schema studkab_a1_fault from public;
revoke all on all functions in schema studkab_a1_fault from public;
