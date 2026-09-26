-- C124: keep retrying unread dialogue events after a prolonged outage.
-- Deadline reminders retain their existing four-attempt limit.
create or replace function public.claim_studkab_push_delivery(delivery_key text,subscription_id uuid)
returns boolean language sql security invoker set search_path='' as $$
 with claimed as (
  insert into public.studkab_push_deliveries(key,subscription_id) values(delivery_key,subscription_id)
  on conflict(key) do update set claimed_at=now(),attempts=public.studkab_push_deliveries.attempts+1
  where public.studkab_push_deliveries.sent_at is null
   and case when $1 like $2::text||':dialog:%' then
    public.studkab_push_deliveries.claimed_at < now()
     - make_interval(mins=>least(60,1 << least(public.studkab_push_deliveries.attempts,6)))
   else public.studkab_push_deliveries.claimed_at < now()-interval '2 minutes'
    and public.studkab_push_deliveries.attempts<4 end
  returning key)
 select exists(select 1 from claimed);
$$;

create or replace function public.claim_studkab_dialog_telegram() returns setof public.studkab_dialog_events
 language sql security invoker set search_path='' as $$
 update public.studkab_dialog_events e set telegram_lease_until=now()+interval '2 minutes',
  telegram_attempts=e.telegram_attempts+1
 where e.id in (select d.id from public.studkab_dialog_events d
  join public.studkab_requests r on r.id=d.request_id
  where d.kind='answer' and d.telegram_sent_at is null and d.read_at is null
  and r.deleting_at is null and d.telegram_retry_at<=now()
  and (d.telegram_lease_until is null or d.telegram_lease_until<now())
  order by d.id limit 10 for update of d skip locked)
 returning e.*;
$$;
