-- Review and back up app_data before applying. Does not alter stored rows.
-- v2 is deliberately separate: new clients fail closed until this is installed.
create or replace function public.save_app_data_v2(p_app text, p_data jsonb, p_rev bigint)
returns table (ok boolean, rev bigint, updated_at timestamptz, conflict boolean)
language plpgsql security invoker set search_path = '' as $$
declare saved public.app_data%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_rev is null or p_rev < 0 then raise exception 'Invalid revision'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid data'; end if;
  p_data := p_data #- '{settings,proxyToken}' #- '{settings,dsKey}';
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
-- Remove unconditional writes from old clients as well.
create or replace function public.save_app_data(p_app text, p_data jsonb, p_rev bigint)
returns table (ok boolean, rev bigint, updated_at timestamptz, conflict boolean)
language plpgsql security invoker set search_path = '' as $$
begin
  if p_app in ('kabinet', 'reestr') then
    raise exception 'Обновите приложение для безопасного сохранения';
  end if;
  return query select * from public.save_app_data_v2(p_app, p_data, p_rev);
end;
$$;
revoke all on function public.save_app_data(text,jsonb,bigint) from public, anon;
grant execute on function public.save_app_data(text,jsonb,bigint) to authenticated;
