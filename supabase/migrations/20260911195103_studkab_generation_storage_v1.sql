
-- R2/R3/R4/R9. Additive schema; no existing application rows are changed.
create table public.studkab_gen_budget (
 id boolean primary key default true check(id),
 limit_microusd bigint not null default 0 check(limit_microusd>=0),
 reserved_microusd bigint not null default 0 check(reserved_microusd>=0 and reserved_microusd<=limit_microusd)
);
insert into public.studkab_gen_budget(id) values(true);
create table public.studkab_gen_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 request_id text not null check(length(request_id) between 1 and 100),
 version text not null,
 snapshot jsonb not null,
 status text not null default 'queued' check(status in ('queued','running','unknown','budget','complete')),
 created_at timestamptz not null default now(),
 unique(owner_id,request_id,version)
);
create table public.studkab_gen_parts (
 job_id uuid not null references public.studkab_gen_jobs(id),
 ordinal integer not null check(ordinal>=0),
 spec jsonb not null,
 state text not null default 'queued' check(state in ('queued','claimed','sent','unknown','done')),
 claim uuid,
 lease_until timestamptz,
 request_id uuid,
 result text,
 primary key(job_id,ordinal),
 check(state!='done' or length(trim(result))>0)
);
create table public.studkab_gen_attempts (
 request_id uuid primary key,
 job_id uuid not null,
 ordinal integer not null,
 claim uuid not null,
 state text not null check(state in ('sent','unknown','done')),
 reservation_microusd bigint not null check(reservation_microusd>0),
 reason text,
 detail jsonb not null default '{}',
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 foreign key(job_id,ordinal) references public.studkab_gen_parts(job_id,ordinal)
);
create index studkab_gen_ready on public.studkab_gen_jobs(created_at) where status in ('queued','running');
create index studkab_gen_owner on public.studkab_gen_jobs(owner_id);
create index studkab_gen_attempt_part on public.studkab_gen_attempts(job_id,ordinal);
alter table public.studkab_gen_budget enable row level security;
alter table public.studkab_gen_jobs enable row level security;
alter table public.studkab_gen_parts enable row level security;
alter table public.studkab_gen_attempts enable row level security;
revoke all on public.studkab_gen_budget,public.studkab_gen_jobs,public.studkab_gen_parts,public.studkab_gen_attempts from public,anon,authenticated;
grant select,insert,update on public.studkab_gen_budget,public.studkab_gen_jobs,public.studkab_gen_parts,public.studkab_gen_attempts to service_role;
-- Budget is operator-controlled: provider handlers cannot raise or reset it.
revoke insert,update on public.studkab_gen_budget from service_role;
grant update(reserved_microusd) on public.studkab_gen_budget to service_role;

create function public.studkab_gen_immutable() returns trigger language plpgsql
security invoker set search_path='' as $$
begin
 if tg_table_name='studkab_gen_jobs' then
  if (new.owner_id,new.request_id,new.version,new.snapshot) is distinct from (old.owner_id,old.request_id,old.version,old.snapshot) then raise exception 'IMMUTABLE_INPUT'; end if;
 elsif new.spec is distinct from old.spec or new.job_id is distinct from old.job_id or new.ordinal is distinct from old.ordinal then raise exception 'IMMUTABLE_PART';
 elsif old.state='done' and new is distinct from old then raise exception 'IMMUTABLE_RESULT';
 end if;
 return new;
end $$;
create trigger studkab_gen_jobs_immutable before update on public.studkab_gen_jobs for each row execute function public.studkab_gen_immutable();
create trigger studkab_gen_parts_immutable before update on public.studkab_gen_parts for each row execute function public.studkab_gen_immutable();

