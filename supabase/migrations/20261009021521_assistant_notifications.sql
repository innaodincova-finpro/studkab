-- NOTIFY-01..03. Future events only; no historical replay, sends or model calls.
create table public.studkab_telegram_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 chat_id bigint not null unique check(chat_id>0), linked_at timestamptz not null default clock_timestamp()
);
create table public.studkab_telegram_links (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null, consumed_at timestamptz
);
create table public.studkab_process_notifications (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.studkab_requests(id) on delete cascade,
 event_key text not null,kind text not null check(kind in ('file_prepared','problem','question','answer','delivered','handed','rework')),
 recipient_id uuid not null references auth.users(id) on delete cascade,
 channel text not null check(channel in ('push','telegram','email')),device_id uuid,
 target_key text not null,occurred_at timestamptz not null default clock_timestamp(),
 status text not null default 'pending' check(status in ('pending','claimed','accepted','unknown','failed','not_configured','cancelled')),
 lease_id uuid,lease_until timestamptz,attempts integer not null default 0,
 retry_at timestamptz not null default clock_timestamp(),accepted_at timestamptz,provider_receipt text,last_code text,
 unique(event_key,channel,target_key)
);
create index studkab_process_notify_ready on public.studkab_process_notifications(retry_at,id) where status in ('pending','not_configured');
alter table public.studkab_telegram_accounts enable row level security;
alter table public.studkab_telegram_links enable row level security;
alter table public.studkab_process_notifications enable row level security;
revoke all on public.studkab_telegram_accounts,public.studkab_telegram_links,public.studkab_process_notifications from public,anon,authenticated;
grant select,insert,update,delete on public.studkab_telegram_accounts,public.studkab_telegram_links to service_role;
grant select,insert,update,delete on public.studkab_process_notifications to service_role;
create function public.studkab_process_notify_enqueue(p_request uuid,p_recipient uuid,p_kind text,p_key text) returns void
language plpgsql security invoker set search_path='' as $$
declare owner uuid;student uuid;s record;
begin
 select r.student_id into student from public.studkab_requests r where r.id=p_request and r.deleting_at is null and r.ready_at is not null;
 if not found then return;end if;
 owner:=public.studkab_assistant_runner_actor();
 if p_kind not in ('file_prepared','problem','question','answer','delivered','handed','rework') then raise exception 'NOTIFICATION_EVENT';end if;
 -- A deleted/unconfigured/changed executor must not make file return fail.
 -- No outbox row may be created for an arbitrary or null recipient.
 if p_recipient is null then return;end if;
 if p_kind in ('question','delivered') then
  if p_recipient is distinct from student then return;end if;
 elsif owner is null or p_recipient is distinct from owner then return;end if;
 if p_key is null or length(btrim(p_key))=0 or length(p_key)>250 then raise exception 'NOTIFICATION_EVENT';end if;
 -- Existing push/question/result and owner Telegram/answer/return paths remain
 -- authoritative. Add only missing channels, avoiding duplicate notifications.
 if p_kind in ('file_prepared','problem','handed','answer') then
  for s in select id from public.studkab_push_subscriptions where user_id=p_recipient and enabled loop
   insert into public.studkab_process_notifications(request_id,event_key,kind,recipient_id,channel,device_id,target_key)
   values(p_request,p_key,p_kind,p_recipient,'push',s.id,s.id::text) on conflict do nothing;
  end loop;
 end if;
 if p_kind not in ('answer','rework') then
  insert into public.studkab_process_notifications(request_id,event_key,kind,recipient_id,channel,target_key)
  values(p_request,p_key,p_kind,p_recipient,'telegram',p_recipient::text) on conflict do nothing;
 end if;
 insert into public.studkab_process_notifications(request_id,event_key,kind,recipient_id,channel,target_key)
 values(p_request,p_key,p_kind,p_recipient,'email',p_recipient::text) on conflict do nothing;
end $$;
create function public.studkab_process_assistant_event() returns trigger language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if new.kind not in ('returned','problem') then return new;end if;
 select * into j from public.studkab_assistant_jobs where id=new.job_id;
 if not found then return new;end if;
 perform public.studkab_process_notify_enqueue(j.request_id,j.owner_id,case when new.kind='returned' then 'file_prepared' else 'problem' end,new.event_key);
 return new;
