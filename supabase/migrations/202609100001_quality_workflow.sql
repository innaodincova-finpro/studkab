begin;

-- Additive pilot schema. Existing request/result delivery remains untouched.
create table public.studkab_workflow_config (
 id boolean primary key default true check (id),
 enabled boolean not null default false,
 pilot_student_ids uuid[] not null default '{}',
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.studkab_workflow_config(id) values (true);

create table public.studkab_executors (
 user_id uuid primary key references auth.users(id),
 active boolean not null default true,
 created_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 check ((active and revoked_at is null) or not active)
);

create table public.studkab_request_process (
 request_id uuid primary key references public.studkab_requests(id) on delete restrict,
 status text not null default 'submitted' check (status in
  ('submitted','completeness_review','needs_information','passport_draft','passport_approved',
   'preparing','quality_review','changes_required','ready_to_deliver','delivered','closed','cancelled')),
 revision bigint not null default 1 check (revision > 0),
 assigned_executor_id uuid references public.studkab_executors(user_id),
 due_at timestamptz,
 retention_until timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);

create table public.studkab_request_files (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.studkab_requests(id) on delete restrict,
 student_id uuid not null references auth.users(id),
 purpose text not null check (purpose in ('assignment','guidelines','financials','bibliography','sample','other','result_docx')),
 version integer not null check (version > 0),
 replaces_file_id uuid references public.studkab_request_files(id),
 storage_path text not null unique check (storage_path = request_id::text || '/' || id::text || '/' || version::text),
 original_name text not null check (char_length(original_name) between 1 and 255 and original_name !~ '[\\/\x00]'),
 declared_mime text not null,
 detected_mime text,
 size_bytes bigint not null check (size_bytes between 1 and 15728640),
 sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
 page_count integer check (page_count between 1 and 150),
 state text not null default 'uploading' check (state in ('uploading','quarantined','accepted','rejected','superseded','deleted')),
 rejection_code text,
 created_at timestamptz not null default clock_timestamp(),
 accepted_at timestamptz,
 deleted_at timestamptz,
 unique (request_id,purpose,version),
 check (state<>'accepted' or accepted_at is not null),
 check (state<>'deleted' or deleted_at is not null)
);
create index studkab_request_files_request on public.studkab_request_files(request_id,created_at);

create table public.studkab_requirement_passports (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.studkab_requests(id) on delete restrict,
 version integer not null check (version > 0),
 profile_code text not null,
 profile_version text not null,
 state text not null default 'draft' check (state in ('draft','needs_clarification','approved','superseded')),
 source_set_hash text check (source_set_hash ~ '^[0-9a-f]{64}$'),
 supersedes_id uuid references public.studkab_requirement_passports(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 unique(request_id,version),
 check (state<>'approved' or (approved_at is not null and approved_by is not null))
);

create table public.studkab_requirement_items (
 id uuid primary key default gen_random_uuid(),
 passport_id uuid not null references public.studkab_requirement_passports(id) on delete restrict,
 code text not null,
 rule_text text not null check (char_length(rule_text) between 1 and 4000),
 source_type text not null check (source_type in ('assignment','guidelines','clarification','standard','profile')),
 source_file_id uuid references public.studkab_request_files(id),
 source_location text,
 source_excerpt text check (char_length(source_excerpt) <= 4000),
 severity text not null check (severity in ('critical','substantial','advisory')),
 scope text not null,
 verification_method text not null check (verification_method in ('automatic','manual','combined')),
 applicability text not null default 'unresolved' check (applicability in ('applicable','not_applicable','unresolved')),
 resolution_note text,
 unique(passport_id,code)
);

create table public.studkab_document_versions (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.studkab_requests(id) on delete restrict,
 passport_id uuid not null references public.studkab_requirement_passports(id) on delete restrict,
 version integer not null check (version > 0),
 state text not null default 'building' check (state in ('building','ready_for_review','changes_required','approved','delivered','superseded')),
 content jsonb not null check (octet_length(content::text) <= 4000000),
 content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
 docx_file_id uuid references public.studkab_request_files(id),
 docx_sha256 text check (docx_sha256 ~ '^[0-9a-f]{64}$'),
 exporter_version text not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 unique(request_id,version),
 check (state not in ('approved','delivered') or (approved_at is not null and approved_by is not null)),
 check (state not in ('approved','delivered') or (docx_file_id is not null and docx_sha256 is not null))
);

create table public.studkab_criterion_results (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.studkab_document_versions(id) on delete restrict,
 requirement_id uuid not null references public.studkab_requirement_items(id) on delete restrict,
 status text not null check (status in ('pass','fail','not_applicable','unable_to_verify')),
 evaluator_type text not null check (evaluator_type in ('automatic','ai_assisted','human')),
 evidence jsonb not null default '{}',
 comment text,
 decided_by uuid references auth.users(id),
 decided_at timestamptz not null default clock_timestamp(),
 checker_version text,
 unique(document_id,requirement_id,evaluator_type)
);

create table public.studkab_clarifications (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.studkab_requests(id) on delete restrict,
 requirement_id uuid references public.studkab_requirement_items(id),
 question text not null check (char_length(question) between 1 and 4000),
 state text not null default 'open' check (state in ('open','answered','accepted','closed')),
 asked_by uuid not null references auth.users(id),
 asked_at timestamptz not null default clock_timestamp(),
 answer text check (char_length(answer) between 1 and 12000),
 answered_by uuid references auth.users(id),
 answered_at timestamptz,
 check ((answer is null and answered_by is null and answered_at is null) or
        (answer is not null and answered_by is not null and answered_at is not null))
);

create table public.studkab_status_events (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.studkab_requests(id) on delete restrict,
 from_status text,
 to_status text not null,
 actor_id uuid references auth.users(id),
 actor_type text not null check (actor_type in ('student','executor','service')),
 reason_code text not null check (reason_code ~ '^[a-z0-9_]{1,80}$'),
 entity_type text,
 entity_id uuid,
 created_at timestamptz not null default clock_timestamp()
);
create index studkab_status_events_request on public.studkab_status_events(request_id,id);

alter table public.studkab_request_process
 add column active_passport_id uuid references public.studkab_requirement_passports(id),
 add column active_document_id uuid references public.studkab_document_versions(id),
 add column delivered_document_id uuid references public.studkab_document_versions(id);

-- Exact checked binaries and student inputs share one private bucket; access is metadata-led.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('studkab-private','studkab-private',false,15728640,
 array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain',
 'image/png','image/jpeg','image/heic'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Deny by default. Browser users only receive the narrow read paths below.
alter table public.studkab_workflow_config enable row level security;
alter table public.studkab_executors enable row level security;
alter table public.studkab_request_process enable row level security;
alter table public.studkab_request_files enable row level security;
alter table public.studkab_requirement_passports enable row level security;
alter table public.studkab_requirement_items enable row level security;
alter table public.studkab_document_versions enable row level security;
alter table public.studkab_criterion_results enable row level security;
alter table public.studkab_clarifications enable row level security;
alter table public.studkab_status_events enable row level security;

revoke all on public.studkab_workflow_config,public.studkab_executors,public.studkab_request_process,
 public.studkab_request_files,public.studkab_requirement_passports,public.studkab_requirement_items,
 public.studkab_document_versions,public.studkab_criterion_results,public.studkab_clarifications,
 public.studkab_status_events from public,anon,authenticated;
revoke all on sequence public.studkab_status_events_id_seq from public,anon,authenticated;
grant select,insert,update on public.studkab_workflow_config,public.studkab_executors,
 public.studkab_request_process,public.studkab_request_files,public.studkab_requirement_passports,
 public.studkab_requirement_items,public.studkab_document_versions,public.studkab_criterion_results,
 public.studkab_clarifications,public.studkab_status_events to service_role;
grant usage,select on sequence public.studkab_status_events_id_seq to service_role;
grant select on public.studkab_request_process,public.studkab_request_files,
 public.studkab_document_versions,public.studkab_clarifications to authenticated;

create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;
create function private.studkab_student_owns_request(target uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public
as $$ select exists(select 1 from public.studkab_requests r where r.id=target and r.student_id=auth.uid()) $$;
revoke all on function private.studkab_student_owns_request(uuid) from public,anon;
grant execute on function private.studkab_student_owns_request(uuid) to authenticated;

create policy student_read_process on public.studkab_request_process for select to authenticated
 using (private.studkab_student_owns_request(request_id));
create policy student_read_files on public.studkab_request_files for select to authenticated
 using (student_id=auth.uid() and state in ('uploading','quarantined','accepted','rejected','superseded'));
create policy student_read_delivered_documents on public.studkab_document_versions for select to authenticated
 using (state='delivered' and private.studkab_student_owns_request(request_id));
create policy student_read_clarifications on public.studkab_clarifications for select to authenticated
 using (private.studkab_student_owns_request(request_id));

create policy student_upload_private_object on storage.objects for insert to authenticated
 with check (bucket_id='studkab-private' and exists (
  select 1 from public.studkab_request_files f
  where f.storage_path=name and f.student_id=auth.uid() and f.state='uploading'
  and f.purpose<>'result_docx'));
create policy student_read_private_object on storage.objects for select to authenticated
 using (bucket_id='studkab-private' and exists (
  select 1 from public.studkab_request_files f
  where f.storage_path=name and f.student_id=auth.uid()
  and (f.state in ('uploading','quarantined','accepted','rejected','superseded')
       or (f.purpose='result_docx' and f.state='accepted'))));

create function public.studkab_initialize_request(target uuid, actor uuid)
returns public.studkab_request_process language plpgsql security invoker
set search_path=pg_catalog,public as $$
declare current public.studkab_request_process;
begin
 if not exists(select 1 from public.studkab_workflow_config where id and enabled) then raise exception 'workflow_disabled'; end if;
 if not exists(select 1 from public.studkab_requests where id=target) then raise exception 'request_not_found'; end if;
 insert into public.studkab_request_process(request_id) values(target)
 on conflict(request_id) do nothing returning * into current;
 if found then
  insert into public.studkab_status_events(request_id,from_status,to_status,actor_id,actor_type,reason_code)
  values(target,null,'submitted',actor,'service','request_initialized');
 else
  select * into current from public.studkab_request_process where request_id=target;
 end if;
 return current;
end $$;
revoke all on function public.studkab_initialize_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studkab_initialize_request(uuid,uuid) to service_role;

create function public.studkab_transition_request(
 target uuid, expected_revision bigint, next_status text, actor uuid,
 actor_kind text, reason text, related_type text default null, related_id uuid default null)
returns public.studkab_request_process language plpgsql security invoker
set search_path=pg_catalog,public as $$
declare current public.studkab_request_process; previous_status text; allowed boolean;
begin
 if not exists(select 1 from public.studkab_workflow_config where id and enabled) then raise exception 'workflow_disabled'; end if;
 select * into current from public.studkab_request_process where request_id=target for update;
 if not found then raise exception 'request_process_not_found'; end if;
 if current.revision<>expected_revision then raise exception 'revision_conflict'; end if;
 previous_status:=current.status;
 allowed := (previous_status,next_status) in (
  ('submitted','completeness_review'),('completeness_review','needs_information'),('completeness_review','passport_draft'),
  ('needs_information','completeness_review'),('passport_draft','needs_information'),('passport_draft','passport_approved'),
  ('passport_approved','preparing'),('preparing','quality_review'),('quality_review','changes_required'),
  ('changes_required','preparing'),('quality_review','ready_to_deliver'),('ready_to_deliver','delivered'),('delivered','closed'))
  or (next_status='cancelled' and previous_status not in ('closed','cancelled'));
 if not allowed then raise exception 'invalid_transition'; end if;
 if actor_kind not in ('student','executor','service') or reason !~ '^[a-z0-9_]{1,80}$' then raise exception 'invalid_audit_data'; end if;
 update public.studkab_request_process set status=next_status,revision=revision+1,updated_at=clock_timestamp()
  where request_id=target returning * into current;
 insert into public.studkab_status_events(request_id,from_status,to_status,actor_id,actor_type,reason_code,entity_type,entity_id)
 values(target,previous_status,next_status,actor,actor_kind,reason,related_type,related_id);
 return current;
end $$;

revoke all on function public.studkab_transition_request(uuid,bigint,text,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.studkab_transition_request(uuid,bigint,text,uuid,text,text,text,uuid) to service_role;

commit;