-- Called by an authenticated Edge adapter after verifying the executor identity.
-- Client roles have no EXECUTE privilege.
create function public.studkab_gen_start(p_owner uuid,p_request text,p_input jsonb,p_plan jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_snapshot jsonb; v_version text; v_id uuid; s jsonb;
begin
 if p_input is null or jsonb_typeof(p_input)!='object' or p_plan is null or jsonb_typeof(p_plan)!='array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_plan) not between 1 and 100 then raise exception 'INVALID_PLAN'; end if;
 for s in select value from jsonb_array_elements(p_plan) loop
  if jsonb_typeof(s)!='object' or coalesce(s->>'id','')='' or coalesce(s->>'prompt','')='' or coalesce(s->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,11}$' then raise exception 'INVALID_PART'; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_plan))!=jsonb_array_length(p_plan) then raise exception 'DUPLICATE_PART'; end if;
 v_snapshot=jsonb_build_object('input',p_input,'plan',p_plan);
 if octet_length(v_snapshot::text)>1000000 then raise exception 'INPUT_TOO_BIG'; end if;
 v_version=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 -- Transaction lock for duplicate Start, including simultaneous requests.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_request,0));
 select id into v_id from public.studkab_gen_jobs where owner_id=p_owner and request_id=p_request and version=v_version;
 if v_id is not null then return v_id; end if;
 insert into public.studkab_gen_jobs(owner_id,request_id,version,snapshot) values(p_owner,p_request,v_version,v_snapshot) returning id into v_id;
 insert into public.studkab_gen_parts(job_id,ordinal,spec)
 select v_id,(ordinality-1)::integer,value from jsonb_array_elements(p_plan) with ordinality;
 return v_id;
end $$;

create function public.studkab_gen_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studkab_gen_jobs; p public.studkab_gen_parts; v_claim uuid;
begin
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

create function public.studkab_gen_dispatch(p_job uuid,p_ordinal integer,p_claim uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts; b public.studkab_gen_budget; cost bigint; rid uuid;
begin
 perform 1 from public.studkab_gen_jobs where id=p_job for update;
 select * into p from public.studkab_gen_parts where job_id=p_job and ordinal=p_ordinal;
 if not found or p.state!='claimed' or p.claim is distinct from p_claim or p.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM'; end if;
 cost=(p.spec->>'max_cost_microusd')::bigint;
 select * into b from public.studkab_gen_budget where id=true for update;
 if not found or cost>b.limit_microusd-b.reserved_microusd then
  update public.studkab_gen_jobs set status='budget' where id=p_job;
  update public.studkab_gen_parts set state='queued',claim=null,lease_until=null where job_id=p_job and ordinal=p_ordinal;
  return null;
 end if;
 rid=gen_random_uuid();
 update public.studkab_gen_budget set reserved_microusd=reserved_microusd+cost where id=true;
 insert into public.studkab_gen_attempts(request_id,job_id,ordinal,claim,state,reservation_microusd)
 values(rid,p_job,p_ordinal,p_claim,'sent',cost);
 update public.studkab_gen_parts set state='sent',request_id=rid,lease_until=clock_timestamp()+interval '240 seconds' where job_id=p_job and ordinal=p_ordinal;
 return rid;
end $$;

create function public.studkab_gen_settle(p_job uuid,p_ordinal integer,p_claim uuid,p_request uuid,p_text text,p_detail jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts; v_state text; safe jsonb='{}'; k text;
begin
 perform 1 from public.studkab_gen_jobs where id=p_job for update;
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
 update public.studkab_gen_jobs set status=case when v_state='unknown' then 'unknown'
 when not exists(select 1 from public.studkab_gen_parts where job_id=p_job and state!='done') then 'complete' else 'running' end where id=p_job;
 return v_state;
end $$;
revoke all on function public.studkab_gen_immutable(),public.studkab_gen_start(uuid,text,jsonb,jsonb),public.studkab_gen_claim(),public.studkab_gen_dispatch(uuid,integer,uuid),public.studkab_gen_settle(uuid,integer,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_gen_start(uuid,text,jsonb,jsonb),public.studkab_gen_claim(),public.studkab_gen_dispatch(uuid,integer,uuid),public.studkab_gen_settle(uuid,integer,uuid,uuid,text,jsonb) to service_role;
