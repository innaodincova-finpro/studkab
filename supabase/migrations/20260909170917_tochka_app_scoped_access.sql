-- App-scoped access. No auth.users or other-app data is deleted.
create table public.tochka_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 invited_at timestamptz,
 last_seen_at timestamptz,
 revoked_at timestamptz
);
alter table public.tochka_members enable row level security;
revoke all on public.tochka_members from public, anon, authenticated;
grant select on public.tochka_members to authenticated;
grant all on public.tochka_members to service_role;
create policy own_membership on public.tochka_members for select to authenticated using (user_id=(select auth.uid()));
-- A saved Tochka row is app-specific evidence; global Auth sign-ins are not.
insert into public.tochka_members(user_id,invited_at,last_seen_at)
select u.id,u.invited_at,d.updated_at from auth.users u join public.user_app_data d on d.user_id=u.id;
insert into public.tochka_members(user_id)
select id from auth.users where lower(email)='inna_odincova@mail.ru'
on conflict do nothing;

create function public.tochka_visit() returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.tochka_members set last_seen_at=clock_timestamp() where user_id=auth.uid() and revoked_at is null;
 if not found then raise exception 'Доступ к облаку «Точки дня» закрыт. Обратитесь к Инне.' using errcode='42501'; end if;
 return true;
end $$;
revoke all on function public.tochka_visit() from public,anon;
grant execute on function public.tochka_visit() to authenticated;

create function public.tochka_manage_access(p_user_id uuid,p_email text,p_action text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and lower(email)='inna_odincova@mail.ru' and email_confirmed_at is not null) then
 raise exception 'Доступ только у владельца' using errcode='42501'; end if;
 if p_user_id=auth.uid() then raise exception 'Нельзя изменить доступ владельца' using errcode='P0001'; end if;
 if p_action not in ('grant','remove') or p_action is null then raise exception 'Неизвестное действие' using errcode='P0001'; end if;
 perform 1 from auth.users where id=p_user_id and lower(email)=lower(trim(p_email)) for update;
 if not found then raise exception 'Пользователь изменился. Обновите список.' using errcode='P0001'; end if;
 if p_action='grant' then
 insert into public.tochka_members(user_id,invited_at) values(p_user_id,clock_timestamp())
 on conflict(user_id) do update set invited_at=excluded.invited_at,revoked_at=null;
 else
 perform 1 from public.tochka_members where user_id=p_user_id and revoked_at is null for update;
 if not found then raise exception 'Запись уже удалена. Обновите список.' using errcode='P0001'; end if;
 update public.tochka_members set revoked_at=clock_timestamp(),last_seen_at=null where user_id=p_user_id;
 delete from public.push_subscriptions where user_id=p_user_id;
 delete from public.user_app_data where user_id=p_user_id;
 end if;
 return true;
end $$;
revoke all on function public.tochka_manage_access(uuid,text,text) from public,anon;
grant execute on function public.tochka_manage_access(uuid,text,text) to authenticated;

-- Restrictive policy also guards clients with previously issued JWTs.
create policy tochka_access on public.user_app_data as restrictive for all to authenticated
using (exists(select 1 from public.tochka_members m where m.user_id=auth.uid() and m.revoked_at is null))
with check (exists(select 1 from public.tochka_members m where m.user_id=auth.uid() and m.revoked_at is null));
-- Serialize writes and removal; prevents old tabs or push requests recreating rows.
create function public.tochka_write_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tochka_members where user_id=new.user_id and revoked_at is null for share;
 if not found then raise exception 'Доступ к облаку «Точки дня» закрыт. Обратитесь к Инне.' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.tochka_write_access() from public,anon,authenticated;
create trigger tochka_access_guard before insert or update on public.user_app_data for each row execute function public.tochka_write_access();
create trigger tochka_access_guard before insert or update on public.push_subscriptions for each row execute function public.tochka_write_access();
-- Old cached Registry clients must not delete a shared Auth account.
create or replace function public.delete_pending_invitation(p_user_id uuid,p_email text) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Обновите Реестр для удаления доступа только к «Точке дня».' using errcode='P0001';
end $$;
