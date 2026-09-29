-- C175: snapshot only the executor's already enabled devices on first publication.
-- Historical requests are not backfilled.
begin;
-- Keep historical email records for audit, but stop creating new unsendable jobs.
drop trigger if exists studkab_request_email_publish on public.studkab_requests;
create table public.studkab_request_push_events (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 subscription_id uuid not null references public.studkab_push_subscriptions(id) on delete cascade,
 created_at timestamptz not null default now(),
 accepted_at timestamptz,
 cancelled_at timestamptz,
 unique(request_id,subscription_id)
);
create index studkab_request_push_open on public.studkab_request_push_events(id)
 where accepted_at is null and cancelled_at is null;
alter table public.studkab_request_push_events enable row level security;
revoke all on public.studkab_request_push_events from public,anon,authenticated;
grant select,update on public.studkab_request_push_events to service_role;

create function public.studkab_queue_request_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.ready_at is null and new.ready_at is not null and new.deleting_at is null then
  insert into public.studkab_request_push_events(request_id,subscription_id)
  select new.id,s.id from public.studkab_push_subscriptions s
  join auth.users u on u.id=s.user_id
  join public.studkab_request_config c on c.id=true and lower(c.executor_email)=lower(u.email)
  where s.enabled=true
  on conflict(request_id,subscription_id) do nothing;
 end if;
 return new;
end $$;
create trigger studkab_request_push_publish after update of ready_at on public.studkab_requests
 for each row execute function public.studkab_queue_request_push();
revoke all on function public.studkab_queue_request_push() from public,anon,authenticated;

-- Re-check access just before sending; a former executor must not receive a delayed push.
create function public.studkab_request_push_target(p_event_id bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.studkab_request_push_events e
  join public.studkab_push_subscriptions s on s.id=e.subscription_id and s.enabled=true
  join auth.users u on u.id=s.user_id
  join public.studkab_request_config c on c.id=true and lower(c.executor_email)=lower(u.email)
  join public.studkab_requests r on r.id=e.request_id and r.ready_at is not null and r.deleting_at is null
  where e.id=p_event_id and e.accepted_at is null and e.cancelled_at is null
 )
$$;
revoke all on function public.studkab_request_push_target(bigint) from public,anon,authenticated;
grant execute on function public.studkab_request_push_target(bigint) to service_role;
commit;