end $$;
create trigger assistant_notification_event after insert on public.studkab_assistant_events for each row execute function public.studkab_process_assistant_event();
create function public.studkab_process_work_event() returns trigger language plpgsql security invoker set search_path='' as $$
declare owner uuid;
begin
 owner:=public.studkab_assistant_runner_actor();
 if tg_op='UPDATE' then
  if new.delivered_at is not null and new.delivered_at is distinct from old.delivered_at then
   perform public.studkab_process_notify_enqueue(new.request_id,new.student_id,'delivered','r3-delivered:'||new.request_id::text||':'||new.delivered_at::text);
  end if;
  if new.handed_at is not null and new.handed_at is distinct from old.handed_at then
   perform public.studkab_process_notify_enqueue(new.request_id,owner,'handed','r3-handed:'||new.request_id::text||':'||new.handed_at::text);
  end if;
  if new.returned_at is not null and new.returned_at is distinct from old.returned_at then
   perform public.studkab_process_notify_enqueue(new.request_id,owner,'rework','r3-rework:'||new.request_id::text||':'||new.returned_at::text);
  end if;
 end if;return new;
end $$;
create trigger process_work_event after update on public.studkab_r3_work for each row execute function public.studkab_process_work_event();
create function public.studkab_process_question_event() returns trigger language plpgsql security invoker set search_path='' as $$
declare recipient uuid;
begin
 if tg_op='INSERT' then
  select student_id into recipient from public.studkab_requests where id=new.request_id;
  perform public.studkab_process_notify_enqueue(new.request_id,recipient,'question','r3-question:'||new.id::text);
 elsif new.answered_at is not null and old.answered_at is null then
  recipient:=public.studkab_assistant_runner_actor();
  perform public.studkab_process_notify_enqueue(new.request_id,recipient,'answer','r3-answer:'||new.id::text);
 end if;return new;
end $$;
create trigger process_question_event after insert or update on public.studkab_clarifications for each row execute function public.studkab_process_question_event();
create function public.studkab_process_notification_claim(p_channel text) returns setof jsonb
language plpgsql security invoker set search_path='' as $$
declare n public.studkab_process_notifications;owner uuid;r public.studkab_requests;sub jsonb;email text;chat bigint;
begin
 if p_channel not in ('push','telegram','email') then raise exception 'INVALID_CHANNEL';end if;
 update public.studkab_process_notifications set status='unknown',lease_id=null,lease_until=null,last_code='RECEIPT_UNKNOWN' where status='claimed' and lease_until<=clock_timestamp();
 owner:=public.studkab_assistant_runner_actor();
 for n in select * from public.studkab_process_notifications where channel=p_channel and status in ('pending','not_configured') and retry_at<=clock_timestamp() order by occurred_at,id limit 5 for update skip locked loop
  select * into r from public.studkab_requests where id=n.request_id and deleting_at is null and ready_at is not null;
  if not found or n.occurred_at<clock_timestamp()-interval '7 days' or n.recipient_id is distinct from (case when n.kind in ('question','delivered') then r.student_id else owner end) then
   update public.studkab_process_notifications set status='cancelled',last_code='RECIPIENT_CHANGED' where id=n.id;continue;
  end if;
  sub:=null;email:=null;chat:=null;
  if p_channel='push' then
   select subscription into sub from public.studkab_push_subscriptions where id=n.device_id and user_id=n.recipient_id and enabled;
   if not found then update public.studkab_process_notifications set status='cancelled',last_code='DEVICE_DISABLED' where id=n.id;continue;end if;
  elsif p_channel='email' then
   if n.recipient_id=owner then select notification_email into email from public.studkab_request_config;
   else select u.email into email from auth.users u where u.id=n.recipient_id and u.email_confirmed_at is not null;end if;
  else
   if n.recipient_id=owner then select owner_chat_id into chat from public.studkab_telegram_setup where installed;
   else select chat_id into chat from public.studkab_telegram_accounts where user_id=n.recipient_id;end if;
  end if;
  update public.studkab_process_notifications set status='claimed',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1 where id=n.id returning * into n;
  return next jsonb_build_object('id',n.id,'lease',n.lease_id,'requestId',n.request_id,'number',r.number,'kind',n.kind,'channel',n.channel,'recipient',n.recipient_id,'email',email,'chat',chat,'deviceId',n.device_id,'subscription',sub,'eventKey',n.event_key);
 end loop;
