-- Isolated from the other applications in this shared project.
create table public.studkab_push_configuration (
 id integer primary key check(id=1), cron_token text not null default gen_random_uuid()::text,
 vapid jsonb, last_run_at timestamptz, last_result jsonb
);
insert into public.studkab_push_configuration(id) values(1);
create table public.studkab_push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique, subscription jsonb not null, timezone text not null,
 enabled boolean not null default true, created_at timestamptz not null default now(),
 test_due timestamptz,test_sent_at timestamptz,last_sent_at timestamptz,last_error text
);
create index on public.studkab_push_subscriptions(user_id);
create table public.studkab_push_deliveries (
 key text primary key, subscription_id uuid not null references public.studkab_push_subscriptions(id) on delete cascade,
 claimed_at timestamptz not null default now(), attempts integer not null default 1,
 sent_at timestamptz,result text
);
alter table public.studkab_push_configuration enable row level security;
alter table public.studkab_push_subscriptions enable row level security;
alter table public.studkab_push_deliveries enable row level security;
revoke all on public.studkab_push_configuration,public.studkab_push_subscriptions,public.studkab_push_deliveries from public,anon,authenticated;
grant all on public.studkab_push_configuration,public.studkab_push_subscriptions,public.studkab_push_deliveries to service_role;
-- Only the authenticated Edge Function's service role may claim deliveries.
create function public.claim_studkab_push_delivery(delivery_key text,subscription_id uuid)
returns boolean language sql security invoker set search_path='' as $$
 with claimed as (
 insert into public.studkab_push_deliveries(key,subscription_id) values(delivery_key,subscription_id)
 on conflict(key) do update set claimed_at=now(),attempts=public.studkab_push_deliveries.attempts+1
 where public.studkab_push_deliveries.sent_at is null
 and public.studkab_push_deliveries.claimed_at<now()-interval '2 minutes'
 and public.studkab_push_deliveries.attempts<4
 returning key) select exists(select 1 from claimed);
$$;
revoke all on function public.claim_studkab_push_delivery(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_studkab_push_delivery(text,uuid) to service_role;
-- Runs as the job owner. The secret never appears in the job text or browser.
-- Fresh Supabase projects do not expose the cron schema until pg_cron is enabled.
create extension if not exists pg_cron;
select cron.schedule('studkab-deadline-push','* * * * *',$job$
 select net.http_post(
 url:='https://dcpthwmuiodrjepifzsd.supabase.co/functions/v1/studkab-push',
 headers:=jsonb_build_object('Content-Type','application/json','x-job-key',(select cron_token from public.studkab_push_configuration where id=1)),
 body:='{}'::jsonb,timeout_milliseconds:=50000);
$job$);
