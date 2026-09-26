-- C120: record dialogue events in the same transaction as the question/answer.
create table public.studkab_dialog_events (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 question_id uuid not null references public.studkab_clarifications(id) on delete cascade,
 kind text not null check(kind in ('question','answer')),
 recipient_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 read_at timestamptz,
 telegram_sent_at timestamptz,
 telegram_attempts integer not null default 0,
 telegram_retry_at timestamptz not null default now(),
 telegram_lease_until timestamptz,
 unique(question_id,kind)
);
create index studkab_dialog_events_recipient on public.studkab_dialog_events(recipient_id,read_at,id);
create index studkab_dialog_events_telegram on public.studkab_dialog_events(telegram_retry_at,id)
 where kind='answer' and telegram_sent_at is null;
alter table public.studkab_dialog_events enable row level security;
revoke all on public.studkab_dialog_events from public,anon,authenticated;
grant select,insert,update,delete on public.studkab_dialog_events to service_role;
grant usage,select on sequence public.studkab_dialog_events_id_seq to service_role;

create function public.studkab_dialog_event_insert() returns trigger language plpgsql security invoker set search_path='' as $$
declare recipient uuid;
begin
 if tg_op='INSERT' then
  select r.student_id into recipient from public.studkab_requests r where r.id=new.request_id;
  if recipient is not null then
   insert into public.studkab_dialog_events(request_id,question_id,kind,recipient_id)
   values(new.request_id,new.id,'question',recipient);
  end if;
 elsif old.answered_at is null and new.answered_at is not null then
  insert into public.studkab_dialog_events(request_id,question_id,kind,recipient_id)
  values(new.request_id,new.id,'answer',new.asked_by);
 end if;
 return new;
end $$;
create trigger studkab_dialog_event_after_insert after insert on public.studkab_clarifications
 for each row execute function public.studkab_dialog_event_insert();
create trigger studkab_dialog_event_after_answer after update of answered_at on public.studkab_clarifications
 for each row execute function public.studkab_dialog_event_insert();
revoke all on function public.studkab_dialog_event_insert() from public,anon,authenticated;

create function public.claim_studkab_dialog_telegram() returns setof public.studkab_dialog_events
 language sql security invoker set search_path='' as $$
 update public.studkab_dialog_events e set telegram_lease_until=now()+interval '2 minutes',
  telegram_attempts=e.telegram_attempts+1
 where e.id in (select d.id from public.studkab_dialog_events d
  join public.studkab_requests r on r.id=d.request_id
  where d.kind='answer' and d.telegram_sent_at is null and d.read_at is null
  and r.deleting_at is null and d.telegram_retry_at<=now()
  and (d.telegram_lease_until is null or d.telegram_lease_until<now())
  and d.telegram_attempts<8 order by d.id limit 10 for update of d skip locked)
 returning e.*;
$$;
revoke all on function public.claim_studkab_dialog_telegram() from public,anon,authenticated;
grant execute on function public.claim_studkab_dialog_telegram() to service_role;
