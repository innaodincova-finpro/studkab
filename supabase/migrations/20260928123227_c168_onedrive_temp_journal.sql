-- C168: durable, service-only inventory of temporary files sent to Graph.
-- No document bytes or OAuth credentials belong in this table.
begin;

create table public.studkab_graph_temp_files (
 id uuid primary key default gen_random_uuid(),
 drive_id text not null check(length(drive_id) between 1 and 200),
 file_name text not null unique check(file_name ~ '^studkab-[a-f0-9-]{36}\.docx$'),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 state text not null default 'pending' check(state in ('pending','cleared')),
 created_at timestamptz not null default now(),
 cleared_at timestamptz,
 claim_token uuid,
 lease_until timestamptz,
 attempts integer not null default 0 check(attempts between 0 and 8),
 constraint graph_temp_clear_consistent check((state='cleared')=(cleared_at is not null))
);
create index studkab_graph_temp_pending on public.studkab_graph_temp_files(created_at)
 where state='pending';
alter table public.studkab_graph_temp_files enable row level security;
revoke all on public.studkab_graph_temp_files from public,anon,authenticated;
grant select,insert,update on public.studkab_graph_temp_files to service_role;

-- A worker only claims old records so the live converter can finish its own
-- cleanup. SKIP LOCKED keeps concurrent workers from taking the same item.
create function public.studkab_graph_claim_cleanup()
returns setof public.studkab_graph_temp_files
language sql security invoker set search_path='' as $$
 update public.studkab_graph_temp_files f
 set claim_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',
     attempts=f.attempts+1
 where f.id in (
  select p.id from public.studkab_graph_temp_files p
  where p.state='pending' and p.created_at<now()-interval '10 minutes'
    and (p.lease_until is null or p.lease_until<now()) and p.attempts<8
  order by p.created_at,p.id limit 10 for update skip locked
 ) returning f.*;
$$;
revoke all on function public.studkab_graph_claim_cleanup() from public,anon,authenticated;
grant execute on function public.studkab_graph_claim_cleanup() to service_role;

commit;
