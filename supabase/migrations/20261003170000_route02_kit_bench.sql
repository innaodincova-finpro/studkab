-- ROUTE-02-C, BENCH-01. Учебный стенд проверки комплекта (разрешение владельца 03.10.2026:
-- стенд, лимит до $1 сверх лимита пункта C, мерило «не меньше 9 дефектов из 10»).
-- Стенд не связан с заявками, студентами и общим журналом резервов генерации:
-- у него собственный лимит и собственный журнал прогонов. По умолчанию выключен.
create table public.studkab_kit_bench_policy(
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 limit_microusd bigint not null default 1000000 check(limit_microusd between 0 and 1000000)
);
insert into public.studkab_kit_bench_policy(id,enabled,limit_microusd) values(true,false,1000000);
create table public.studkab_kit_bench_runs(
 id uuid primary key default gen_random_uuid(),
 kit text not null check(kit ~ '^[A-Z][0-9]{1,2}$'),
 method text not null check(method ~ '^[a-z0-9-]{1,40}$'),
 commit_sha text not null check(commit_sha ~ '^[0-9a-f]{40}$'),
 reserved_microusd bigint not null check(reserved_microusd>0 and reserved_microusd<=100000),
 state text not null default 'sent' check(state in ('sent','done','invalid','failed')),
 raw text check(raw is null or octet_length(raw)<=100000),
 result jsonb check(result is null or octet_length(result::text)<=300000),
 error text check(error is null or length(error)<=100),
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
alter table public.studkab_kit_bench_policy enable row level security;
alter table public.studkab_kit_bench_runs enable row level security;
revoke all on public.studkab_kit_bench_policy,public.studkab_kit_bench_runs from public,anon,authenticated,service_role;

-- Резерв до обращения к модели: стенд включён и сумма всех резервов стенда не превышает лимит.
-- Незавершённые прогоны остаются в сумме: лимит считается по худшему случаю.
create function public.studkab_kit_bench_reserve(p_kit text,p_method text,p_commit text,p_cost bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.studkab_kit_bench_policy; total bigint; rid uuid;
begin
 select * into p from public.studkab_kit_bench_policy where id for update;
 if not found or not p.enabled then return null; end if;
 if p_cost is null or p_cost<=0 or p_cost>100000 then raise exception 'INVALID_RESERVE'; end if;
 select coalesce(sum(reserved_microusd),0) into total from public.studkab_kit_bench_runs;
 if total+p_cost>p.limit_microusd then return null; end if;
 insert into public.studkab_kit_bench_runs(kit,method,commit_sha,reserved_microusd) values(p_kit,p_method,p_commit,p_cost) returning id into rid;
 return rid;
end $$;

create function public.studkab_kit_bench_finish(p_run uuid,p_raw text,p_result jsonb,p_error text) returns text
language plpgsql security definer set search_path='' as $$
declare s text;
begin
 s=case when p_error is null then 'done' when p_error like 'invalid%' then 'invalid' else 'failed' end;
 update public.studkab_kit_bench_runs set state=s,raw=p_raw,result=p_result,error=p_error,finished_at=now()
  where id=p_run and state='sent';
 if not found then raise exception 'STALE_RUN'; end if;
 return s;
end $$;
revoke all on function public.studkab_kit_bench_reserve(text,text,text,bigint),public.studkab_kit_bench_finish(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studkab_kit_bench_reserve(text,text,text,bigint),public.studkab_kit_bench_finish(uuid,text,jsonb,text) to service_role;
