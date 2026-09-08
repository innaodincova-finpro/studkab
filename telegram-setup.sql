-- Additive provisioning for the student cabinet bot. No access for application users.
begin;
create table if not exists public.studkab_telegram_setup (
  id boolean primary key default true check (id),
  setup_hash text not null check (setup_hash ~ '^[a-f0-9]{64}$'),
  owner_hash text not null check (owner_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  installed boolean not null default false,
  owner_chat_id bigint check (owner_chat_id > 0),
  bound_at timestamptz
);
alter table public.studkab_telegram_setup enable row level security;
revoke all on public.studkab_telegram_setup from public, anon, authenticated;
grant select, insert, update on public.studkab_telegram_setup to service_role;
commit;
