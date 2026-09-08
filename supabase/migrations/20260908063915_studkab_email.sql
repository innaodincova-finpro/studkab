-- Isolated email preferences; no changes to shared Auth or existing push jobs.
create table public.studkab_email_configuration (
 id int primary key check(id=1),cron_token text not null default gen_random_uuid()::text,
 cursor uuid,next_send_at timestamptz not null default now(),budget_day date not null default current_date,
 attempts_today int not null default 0,daily_limit int not null default 100 check(daily_limit between 1 and 1000),
 last_run_at timestamptz,last_result jsonb
);
insert into public.studkab_email_configuration(id) values(1);
create table public.studkab_email_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,email text not null,
 enabled boolean not null default false,timezone text not null,consented_at timestamptz not null,
 test_due timestamptz,test_requested_at timestamptz,last_accepted_at timestamptz,last_error text
);
create table public.studkab_email_deliveries (
 key text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 state text not null default 'sending' check(state in ('sending','accepted','retry','unknown','rejected','cancelled')),
 attempts int not null default 1,claimed_at timestamptz not null default now(),message_id text
);
create index on public.studkab_email_deliveries(user_id);
alter table public.studkab_email_configuration enable row level security;
alter table public.studkab_email_preferences enable row level security;
alter table public.studkab_email_deliveries enable row level security;
revoke all on public.studkab_email_configuration,public.studkab_email_preferences,public.studkab_email_deliveries from public,anon,authenticated;
grant all on public.studkab_email_configuration,public.studkab_email_preferences,public.studkab_email_deliveries to service_role;
create function public.claim_studkab_email(delivery_key text,owner uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare cfg public.studkab_email_configuration; claimed text;
begin
 select * into cfg from public.studkab_email_configuration where id=1 for update;
 if cfg.next_send_at>now() then return false; end if;
 if cfg.budget_day<>(now() at time zone 'UTC')::date then
  update public.studkab_email_configuration set budget_day=(now() at time zone 'UTC')::date,attempts_today=0 where id=1;
  cfg.attempts_today:=0;
 end if;
 if cfg.attempts_today>=cfg.daily_limit then return false; end if;
 if not exists(select 1 from public.studkab_email_preferences where user_id=owner and enabled) then return false; end if;
 insert into public.studkab_email_deliveries(key,user_id) values(delivery_key,owner)
 on conflict(key) do update set state='sending',attempts=public.studkab_email_deliveries.attempts+1,claimed_at=now()
 where public.studkab_email_deliveries.state='retry' and public.studkab_email_deliveries.user_id=owner
 and public.studkab_email_deliveries.claimed_at<now()-interval '2 minutes' and public.studkab_email_deliveries.attempts<4
 returning key into claimed;
 if claimed is null then return false; end if;
 update public.studkab_email_configuration set attempts_today=attempts_today+1,next_send_at=now()+interval '1100 milliseconds' where id=1;
 return true;
end;$$;
create function public.schedule_studkab_email_test(owner uuid) returns boolean
language sql security invoker set search_path='' as $$
 with changed as (
 update public.studkab_email_preferences set test_due=now()+interval '1 minute',test_requested_at=now()
 where user_id=owner and enabled and (test_requested_at is null or test_requested_at<now()-interval '10 minutes') returning user_id
 ) select exists(select 1 from changed);
$$;
revoke all on function public.claim_studkab_email(text,uuid),public.schedule_studkab_email_test(uuid) from public,anon,authenticated;
grant execute on function public.claim_studkab_email(text,uuid),public.schedule_studkab_email_test(uuid) to service_role;
-- Intentionally no cron activation. Enable only after sender and end-to-end acceptance.