end $$;
create function public.studkab_process_notification_finish(p_id uuid,p_lease uuid,p_status text,p_receipt text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('pending','accepted','unknown','failed','not_configured','cancelled') or length(coalesce(p_receipt,''))>200 then raise exception 'INVALID_NOTIFICATION_RESULT';end if;
 update public.studkab_process_notifications set status=p_status,provider_receipt=p_receipt,
 accepted_at=case when p_status='accepted' then clock_timestamp() else accepted_at end,
 retry_at=clock_timestamp()+interval '10 minutes',lease_id=null,lease_until=null,
 last_code=case when p_status='accepted' then null when p_status='not_configured' then 'CHANNEL_UNAVAILABLE' when p_status='unknown' then 'RECEIPT_UNKNOWN' else 'CHANNEL_REFUSED' end
 where id=p_id and lease_id=p_lease and status='claimed' and lease_until>clock_timestamp();return found;
end $$;
create function public.studkab_telegram_link_create(p_user uuid,p_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.studkab_members where user_id=p_user) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,901));
 delete from public.studkab_telegram_links where user_id=p_user;
 insert into public.studkab_telegram_links(token_hash,user_id,expires_at) values(p_hash,p_user,clock_timestamp()+interval '15 minutes');
 return jsonb_build_object('expiresAt',clock_timestamp()+interval '15 minutes');
end $$;
create function public.studkab_telegram_link_consume(p_hash text,p_chat bigint) returns boolean language plpgsql security invoker set search_path='' as $$
declare l public.studkab_telegram_links;owner uuid;
begin
 if p_chat is null or p_chat<=0 then return false;end if;
 -- Serialize global owner and personal bindings on the same existing setup rows.
 perform 1 from public.studkab_telegram_setup for update;
 owner:=public.studkab_assistant_runner_actor();
 select * into l from public.studkab_telegram_links where token_hash=p_hash and consumed_at is null and expires_at>clock_timestamp() for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=l.user_id) then return false;end if;
 if exists(select 1 from public.studkab_telegram_accounts where chat_id=p_chat and user_id<>l.user_id) then return false;end if;
 if l.user_id is distinct from owner and exists(select 1 from public.studkab_telegram_setup where owner_chat_id=p_chat) then return false;end if;
 if l.user_id=owner and not exists(select 1 from public.studkab_telegram_setup where installed) then return false;end if;
 insert into public.studkab_telegram_accounts(user_id,chat_id) values(l.user_id,p_chat) on conflict(user_id) do update set chat_id=excluded.chat_id,linked_at=clock_timestamp();
 if l.user_id=owner then update public.studkab_telegram_setup set owner_chat_id=p_chat,bound_at=clock_timestamp() where installed;end if;
 update public.studkab_telegram_links set consumed_at=clock_timestamp() where token_hash=p_hash;return true;
end $$;
create function public.studkab_telegram_unlink(p_user uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.studkab_members where user_id=p_user) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.studkab_telegram_setup for update;
 if p_user=public.studkab_assistant_runner_actor() then update public.studkab_telegram_setup set owner_chat_id=null,bound_at=null;end if;
 delete from public.studkab_telegram_accounts where user_id=p_user;delete from public.studkab_telegram_links where user_id=p_user;return true;
end $$;
-- Readable delivery metadata only, never secret targets, document kits or tokens.
create function public.studkab_process_notification_state(p_user uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.studkab_members where user_id=p_user) then raise exception 'FORBIDDEN';end if;
 return jsonb_build_object('push',jsonb_build_object('configured',exists(select 1 from public.studkab_push_subscriptions where user_id=p_user and enabled)),
 'telegram',jsonb_build_object('configured',exists(select 1 from public.studkab_telegram_accounts where user_id=p_user) or exists(select 1 from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) join public.studkab_telegram_setup t on t.installed where u.id=p_user and t.owner_chat_id is not null)),
 'deliveries',coalesce((select jsonb_agg(x) from (select kind,channel,status,occurred_at as at,accepted_at as acceptedAt from public.studkab_process_notifications where recipient_id=p_user order by occurred_at desc limit 20) x),'[]'));
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'studkab_process_%' or p.proname like 'studkab_telegram_link_%' or p.proname='studkab_telegram_unlink') loop
  execute 'revoke all on function '||f.signature||' from public,anon,authenticated';execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end $$;

-- Future unknown/blocking transitions create one stable event per job version.
-- No existing jobs or events are replayed by installing this trigger change.
create or replace function public.studkab_assistant_event_record() returns trigger language plpgsql security invoker set search_path='' as $$
declare k text;
begin
 k:=case when tg_op='INSERT' then 'accepted'
 when new.state='unknown' and old.state is distinct from new.state then 'problem'
 when old.state='claimed' and new.state in ('prepared','queued') then 'problem'
 when new.reviewed_at is not null and old.reviewed_at is null then 'reviewed'
 when new.returned_at is not null and old.returned_at is null then 'returned'
 when new.started_at is not null and old.started_at is null then 'started'
 else null end;
 if k is not null then insert into public.studkab_assistant_events(job_id,kind,event_key)
 values(new.id,k,new.id::text||':'||k||':'||new.revision::text) on conflict do nothing;end if;
 return new;
end $$;
