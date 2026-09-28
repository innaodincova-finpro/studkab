-- C172: one independently claimed email notification for each newly published request.
-- Existing requests are deliberately not backfilled: that could notify test/old cases.
begin;
create table public.studkab_request_email_notifications (
 request_id uuid primary key references public.studkab_requests(id) on delete cascade,
 status text not null default 'pending' check (status in ('pending','sending','accepted','failed','unknown')),
 attempts integer not null default 0 check (attempts between 0 and 8),
 retry_at timestamptz not null default now(),
 lease_id uuid,
 claimed_at timestamptz,
 accepted_at timestamptz,
 provider_message_id text,
 last_error text,
 created_at timestamptz not null default now(),
 check (status <> 'sending' or lease_id is not null)
);
create index studkab_request_email_pending on public.studkab_request_email_notifications(retry_at,request_id)
 where status='pending';
alter table public.studkab_request_email_notifications enable row level security;
revoke all on public.studkab_request_email_notifications from public,anon,authenticated;
grant select,insert,update,delete on public.studkab_request_email_notifications to service_role;

create function public.studkab_queue_request_email() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.ready_at is null and new.ready_at is not null and new.deleting_at is null then
  insert into public.studkab_request_email_notifications(request_id) values(new.id)
  on conflict (request_id) do nothing;
 end if;
 return new;
end $$;
create trigger studkab_request_email_publish after update of ready_at on public.studkab_requests
 for each row execute function public.studkab_queue_request_email();
revoke all on function public.studkab_queue_request_email() from public,anon,authenticated;

create function public.claim_studkab_request_emails()
returns table(request_id uuid,number bigint,lease_id uuid)
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 return query with claimed as (
  update public.studkab_request_email_notifications e
   set status='sending',attempts=e.attempts+1,lease_id=gen_random_uuid(),claimed_at=now()
   where e.request_id in (
    select q.request_id from public.studkab_request_email_notifications q
    join public.studkab_requests r on r.id=q.request_id
    where q.status='pending' and q.retry_at<=now() and q.attempts<8
     and r.ready_at is not null and r.deleting_at is null
    order by q.retry_at,q.request_id limit 5 for update of q skip locked
   ) returning e.request_id,e.lease_id
 ) select c.request_id,r.number,c.lease_id
   from claimed c join public.studkab_requests r on r.id=c.request_id;
end $$;
revoke all on function public.claim_studkab_request_emails() from public,anon,authenticated;
grant execute on function public.claim_studkab_request_emails() to service_role;

create function public.finish_studkab_request_email(p_request uuid,p_lease uuid,p_status text,p_message_id text default null)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if p_status not in ('accepted','pending','failed','unknown') then return false; end if;
 update public.studkab_request_email_notifications e set
  status=case when p_status='pending' and attempts>=8 then 'failed' else p_status end,
  accepted_at=case when p_status='accepted' then now() else null end,
  provider_message_id=case when p_status='accepted' then left(p_message_id,200) else null end,
  retry_at=case when p_status='pending' then now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6))::integer)) else retry_at end,
  last_error=case when p_status='accepted' then null else p_status end,
  lease_id=null
 where e.request_id=p_request and e.lease_id=p_lease and e.status='sending';
 return found;
end $$;
revoke all on function public.finish_studkab_request_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_studkab_request_email(uuid,uuid,text,text) to service_role;
commit;
