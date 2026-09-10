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

create table public.studkab_command_receipts (
 command_id uuid primary key,
 request_id uuid not null references public.studkab_requests(id) on delete restrict,
 command_name text not null check (command_name ~ '^[a-z_]{1,80}$'),
 response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);

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
alter table public.studkab_command_receipts enable row level security;

revoke all on public.studkab_workflow_config,public.studkab_executors,public.studkab_request_process,
 public.studkab_request_files,public.studkab_requirement_passports,public.studkab_requirement_items,
 public.studkab_document_versions,public.studkab_criterion_results,public.studkab_clarifications,
 public.studkab_status_events,public.studkab_command_receipts from public,anon,authenticated;
revoke all on sequence public.studkab_status_events_id_seq from public,anon,authenticated;
grant select,insert,update on public.studkab_workflow_config,public.studkab_executors,
 public.studkab_request_process,public.studkab_request_files,public.studkab_requirement_passports,
 public.studkab_requirement_items,public.studkab_document_versions,public.studkab_criterion_results,
 public.studkab_clarifications,public.studkab_status_events,public.studkab_command_receipts to service_role;
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

create function private.studkab_run_command(command_id uuid, command_name text, request_id uuid, actor uuid, payload jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare receipt public.studkab_command_receipts; result jsonb; file_row public.studkab_request_files;
 passport_row public.studkab_requirement_passports; clarification_row public.studkab_clarifications;
 document_row public.studkab_document_versions; process_row public.studkab_request_process;
 item jsonb; next_version integer; owner_id uuid;
begin
 if not exists(select 1 from public.studkab_workflow_config where id and enabled) then raise exception 'workflow_disabled'; end if;
 perform pg_advisory_xact_lock(hashtextextended(command_id::text,714));
 select * into receipt from public.studkab_command_receipts where studkab_command_receipts.command_id=studkab_run_command.command_id;
 if found then
  if receipt.request_id<>studkab_run_command.request_id or receipt.command_name<>studkab_run_command.command_name then raise exception 'command_conflict'; end if;
  return receipt.response || jsonb_build_object('duplicate',true);
 end if;
 select student_id into owner_id from public.studkab_requests where id=request_id;
 if not found then raise exception 'request_not_found'; end if;

 if command_name='prepare_upload' then
  if actor is null or actor<>owner_id then raise exception 'not_owner'; end if;
  if (payload->>'purpose') not in ('assignment','guidelines','financials','bibliography','sample','other') then raise exception 'invalid_purpose'; end if;
  if coalesce((payload->>'sizeBytes')::bigint,0) not between 1 and 15728640 then raise exception 'invalid_size'; end if;
  if (select count(*) from public.studkab_request_files where request_id=studkab_run_command.request_id and state not in ('deleted','superseded'))>=12 then raise exception 'file_count_limit'; end if;
  if (select coalesce(sum(size_bytes),0) from public.studkab_request_files where request_id=studkab_run_command.request_id and state not in ('deleted','superseded'))+((payload->>'sizeBytes')::bigint)>62914560 then raise exception 'request_size_limit'; end if;
  select coalesce(max(version),0)+1 into next_version from public.studkab_request_files where request_id=studkab_run_command.request_id and purpose=payload->>'purpose';
  file_row.id:=gen_random_uuid();
  insert into public.studkab_request_files(id,request_id,student_id,purpose,version,storage_path,original_name,declared_mime,size_bytes)
  values(file_row.id,request_id,owner_id,payload->>'purpose',next_version,request_id::text||'/'||file_row.id::text||'/'||next_version,
   payload->>'originalName',payload->>'declaredMime',(payload->>'sizeBytes')::bigint) returning * into file_row;
  result=jsonb_build_object('fileId',file_row.id,'path',file_row.storage_path,'version',file_row.version);

 elsif command_name='accept_upload' then
  select * into file_row from public.studkab_request_files where id=(payload->>'fileId')::uuid and request_id=studkab_run_command.request_id for update;
  if not found or file_row.state not in ('uploading','quarantined') then raise exception 'file_not_found'; end if;
  update public.studkab_request_files set detected_mime=payload->>'detectedMime',sha256=payload->>'sha256',
   page_count=nullif(payload->>'pageCount','')::integer,state=case when (payload->>'accepted')::boolean then 'accepted' else 'rejected' end,
   accepted_at=case when (payload->>'accepted')::boolean then clock_timestamp() end,rejection_code=case when not (payload->>'accepted')::boolean then payload->>'rejectionCode' end
  where id=file_row.id returning * into file_row;
  result=jsonb_build_object('fileId',file_row.id,'state',file_row.state);

 elsif command_name='submit_passport' then
  select coalesce(max(version),0)+1 into next_version from public.studkab_requirement_passports where request_id=studkab_run_command.request_id;
  insert into public.studkab_requirement_passports(request_id,version,profile_code,profile_version,source_set_hash,created_by)
  values(request_id,next_version,payload->>'profileCode',payload->>'profileVersion',payload->>'sourceSetHash',actor) returning * into passport_row;
  for item in select * from jsonb_array_elements(coalesce(payload->'items','[]')) loop
   insert into public.studkab_requirement_items(passport_id,code,rule_text,source_type,source_file_id,source_location,source_excerpt,severity,scope,verification_method,applicability,resolution_note)
   values(passport_row.id,item->>'code',item->>'ruleText',item->>'sourceType',nullif(item->>'sourceFileId','')::uuid,item->>'sourceLocation',item->>'sourceExcerpt',item->>'severity',item->>'scope',item->>'verificationMethod',coalesce(item->>'applicability','unresolved'),item->>'resolutionNote');
  end loop;
  update public.studkab_request_process set status='passport_draft',revision=revision+1,updated_at=clock_timestamp() where request_id=studkab_run_command.request_id returning * into process_row;
  result=jsonb_build_object('passportId',passport_row.id,'version',passport_row.version,'revision',process_row.revision);

 elsif command_name='approve_passport' then
  select * into process_row from public.studkab_request_process where request_id=studkab_run_command.request_id for update;
  if process_row.revision<>(payload->>'expectedRevision')::bigint or process_row.status<>'passport_draft' then raise exception 'revision_conflict'; end if;
  update public.studkab_requirement_passports set state='superseded' where request_id=studkab_run_command.request_id and state='approved';
  update public.studkab_requirement_passports set state='approved',approved_by=actor,approved_at=clock_timestamp()
   where id=(payload->>'passportId')::uuid and request_id=studkab_run_command.request_id and state='draft' returning * into passport_row;
  if not found or exists(select 1 from public.studkab_requirement_items where passport_id=passport_row.id and applicability='unresolved') then raise exception 'passport_not_ready'; end if;
  update public.studkab_request_process set active_passport_id=passport_row.id,status='passport_approved',revision=revision+1,updated_at=clock_timestamp()
   where request_id=studkab_run_command.request_id returning * into process_row;
  result=jsonb_build_object('passportId',passport_row.id,'revision',process_row.revision);

 elsif command_name='ask_clarification' then
  insert into public.studkab_clarifications(request_id,requirement_id,question,asked_by)
  values(request_id,nullif(payload->>'requirementId','')::uuid,payload->>'question',actor) returning * into clarification_row;
  update public.studkab_request_process set status='needs_information',revision=revision+1,updated_at=clock_timestamp() where request_id=studkab_run_command.request_id returning * into process_row;
  result=jsonb_build_object('clarificationId',clarification_row.id,'revision',process_row.revision);

 elsif command_name='answer_clarification' then
  if actor<>owner_id then raise exception 'not_owner'; end if;
  update public.studkab_clarifications set answer=payload->>'answer',answered_by=actor,answered_at=clock_timestamp(),state='answered'
   where id=(payload->>'clarificationId')::uuid and request_id=studkab_run_command.request_id and state='open' returning * into clarification_row;
  if not found then raise exception 'clarification_not_found'; end if;
  result=jsonb_build_object('clarificationId',clarification_row.id,'state',clarification_row.state);

 elsif command_name='create_document_version' then
  select coalesce(max(version),0)+1 into next_version from public.studkab_document_versions where request_id=studkab_run_command.request_id;
  insert into public.studkab_document_versions(request_id,passport_id,version,state,content,content_sha256,docx_file_id,docx_sha256,exporter_version,created_by)
  values(request_id,(payload->>'passportId')::uuid,next_version,'ready_for_review',payload->'content',payload->>'contentSha256',
   nullif(payload->>'docxFileId','')::uuid,payload->>'docxSha256',payload->>'exporterVersion',actor) returning * into document_row;
  update public.studkab_request_process set active_document_id=document_row.id,status='quality_review',revision=revision+1,updated_at=clock_timestamp()
   where request_id=studkab_run_command.request_id and active_passport_id=document_row.passport_id returning * into process_row;
  if not found then raise exception 'passport_mismatch'; end if;
  result=jsonb_build_object('documentId',document_row.id,'version',document_row.version,'revision',process_row.revision);

 elsif command_name='record_checks' then
  select * into document_row from public.studkab_document_versions where id=(payload->>'documentId')::uuid and request_id=studkab_run_command.request_id;
  if not found then raise exception 'document_not_found'; end if;
  for item in select * from jsonb_array_elements(coalesce(payload->'checks','[]')) loop
   if not exists(select 1 from public.studkab_requirement_items where id=(item->>'requirementId')::uuid and passport_id=document_row.passport_id) then raise exception 'requirement_mismatch'; end if;
   insert into public.studkab_criterion_results(document_id,requirement_id,status,evaluator_type,evidence,comment,decided_by,checker_version)
   values((payload->>'documentId')::uuid,(item->>'requirementId')::uuid,item->>'status',item->>'evaluatorType',coalesce(item->'evidence','{}'),item->>'comment',actor,item->>'checkerVersion')
   on conflict(document_id,requirement_id,evaluator_type) do update set status=excluded.status,evidence=excluded.evidence,comment=excluded.comment,decided_by=excluded.decided_by,decided_at=clock_timestamp(),checker_version=excluded.checker_version;
  end loop;
  result=jsonb_build_object('documentId',payload->>'documentId','recorded',jsonb_array_length(coalesce(payload->'checks','[]')));

 elsif command_name='approve_document' then
  select * into process_row from public.studkab_request_process where request_id=studkab_run_command.request_id for update;
  if process_row.revision<>(payload->>'expectedRevision')::bigint or process_row.status<>'quality_review' then raise exception 'revision_conflict'; end if;
  select * into document_row from public.studkab_document_versions where id=(payload->>'documentId')::uuid and request_id=studkab_run_command.request_id for update;
  if not found or document_row.state<>'ready_for_review' or document_row.docx_file_id is null then raise exception 'document_not_ready'; end if;
  if not exists(select 1 from public.studkab_request_files where id=document_row.docx_file_id and request_id=studkab_run_command.request_id and purpose='result_docx' and state='accepted' and sha256=document_row.docx_sha256) then raise exception 'docx_not_verified'; end if;
  if exists(select 1 from public.studkab_requirement_items i where i.passport_id=document_row.passport_id and i.applicability='applicable' and i.severity='critical'
   and not exists(select 1 from public.studkab_criterion_results c where c.document_id=document_row.id and c.requirement_id=i.id and c.status in ('pass','not_applicable'))) then raise exception 'critical_checks_incomplete'; end if;
  update public.studkab_document_versions set state='approved',approved_by=actor,approved_at=clock_timestamp() where id=document_row.id returning * into document_row;
  update public.studkab_request_process set status='ready_to_deliver',revision=revision+1,updated_at=clock_timestamp() where request_id=studkab_run_command.request_id returning * into process_row;
  result=jsonb_build_object('documentId',document_row.id,'revision',process_row.revision);

 elsif command_name='deliver_document' then
  select * into process_row from public.studkab_request_process where request_id=studkab_run_command.request_id for update;
  if process_row.revision<>(payload->>'expectedRevision')::bigint or process_row.status<>'ready_to_deliver' then raise exception 'revision_conflict'; end if;
  update public.studkab_document_versions set state='delivered' where id=(payload->>'documentId')::uuid and request_id=studkab_run_command.request_id and state='approved' returning * into document_row;
  if not found then raise exception 'document_not_ready'; end if;
  update public.studkab_request_process set delivered_document_id=document_row.id,status='delivered',revision=revision+1,updated_at=clock_timestamp()
   where request_id=studkab_run_command.request_id and active_document_id=document_row.id returning * into process_row;
  result=jsonb_build_object('documentId',document_row.id,'sha256',document_row.docx_sha256,'revision',process_row.revision);

 elsif command_name='get_delivered_document' then
  if actor<>owner_id then raise exception 'not_owner'; end if;
  select d.* into document_row from public.studkab_request_process p join public.studkab_document_versions d on d.id=p.delivered_document_id where p.request_id=studkab_run_command.request_id and d.state='delivered';
  if not found then raise exception 'document_not_found'; end if;
  select * into file_row from public.studkab_request_files where id=document_row.docx_file_id and state='accepted';
  result=jsonb_build_object('documentId',document_row.id,'path',file_row.storage_path,'name',file_row.original_name,'sha256',document_row.docx_sha256);
 else raise exception 'unknown_command'; end if;

 insert into public.studkab_command_receipts(command_id,request_id,command_name,response) values(command_id,request_id,command_name,result);
 return result || jsonb_build_object('duplicate',false);
end $$;
revoke all on function private.studkab_run_command(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.studkab_run_command(uuid,text,uuid,uuid,jsonb) to service_role;

do $$ declare command_name text; begin
 foreach command_name in array array['prepare_upload','accept_upload','submit_passport','approve_passport','ask_clarification','answer_clarification','create_document_version','record_checks','approve_document','deliver_document','get_delivered_document'] loop
  execute format('create function public.studkab_%I(request uuid, command_id uuid, actor uuid, payload jsonb) returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $f$ select private.studkab_run_command(command_id,%L,request,actor,payload) $f$',command_name,command_name);
  execute format('revoke all on function public.studkab_%I(uuid,uuid,uuid,jsonb) from public,anon,authenticated',command_name);
  execute format('grant execute on function public.studkab_%I(uuid,uuid,uuid,jsonb) to service_role',command_name);
 end loop;
end $$;

create function public.studkab_initialize_request(request uuid, command_id uuid, actor uuid, payload jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare row public.studkab_request_process; receipt public.studkab_command_receipts; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(command_id::text,714));
 select * into receipt from public.studkab_command_receipts where studkab_command_receipts.command_id=studkab_initialize_request.command_id;
 if found then
  if receipt.request_id<>request or receipt.command_name<>'initialize_request' then raise exception 'command_conflict'; end if;
  return receipt.response || jsonb_build_object('duplicate',true);
 end if;
 select * into row from public.studkab_initialize_request(request,actor);
 result=to_jsonb(row);
 insert into public.studkab_command_receipts values(command_id,request,'initialize_request',result,clock_timestamp());
 return result || jsonb_build_object('duplicate',false);
end $$;
revoke all on function public.studkab_initialize_request(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_initialize_request(uuid,uuid,uuid,jsonb) to service_role;

create function public.studkab_transition_request(request uuid, command_id uuid, actor uuid, payload jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare row public.studkab_request_process; receipt public.studkab_command_receipts; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(command_id::text,714));
 select * into receipt from public.studkab_command_receipts where studkab_command_receipts.command_id=studkab_transition_request.command_id;
 if found then
  if receipt.request_id<>request or receipt.command_name<>'transition_request' then raise exception 'command_conflict'; end if;
  return receipt.response || jsonb_build_object('duplicate',true);
 end if;
 select * into row from public.studkab_transition_request(request,(payload->>'expectedRevision')::bigint,payload->>'nextStatus',actor,'executor',payload->>'reason',payload->>'relatedType',nullif(payload->>'relatedId','')::uuid);
 result=to_jsonb(row);
 insert into public.studkab_command_receipts values(command_id,request,'transition_request',result,clock_timestamp());
 return result || jsonb_build_object('duplicate',false);
end $$;
revoke all on function public.studkab_transition_request(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_transition_request(uuid,uuid,uuid,jsonb) to service_role;

commit;
