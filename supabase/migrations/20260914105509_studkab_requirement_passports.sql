create table public.studkab_requirement_passports (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 revision integer not null check (revision > 0),
 status text not null default 'draft' check (status in ('draft','approved','stale')),
 title text not null check (length(title) between 1 and 200),
 summary text not null default '' check (length(summary) <= 4000),
 items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 100),
 source_fingerprint text not null default '' check (length(source_fingerprint) <= 128),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 unique(request_id, revision)
);

alter table public.studkab_requirement_passports enable row level security;
revoke all on public.studkab_requirement_passports from public, anon, authenticated;
grant select,insert,update on public.studkab_requirement_passports to service_role;

create function public.studkab_requirement_passport_save(
 p_request uuid,p_actor uuid,p_title text,p_summary text,p_items jsonb,p_source_fingerprint text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare next_revision integer; created public.studkab_requirement_passports;
begin
 perform 1 from public.studkab_requests where id=p_request for update;
 if not found then raise exception 'request_not_found'; end if;
 select coalesce(max(revision),0)+1 into next_revision from public.studkab_requirement_passports where request_id=p_request;
 insert into public.studkab_requirement_passports(request_id,revision,title,summary,items,source_fingerprint,created_by)
 values(p_request,next_revision,p_title,p_summary,p_items,p_source_fingerprint,p_actor) returning * into created;
 return to_jsonb(created);
end $$;

create function public.studkab_requirement_passport_approve(
 p_request uuid,p_passport uuid,p_actor uuid,p_expected_items jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare selected public.studkab_requirement_passports;
begin
 perform 1 from public.studkab_requests where id=p_request for update;
 if not found then raise exception 'request_not_found'; end if;
 select * into selected from public.studkab_requirement_passports where id=p_passport and request_id=p_request for update;
 if not found then raise exception 'passport_not_found'; end if;
 if selected.status <> 'draft' or selected.items <> p_expected_items then raise exception 'passport_changed'; end if;
 update public.studkab_requirement_passports set status='stale' where request_id=p_request and status='approved';
 update public.studkab_requirement_passports set status='approved',approved_by=p_actor,approved_at=now() where id=p_passport returning * into selected;
 return to_jsonb(selected);
end $$;

revoke all on function public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text) to service_role;
grant execute on function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb) to service_role;
