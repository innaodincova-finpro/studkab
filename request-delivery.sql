begin;
create table public.studkab_request_config (
 id boolean primary key default true check(id),
 executor_email text not null,
 notification_email text not null,
 cron_token text not null default (gen_random_uuid()::text||gen_random_uuid()::text)
);
insert into public.studkab_request_config(id,executor_email,notification_email)
values(true,'inna_odincova@mail.ru','inna_odincova@mail.ru');
create table public.studkab_requests (
 id uuid primary key default gen_random_uuid(),
 number bigint generated always as identity unique,
 student_id uuid not null references auth.users(id),
 client_id text not null,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 telegram_sent_at timestamptz,
 telegram_attempts int not null default 0,
 retry_at timestamptz not null default now(),
 lease_until timestamptz,
 last_error text,
 unique(student_id,client_id)
);
create index studkab_requests_pending on public.studkab_requests(retry_at) where telegram_sent_at is null;
alter table public.studkab_requests enable row level security;
alter table public.studkab_request_config enable row level security;
revoke all on public.studkab_requests,public.studkab_request_config from public,anon,authenticated;
revoke all on sequence public.studkab_requests_number_seq from public,anon,authenticated;
grant select,insert,update on public.studkab_requests to service_role;
grant select on public.studkab_request_config to service_role;
grant usage,select on sequence public.studkab_requests_number_seq to service_role;

create function public.submit_studkab_request(student uuid, content jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.studkab_requests;
begin
 perform pg_advisory_xact_lock(hashtextextended(student::text, 712));
 select * into r from public.studkab_requests where student_id=student and client_id=content->>'id';
 if found then
   if r.payload<>content then return jsonb_build_object('conflict',true); end if;
   return jsonb_build_object('id',r.id,'number',r.number,'duplicate',true);
 end if;
 if (select count(*) from public.studkab_requests where student_id=student and created_at>now()-interval '1 day')>=30 then
   return jsonb_build_object('limited',true);
 end if;
 insert into public.studkab_requests(student_id,client_id,payload) values(student,content->>'id',content) returning * into r;
 return jsonb_build_object('id',r.id,'number',r.number,'duplicate',false);
end $$;
revoke all on function public.submit_studkab_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_studkab_request(uuid,jsonb) to service_role;

create function public.claim_studkab_requests()
returns setof public.studkab_requests language sql security invoker set search_path=pg_catalog,public as $$
 update public.studkab_requests set lease_until=now()+interval '2 minutes',telegram_attempts=telegram_attempts+1
 where id in (select id from public.studkab_requests where telegram_sent_at is null and retry_at<=now()
 and (lease_until is null or lease_until<now()) and telegram_attempts<8 order by created_at limit 5 for update skip locked)
 returning *;
$$;
revoke all on function public.claim_studkab_requests() from public,anon,authenticated;
grant execute on function public.claim_studkab_requests() to service_role;
commit;
