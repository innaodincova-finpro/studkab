-- C-045: fail closed unless a generation job is bound to an approved passport
-- and to explicit server-owned monetary ceilings.
alter table public.studkab_gen_jobs
 add column passport_id uuid references public.studkab_requirement_passports(id),
 add column work_kind text check (work_kind in ('control','coursework','thesis')),
 add column max_cost_microusd bigint check (max_cost_microusd > 0);

create or replace function public.studkab_gen_immutable() returns trigger language plpgsql
security invoker set search_path='' as $$
begin
 if tg_table_name='studkab_gen_jobs' then
  if (new.owner_id,new.request_id,new.version,new.snapshot,new.passport_id,new.work_kind,new.max_cost_microusd)
     is distinct from
     (old.owner_id,old.request_id,old.version,old.snapshot,old.passport_id,old.work_kind,old.max_cost_microusd)
  then raise exception 'IMMUTABLE_INPUT'; end if;
 elsif new.spec is distinct from old.spec or new.job_id is distinct from old.job_id or new.ordinal is distinct from old.ordinal then
  raise exception 'IMMUTABLE_PART';
 elsif old.state='done' and new is distinct from old then raise exception 'IMMUTABLE_RESULT';
 end if;
 return new;
end $$;

create table public.studkab_gen_limits (
 work_kind text primary key check (work_kind in ('control','coursework','thesis')),
 max_cost_microusd bigint not null check (max_cost_microusd > 0)
);
insert into public.studkab_gen_limits(work_kind,max_cost_microusd) values
 ('control',100000),('coursework',250000),('thesis',600000);

create table public.studkab_gen_policy (
 id boolean primary key default true check(id),
 temporary_total_microusd bigint not null check (temporary_total_microusd >= 0)
);
insert into public.studkab_gen_policy(id,temporary_total_microusd) values(true,500000);

alter table public.studkab_gen_limits enable row level security;
alter table public.studkab_gen_policy enable row level security;
revoke all on public.studkab_gen_limits,public.studkab_gen_policy from public,anon,authenticated;
grant select on public.studkab_gen_limits,public.studkab_gen_policy to service_role;

-- An approval without a material fingerprint cannot prove currency.
update public.studkab_requirement_passports
 set status='stale'
 where status='approved' and source_fingerprint='';

drop function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb);
create function public.studkab_requirement_passport_approve(
 p_request uuid,p_passport uuid,p_actor uuid,p_expected_items jsonb,p_expected_fingerprint text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare selected public.studkab_requirement_passports;
begin
 perform 1 from public.studkab_requests where id=p_request for update;
 if not found then raise exception 'request_not_found'; end if;
 select * into selected from public.studkab_requirement_passports
  where id=p_passport and request_id=p_request for update;
 if not found then raise exception 'passport_not_found'; end if;
 if selected.status <> 'draft' or selected.items <> p_expected_items
    or selected.source_fingerprint='' or selected.source_fingerprint<>p_expected_fingerprint
 then raise exception 'passport_changed'; end if;
 update public.studkab_requirement_passports set status='stale'
  where request_id=p_request and status='approved';
 update public.studkab_requirement_passports
  set status='approved',approved_by=p_actor,approved_at=now()
  where id=p_passport returning * into selected;
 return to_jsonb(selected);
end $$;
revoke all on function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text) to service_role;

drop function public.studkab_gen_start(uuid,text,jsonb,jsonb);
create function public.studkab_gen_start(
 p_owner uuid,p_request text,p_input jsonb,p_plan jsonb,p_passport uuid,
 p_work_kind text,p_max_cost_microusd bigint
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_snapshot jsonb; v_version text; v_id uuid; s jsonb; approved uuid; allowed bigint;
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
 v_version=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_request,0));
 select id into v_id from public.studkab_gen_jobs where owner_id=p_owner and request_id=p_request and version=v_version;
 if v_id is not null then return v_id; end if;
 insert into public.studkab_gen_jobs(owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd)
 values(p_owner,p_request,v_version,v_snapshot,p_passport,p_work_kind,p_max_cost_microusd) returning id into v_id;
 insert into public.studkab_gen_parts(job_id,ordinal,spec)
 select v_id,(ordinality-1)::integer,value from jsonb_array_elements(p_plan) with ordinality;
 return v_id;
end $$;
revoke all on function public.studkab_gen_start(uuid,text,jsonb,jsonb,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.studkab_gen_start(uuid,text,jsonb,jsonb,uuid,text,bigint) to service_role;

create or replace function public.studkab_gen_dispatch(p_job uuid,p_ordinal integer,p_claim uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts; j public.studkab_gen_jobs; b public.studkab_gen_budget;
 policy public.studkab_gen_policy; cost bigint; used bigint; input_bytes bigint; output_tokens bigint; rid uuid;
begin
 select * into j from public.studkab_gen_jobs where id=p_job for update;
 select * into p from public.studkab_gen_parts where job_id=p_job and ordinal=p_ordinal;
 if not found or p.state!='claimed' or p.claim is distinct from p_claim or p.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM'; end if;
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
revoke all on function public.studkab_gen_dispatch(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.studkab_gen_dispatch(uuid,integer,uuid) to service_role;
