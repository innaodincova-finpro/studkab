create table public.user_app_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_app_data enable row level security;

grant select, insert, update, delete on table public.user_app_data to authenticated;
revoke all on table public.user_app_data from anon;

create policy "users_select_own_data"
on public.user_app_data for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users_insert_own_data"
on public.user_app_data for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users_update_own_data"
on public.user_app_data for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users_delete_own_data"
on public.user_app_data for delete
to authenticated
using ((select auth.uid()) = user_id);

comment on table public.user_app_data is 'Encrypted-in-transit application state for Tochka Dnya, isolated by auth.uid().';