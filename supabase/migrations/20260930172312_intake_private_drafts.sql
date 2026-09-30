-- INTAKE-01 / R15: originals are saved before analysis or request creation.
create table public.studkab_intake_drafts (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references auth.users(id),
 state text not null default 'open' check (state in ('open','submitted')),
 notes text not null default '' check (length(notes)<=5000),
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index studkab_intake_one_open on public.studkab_intake_drafts(student_id) where state='open';
create table public.studkab_intake_files (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.studkab_intake_drafts(id),
 file_name text not null check(length(file_name) between 1 and 180),
 content_type text not null check(content_type in ('application/pdf',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
 size_bytes integer not null check(size_bytes between 1 and 5242880),
 file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
 storage_path text not null unique,
 supersedes uuid references public.studkab_intake_files(id),
 state text not null default 'pending' check(state in ('pending','saved')),
 roles text[] not null default '{}',
 created_at timestamptz not null default now(), saved_at timestamptz,
 unique(draft_id,file_hash), check ((state='saved')=(saved_at is not null))
);
create unique index studkab_intake_one_successor on public.studkab_intake_files(supersedes) where supersedes is not null;
create index studkab_intake_files_draft on public.studkab_intake_files(draft_id);
create function public.studkab_intake_file_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if row(new.id,new.draft_id,new.file_name,new.content_type,new.size_bytes,new.file_hash,new.storage_path,new.supersedes,new.created_at)
 is distinct from row(old.id,old.draft_id,old.file_name,old.content_type,old.size_bytes,old.file_hash,old.storage_path,old.supersedes,old.created_at)
 or (old.state='saved' and row(new.state,new.saved_at) is distinct from row(old.state,old.saved_at)) then
  raise exception 'INTAKE_IMMUTABLE_FILE';
 end if;
 return new;
end $$;
revoke all on function public.studkab_intake_file_guard() from public,anon,authenticated;
create trigger studkab_intake_file_guard before update on public.studkab_intake_files for each row execute function public.studkab_intake_file_guard();
alter table public.studkab_intake_drafts enable row level security;
alter table public.studkab_intake_files enable row level security;
revoke all on public.studkab_intake_drafts,public.studkab_intake_files from public,anon,authenticated;
grant select,insert,update on public.studkab_intake_drafts,public.studkab_intake_files to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('studkab-intake-materials','studkab-intake-materials',false,5242880,array[
'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy studkab_intake_no_browser_objects on storage.objects as restrictive
 for all to anon,authenticated using(bucket_id<>'studkab-intake-materials')
 with check(bucket_id<>'studkab-intake-materials');
-- No browser role has object policies for this bucket. All access goes through
-- the authenticated Edge handler and ownership checks, including signed download.

create function public.studkab_intake_open(p_student uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare d public.studkab_intake_drafts;
begin
 if not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('denied',true); end if;
 perform pg_advisory_xact_lock(hashtextextended('intake:'||p_student::text,0));
 select * into d from public.studkab_intake_drafts where student_id=p_student and state='open';
 if not found then insert into public.studkab_intake_drafts(student_id) values(p_student) returning * into d; end if;
 return to_jsonb(d);
end $$;

create function public.studkab_intake_notes(p_student uuid,p_draft uuid,p_revision integer,p_notes text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare d public.studkab_intake_drafts;
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open' for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 if p_notes is null or length(p_notes)>5000 then return jsonb_build_object('invalid',true); end if;
 if d.revision<>p_revision then return jsonb_build_object('conflict',true); end if;
 update public.studkab_intake_drafts set notes=p_notes,revision=revision+1,updated_at=now() where id=p_draft returning * into d;
 return to_jsonb(d);
end $$;

create function public.studkab_intake_reserve(p_student uuid,p_draft uuid,p_name text,p_type text,p_size integer,p_hash text,p_supersedes uuid default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare d public.studkab_intake_drafts; f public.studkab_intake_files; predecessor public.studkab_intake_files; fid uuid;
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open' for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select * into f from public.studkab_intake_files where draft_id=p_draft and file_hash=p_hash;
 if found then
  if f.content_type<>p_type or f.size_bytes<>p_size or (p_supersedes is not null and f.supersedes is distinct from p_supersedes) then return jsonb_build_object('conflict',true); end if;
  return jsonb_build_object('file',to_jsonb(f),'duplicate',f.state='saved');
 end if;
 if (select coalesce(sum(size_bytes),0) from public.studkab_intake_files where draft_id=p_draft)+p_size>104857600 then
  return jsonb_build_object('quota',true);
 end if;
 if p_supersedes is not null then
  select * into predecessor from public.studkab_intake_files where id=p_supersedes and draft_id=p_draft and state='saved';
  if not found or exists(select 1 from public.studkab_intake_files where supersedes=p_supersedes) then return jsonb_build_object('conflict',true); end if;
 else
  if (select count(*) from public.studkab_intake_files where draft_id=p_draft and supersedes is null)>=8 then
   return jsonb_build_object('limited',true);
  end if;
 end if;
 fid=gen_random_uuid();
 insert into public.studkab_intake_files(id,draft_id,file_name,content_type,size_bytes,file_hash,storage_path,supersedes)
 values(fid,p_draft,p_name,p_type,p_size,p_hash,p_student::text||'/'||p_draft::text||'/'||fid::text,p_supersedes) returning * into f;
 update public.studkab_intake_drafts set revision=revision+1,updated_at=now() where id=p_draft;
 return jsonb_build_object('file',to_jsonb(f),'duplicate',false);
end $$;

create function public.studkab_intake_finish(p_student uuid,p_draft uuid,p_file uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare d public.studkab_intake_drafts; f public.studkab_intake_files;
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open' for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select * into f from public.studkab_intake_files where id=p_file and draft_id=p_draft and file_hash=p_hash;
 if not found then return jsonb_build_object('missing',true); end if;
 if f.state='saved' then return jsonb_build_object('file',to_jsonb(f),'duplicate',true); end if;
 update public.studkab_intake_files set state='saved',saved_at=now() where id=p_file returning * into f;
 update public.studkab_intake_drafts set revision=revision+1,updated_at=now() where id=p_draft;
 return jsonb_build_object('file',to_jsonb(f),'duplicate',false);
end $$;

revoke all on function public.studkab_intake_open(uuid),public.studkab_intake_notes(uuid,uuid,integer,text),
 public.studkab_intake_reserve(uuid,uuid,text,text,integer,text,uuid),public.studkab_intake_finish(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studkab_intake_open(uuid),public.studkab_intake_notes(uuid,uuid,integer,text),
 public.studkab_intake_reserve(uuid,uuid,text,text,integer,text,uuid),public.studkab_intake_finish(uuid,uuid,uuid,text) to service_role;
