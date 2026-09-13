-- Isolated notification storage. Existing user_app_data and its policies are unchanged.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table public.push_configuration (
 id integer primary key check(id=1),
 cron_token text not null default (gen_random_uuid()::text||gen_random_uuid()::text),
 vapid jsonb,
 last_run_at timestamptz,
 last_result jsonb
);
insert into public.push_configuration(id) values(1);
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 subscription jsonb not null,
 timezone text not null,
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 test_due timestamptz,
 test_sent_at timestamptz,
 last_sent_at timestamptz,
 last_error text
);
create index push_subscriptions_owner on public.push_subscriptions(user_id);
create table public.push_deliveries (
 key text primary key,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 claimed_at timestamptz not null default now(),
 attempts integer not null default 1,
 sent_at timestamptz,
 result text
);
alter table public.push_configuration enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on public.push_configuration,public.push_subscriptions,public.push_deliveries from public,anon,authenticated;
grant all on public.push_configuration,public.push_subscriptions,public.push_deliveries to service_role;
-- Service-only atomic lease prevents overlapping cron invocations sending the same event.
create function public.claim_push_delivery(delivery_key text,subscription_id uuid)
returns boolean language sql security invoker set search_path=pg_catalog as $$
 with claimed as (
 insert into public.push_deliveries as d(key,subscription_id) values(delivery_key,subscription_id)
 on conflict(key) do update set claimed_at=now(),attempts=d.attempts+1
 where d.sent_at is null and d.claimed_at < now()-interval '65 seconds' and d.attempts<3
 returning 1
 ) select exists(select 1 from claimed);
$$;
revoke all on function public.claim_push_delivery(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_push_delivery(text,uuid) to service_role;
-- Only invokes the worker when at least one device is enabled. Token is never embedded in source.
select cron.schedule('tochka-push-every-minute','* * * * *',$job$
 select net.http_post(
 url:='https://dcpthwmuiodrjepifzsd.supabase.co/functions/v1/push',
 headers:=jsonb_build_object('Content-Type','application/json','x-job-key',c.cron_token),
 body:='{}'::jsonb,timeout_milliseconds:=55000)
 from public.push_configuration c where c.id=1
 and exists(select 1 from public.push_subscriptions where enabled);
$job$);
select cron.schedule('tochka-push-cleanup','17 3 * * *',$job$
 delete from public.push_deliveries where claimed_at < now()-interval '14 days';
$job$);
