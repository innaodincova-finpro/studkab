-- C114: a request is visible to the executor and Telegram only after all
-- four verified attachments have been stored. Existing requests stay visible.
begin;
alter table public.studkab_requests add column ready_at timestamptz;
update public.studkab_requests set ready_at=created_at where ready_at is null;
create index studkab_requests_ready_inbox on public.studkab_requests(number) where ready_at is not null and deleting_at is null;

create or replace function public.claim_studkab_requests()
returns setof public.studkab_requests language sql security invoker set search_path=pg_catalog,public as $$
 update public.studkab_requests set lease_until=now()+interval '2 minutes',telegram_attempts=telegram_attempts+1
 where id in (select id from public.studkab_requests where ready_at is not null and deleting_at is null
 and telegram_sent_at is null and retry_at<=now() and (lease_until is null or lease_until<now())
 and telegram_attempts<8 order by created_at limit 5 for update skip locked)
 returning *;
$$;

create function public.studkab_request_publish(p_request uuid,p_student uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.studkab_requests; categories text[];
begin
 select * into r from public.studkab_requests where id=p_request and student_id=p_student and deleting_at is null for update;
 if not found then return jsonb_build_object('missing',true); end if;
 if r.ready_at is not null then return jsonb_build_object('ready',true,'number',r.number,'duplicate',true); end if;
 select array_agg(a.category order by a.category) into categories
 from public.studkab_request_attachments a
 where a.request_id=p_request and not exists
   (select 1 from public.studkab_request_attachments successor where successor.supersedes=a.id);
 if categories is distinct from array['assignment','data','methodology','sources']::text[] then
   return jsonb_build_object('incomplete',true);
 end if;
 update public.studkab_requests set ready_at=now(),retry_at=now() where id=p_request;
 return jsonb_build_object('ready',true,'number',r.number,'duplicate',false);
end $$;
revoke all on function public.studkab_request_publish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studkab_request_publish(uuid,uuid) to service_role;
commit;
