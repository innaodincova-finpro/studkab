-- ROUTE-03, этап R3-F (05.10.2026): исполнителю — уведомление о возврате работы на доработку.
-- Telegram владельцу (как ответы студента) и push на устройства исполнителя (как новые заявки).
-- Отправка повторяется при сбое; каждое уведомление уходит один раз.

alter table public.studkab_r3_returns
 add column telegram_sent_at timestamptz,
 add column telegram_attempts integer not null default 0 check(telegram_attempts between 0 and 1000),
 add column telegram_retry_at timestamptz not null default now(),
 add column telegram_lease_until timestamptz;
-- Возвраты, записанные до этой миграции, не рассылаются задним числом.
update public.studkab_r3_returns set telegram_sent_at=coalesce(telegram_sent_at,now());
grant update(telegram_sent_at,telegram_attempts,telegram_retry_at,telegram_lease_until) on public.studkab_r3_returns to service_role;

-- Telegram: забрать до 10 неотправленных возвратов на 2 минуты (как claim_studkab_dialog_telegram).
create function public.claim_studkab_r3_return_telegram()
returns table(request_id uuid,n integer,number bigint,telegram_attempts integer)
language sql security invoker set search_path='' as $$
 with picked as (
  select x.request_id,x.n from public.studkab_r3_returns x
  join public.studkab_requests r on r.id=x.request_id
  where x.telegram_sent_at is null and r.deleting_at is null and x.telegram_retry_at<=now()
   and (x.telegram_lease_until is null or x.telegram_lease_until<now())
  order by x.created_at limit 10 for update of x skip locked)
 update public.studkab_r3_returns e set telegram_lease_until=now()+interval '2 minutes',telegram_attempts=e.telegram_attempts+1
 from picked p,public.studkab_requests r
 where e.request_id=p.request_id and e.n=p.n and r.id=e.request_id
 returning e.request_id,e.n,r.number,e.telegram_attempts;
$$;

-- Push: возвраты за последние 3 дня — только если подписка принадлежит действующему исполнителю.
create function public.studkab_r3_return_push_targets(p_subscription uuid)
returns table(request_id uuid,n integer,number bigint)
language sql stable security definer set search_path='' as $$
 select x.request_id,x.n,r.number from public.studkab_r3_returns x
 join public.studkab_requests r on r.id=x.request_id and r.deleting_at is null
 where x.created_at>now()-interval '3 days'
  and exists(select 1 from public.studkab_push_subscriptions s
   join auth.users u on u.id=s.user_id
   join public.studkab_request_config c on c.id=true and lower(c.executor_email)=lower(u.email)
   where s.id=p_subscription and s.enabled=true)
 order by x.created_at limit 20;
$$;

revoke all on function public.claim_studkab_r3_return_telegram(),public.studkab_r3_return_push_targets(uuid) from public,anon,authenticated;
grant execute on function public.claim_studkab_r3_return_telegram(),public.studkab_r3_return_push_targets(uuid) to service_role;
