-- M2: immutable student materials. Files are private and only the Edge service
-- can access Storage; authorization is checked against the request owner.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('studkab-request-materials','studkab-request-materials',false,5242880,
 array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

create table public.studkab_request_attachments (
 id uuid primary key,
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 student_id uuid not null,
 category text not null check(category in ('assignment','methodology','data','sources')),
 file_name text not null check(length(file_name) between 1 and 180),
 content_type text not null check(content_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain')),
 size_bytes integer not null check(size_bytes between 1 and 5242880),
 file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
 storage_path text not null unique,
 extracted_text text not null check(length(extracted_text) between 1 and 500000),
 created_at timestamptz not null default now(),
 unique(request_id,file_hash)
);
create index studkab_request_attachments_request on public.studkab_request_attachments(request_id,created_at);
alter table public.studkab_request_attachments enable row level security;
revoke all on public.studkab_request_attachments from public,anon,authenticated;
grant select,insert on public.studkab_request_attachments to service_role;

create function public.studkab_attachment_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.request_id::text,0));
 if (select count(*) from public.studkab_request_attachments where request_id=new.request_id) >= 8
 then raise exception 'Attachment limit'; end if;
 return new;
end $$;
revoke all on function public.studkab_attachment_limit() from public,anon,authenticated;
create trigger studkab_attachment_limit before insert
on public.studkab_request_attachments for each row execute function public.studkab_attachment_limit();

create function public.studkab_attachment_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Immutable attachment'; end $$;
revoke all on function public.studkab_attachment_immutable() from public,anon,authenticated;
create trigger studkab_attachment_immutable before update
on public.studkab_request_attachments for each row execute function public.studkab_attachment_immutable();
