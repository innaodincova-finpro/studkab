-- C-054, замечание 3 аудита 15.09.2026 (R9, M1): записи кабинета и реестра
-- сохраняются только через save_app_data_v2 (проверка версии, удаление паролей),
-- размер записи ограничен. Записи других приложений в app_data не затрагиваются.
-- Существующие строки не изменяются.
do $size$
begin
 if exists(select 1 from public.app_data where app in ('kabinet','reestr') and octet_length(data::text) > 10485760) then
  raise exception 'В базе есть запись кабинета или реестра больше 10 МБ. Установка остановлена';
 end if;
end
$size$;

create or replace function public.studkab_app_data_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare target text := case when tg_op='DELETE' then old.app else new.app end;
begin
 if target is null or target not in ('kabinet','reestr') then
  return case when tg_op='DELETE' then old else new end;
 end if;
 -- Сервер (service_role и администратор) не ограничивается.
 if current_user not in ('authenticated','anon') then
  return case when tg_op='DELETE' then old else new end;
 end if;
 if coalesce(current_setting('studkab.cloud_write', true), '') <> 'v2' then
  raise exception 'Сохранение доступно только через приложение' using errcode = '42501';
 end if;
 if tg_op='DELETE' then
  raise exception 'Удаление записи кабинета недоступно' using errcode = '42501';
 end if;
 if tg_op='UPDATE' and new.app is distinct from old.app then
  raise exception 'Нельзя менять приложение записи' using errcode = '42501';
 end if;
 if octet_length(new.data::text) > 10485760 then
  raise exception 'Запись больше 10 МБ. Уменьшите объём материалов' using errcode = '54000';
 end if;
 new.data := new.data #- '{settings,proxyToken}' #- '{settings,dsKey}' #- '{settings,proxyUrl}';
 return new;
end $$;
revoke all on function public.studkab_app_data_guard() from public, anon, authenticated;

drop trigger if exists studkab_app_data_guard on public.app_data;
create trigger studkab_app_data_guard
 before insert or update or delete on public.app_data
 for each row execute function public.studkab_app_data_guard();

create or replace function public.save_app_data_v2(p_app text, p_data jsonb, p_rev bigint)
returns table (ok boolean, rev bigint, updated_at timestamptz, conflict boolean)
language plpgsql security invoker set search_path = '' as $$
declare saved public.app_data%rowtype;
begin
  if p_app is null or p_app not in ('kabinet','reestr') then raise exception 'Unsupported app'; end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_rev is null or p_rev < 0 then raise exception 'Invalid revision'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid data'; end if;
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
