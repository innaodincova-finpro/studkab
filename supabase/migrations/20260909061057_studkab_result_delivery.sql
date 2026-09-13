begin;
-- Documents are text snapshots of the registry builder, not binary attachments.
-- Keeping immutable versions allows safe retries and preserves earlier results.
create table public.studkab_results (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.studkab_requests(id),
 delivery_id uuid not null,
 document jsonb not null check(octet_length(document::text)<=4000000),
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,delivery_id)
);
create index studkab_results_latest on public.studkab_results(request_id,created_at desc,id desc);
alter table public.studkab_results enable row level security;
revoke all on public.studkab_results from public,anon,authenticated;
revoke all on sequence public.studkab_results_id_seq from public,anon,authenticated;
grant select,insert on public.studkab_results to service_role;
grant usage,select on sequence public.studkab_results_id_seq to service_role;
create function public.deliver_studkab_result(request uuid,delivery uuid,content jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.studkab_results;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 select * into r from public.studkab_results where request_id=request and delivery_id=delivery;
 if found then
  if r.document<>content then return jsonb_build_object('conflict',true); end if;
  return jsonb_build_object('deliveryId',r.delivery_id,'createdAt',r.created_at,'duplicate',true);
 end if;
 insert into public.studkab_results(request_id,delivery_id,document) values(request,delivery,content) returning * into r;
 return jsonb_build_object('deliveryId',r.delivery_id,'createdAt',r.created_at,'duplicate',false);
end $$;
revoke all on function public.deliver_studkab_result(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.deliver_studkab_result(uuid,uuid,jsonb) to service_role;
commit;
