-- Выполнить после DATABASE_SETUP.sql и перед допуском 5.6.1 к рабочим данным.
-- Не меняет payload, не удаляет строки. Запрещает запись старым клиентам.
-- Старые вкладки сохранят локальные записи, но получат ошибку облака до обновления.
begin;
create or replace function public.tochka_sync_guard()
returns trigger language plpgsql security invoker
set search_path = pg_catalog
as $$
begin
  if current_user = 'authenticated' and
     coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-client-info', '') <> 'tochka-dnya/5.6.1' then
    raise exception 'Обновите Точку дня до версии 5.6.1 перед синхронизацией' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists tochka_sync_guard on public.user_app_data;
create trigger tochka_sync_guard before insert or update on public.user_app_data
for each row execute function public.tochka_sync_guard();
commit;
