-- C-054: фактическая production-таблица studkab_members сохранила расширенные
-- default privileges service_role. Ограничиваем их согласованными SELECT/INSERT.
-- Владелец postgres, RLS, policies, строки и структура таблицы не изменяются.
revoke all privileges on table public.studkab_members from service_role;
grant select, insert on table public.studkab_members to service_role;
