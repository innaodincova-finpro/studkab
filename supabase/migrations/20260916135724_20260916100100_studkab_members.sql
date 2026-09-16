-- C-054, замечания 4 и 5 аудита 15.09.2026 (R9, M1): список допущенных студентов.
-- Заявки, облако кабинета и реестра, уведомления и восстановление доступа — только
-- для аккаунтов из списка. Список заполняется приглашением исполнителя.
-- Все, у кого уже есть заявки, облачные записи или подписки STUDKAB, и исполнитель
-- вносятся в список при установке, поэтому действующие пользователи доступ не теряют.
create table public.studkab_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 source text not null check (source in ('backfill','invite','executor')),
 added_at timestamptz not null default now()
);
alter table public.studkab_members enable row level security;
revoke all on table public.studkab_members from public, anon, authenticated;
grant select, insert on table public.studkab_members to service_role;

insert into public.studkab_members(user_id, source)
select u.id, 'executor' from auth.users u
join public.studkab_request_config c on c.id and lower(u.email) = lower(c.executor_email)
on conflict (user_id) do nothing;
insert into public.studkab_members(user_id, source)
select distinct x.user_id, 'backfill' from (
 select student_id as user_id from public.studkab_requests
 union select user_id from public.app_data where app in ('kabinet','reestr')
 union select user_id from public.studkab_push_subscriptions
) x join auth.users u on u.id = x.user_id
on conflict (user_id) do nothing;

create function public.studkab_current_member()
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.studkab_members m where m.user_id = auth.uid())
$$;
revoke all on function public.studkab_current_member() from public, anon;
grant execute on function public.studkab_current_member() to authenticated;

create function public.studkab_member_add(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if p_user is null or not exists(select 1 from auth.users where id = p_user) then
  raise exception 'Unknown account';
 end if;
 insert into public.studkab_members(user_id, source) values (p_user, 'invite')
 on conflict (user_id) do nothing;
end $$;
revoke all on function public.studkab_member_add(uuid) from public, anon, authenticated;
grant execute on function public.studkab_member_add(uuid) to service_role;

create or replace function public.save_app_data_v2(p_app text, p_data jsonb, p_rev bigint)
returns table (ok boolean, rev bigint, updated_at timestamptz, conflict boolean)
language plpgsql security invoker set search_path = '' as $$
declare saved public.app_data%rowtype;
begin
  if p_app is null or p_app not in ('kabinet','reestr') then raise exception 'Unsupported app'; end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_rev is null or p_rev < 0 then raise exception 'Invalid revision'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid data'; end if;
  if not public.studkab_current_member() then
    raise exception 'Облако кабинета открывается после приглашения исполнителя' using errcode = '42501';
  end if;
  if octet_length(p_data::text) > 10485760 then
    raise exception 'Запись больше 10 МБ. Уменьшите объём материалов' using errcode = '54000';
  end if;
  p_data := p_data #- '{settings,proxyToken}' #- '{settings,dsKey}' #- '{settings,proxyUrl}';
  perform set_config('studkab.cloud_write', 'v2', true);
  if p_rev = 0 then
    insert into public.app_data as d(user_id, app, data)
      values (auth.uid(), p_app, p_data)
      on conflict (user_id, app) do nothing returning d.* into saved;
  else
    update public.app_data as d
      set data = p_data, rev = d.rev + 1, updated_at = clock_timestamp()
      where d.user_id = auth.uid() and d.app = p_app and d.rev = p_rev
      returning d.* into saved;
  end if;
  perform set_config('studkab.cloud_write', '', true);
  if saved.user_id is not null then
    return query select true, saved.rev, saved.updated_at, false;
  else
    return query select false, coalesce(d.rev, 0::bigint), d.updated_at, true
      from (select 1) seed left join public.app_data d
      on d.user_id = auth.uid() and d.app = p_app;
  end if;
end;
$$;
revoke all on function public.save_app_data_v2(text,jsonb,bigint) from public, anon;
grant execute on function public.save_app_data_v2(text,jsonb,bigint) to authenticated;
