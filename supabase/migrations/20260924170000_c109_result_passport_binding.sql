-- C109: append-only passport cycles for one immutable Word version.
begin;
create table public.studkab_result_passport_bindings(
 id uuid primary key,
 version_id uuid not null references public.studkab_result_versions(id) on delete cascade,
 passport_id uuid not null references public.studkab_requirement_passports(id),
 source_fingerprint text not null check(source_fingerprint ~ '^[a-f0-9]{64}$'),
 document_fingerprint text not null check(document_fingerprint ~ '^[a-f0-9]{64}$'),
 actor_id uuid references auth.users(id),
 changed_items jsonb not null default '[]'::jsonb check(jsonb_typeof(changed_items)='array'),
 confirmation text not null default '',
 created_at timestamptz not null default clock_timestamp(),
 unique(version_id,passport_id,source_fingerprint)
);
create table public.studkab_result_review_bindings(
 review_id uuid primary key references public.studkab_result_reviews(id) on delete cascade,
 binding_id uuid not null references public.studkab_result_passport_bindings(id)
);
create table public.studkab_quality_evidence_bindings(
 evidence_id uuid primary key references public.studkab_quality_evidence(id) on delete cascade,
 binding_id uuid not null references public.studkab_result_passport_bindings(id)
);
create index studkab_review_binding_context on public.studkab_result_review_bindings(binding_id);
create index studkab_quality_binding_context on public.studkab_quality_evidence_bindings(binding_id);
alter table public.studkab_result_passport_bindings enable row level security;
alter table public.studkab_result_review_bindings enable row level security;
alter table public.studkab_quality_evidence_bindings enable row level security;
revoke all on public.studkab_result_passport_bindings,public.studkab_result_review_bindings,public.studkab_quality_evidence_bindings from public,anon,authenticated,service_role;
grant select on public.studkab_result_passport_bindings,public.studkab_result_review_bindings,public.studkab_quality_evidence_bindings to service_role;

-- Preserve every historical row. The embedded context remains a snapshot of its first cycle.
insert into public.studkab_result_passport_bindings(id,version_id,passport_id,source_fingerprint,document_fingerprint,actor_id)
select v.id,v.id,p.id,p.source_fingerprint,v.document#>>'{reviewContext,fingerprint}',p.created_by
from public.studkab_result_versions v join public.studkab_requirement_passports p
 on p.id::text=v.document#>>'{reviewContext,passportId}' and p.request_id=v.request_id
 and p.source_fingerprint=v.document#>>'{reviewContext,sourceFingerprint}'
where (v.document#>>'{reviewContext,fingerprint}') ~ '^[a-f0-9]{64}$';
insert into public.studkab_result_review_bindings(review_id,binding_id)
select r.id,b.id from public.studkab_result_reviews r join public.studkab_result_passport_bindings b on b.version_id=r.version_id;
insert into public.studkab_quality_evidence_bindings(evidence_id,binding_id)
select e.id,b.id from public.studkab_quality_evidence e join public.studkab_result_passport_bindings b
on b.version_id=e.version_id and b.passport_id=e.passport_id and b.source_fingerprint=e.source_fingerprint;

create function public.studkab_binding_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and exists(
  select 1 from public.studkab_requests r join public.studkab_requirement_passports p on p.request_id=r.id
  where p.id=old.passport_id and r.deleting_at is not null) then return old; end if;
 raise exception 'RESULT_BINDING_IMMUTABLE';
end $$;
create trigger result_binding_immutable before update or delete on public.studkab_result_passport_bindings for each row execute function public.studkab_binding_immutable();

create function public.studkab_current_result_binding(p_request uuid,p_version uuid) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare b uuid;
begin
 select x.id into b from public.studkab_result_passport_bindings x
 join public.studkab_result_versions v on v.id=x.version_id and v.request_id=p_request
 join public.studkab_requirement_passports p on p.id=x.passport_id and p.request_id=p_request
 where x.version_id=p_version and p.status='approved' and x.source_fingerprint=p.source_fingerprint
 and p.revision=(select max(revision) from public.studkab_requirement_passports where request_id=p_request)
 and v.id=(select id from public.studkab_result_versions where request_id=p_request order by revision desc limit 1);
 return b;
end $$;

-- New versions continue to carry the original reviewContext for old consumers.
create function public.studkab_initial_result_binding() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.studkab_result_passport_bindings(id,version_id,passport_id,source_fingerprint,document_fingerprint,actor_id)
 select new.id,new.id,p.id,p.source_fingerprint,new.document#>>'{reviewContext,fingerprint}',p.created_by
 from public.studkab_requirement_passports p where p.id::text=new.document#>>'{reviewContext,passportId}'
 and p.request_id=new.request_id and p.source_fingerprint=new.document#>>'{reviewContext,sourceFingerprint}'
 and (new.document#>>'{reviewContext,fingerprint}') ~ '^[a-f0-9]{64}$';
 if not found then raise exception 'RESULT_BINDING_REQUIRED'; end if;
 return new;
end $$;
create trigger result_initial_binding after insert on public.studkab_result_versions for each row execute function public.studkab_initial_result_binding();

-- Explicit executor action; request lock is shared with passport approval and review RPCs.
create function public.studkab_rebind_result_passport(p_request uuid,p_version uuid,p_actor uuid,p_document jsonb,p_changed_items jsonb,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.studkab_result_versions; p public.studkab_requirement_passports; old_p public.studkab_requirement_passports;
 previous public.studkab_result_passport_bindings; existing public.studkab_result_passport_bindings; ids jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 if not exists(select 1 from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) where u.id=p_actor)
 then raise exception 'FORBIDDEN'; end if;
 if public.studkab_material_manifest_check(p_request)->>'valid' is distinct from 'true' then raise exception 'MATERIAL_MANIFEST_REQUIRED'; end if;
 select * into v from public.studkab_result_versions where request_id=p_request order by revision desc limit 1;
 select * into p from public.studkab_requirement_passports where request_id=p_request order by revision desc limit 1;
 if v.id is distinct from p_version or p.status is distinct from 'approved'
 or v.recipient_id is distinct from (select student_id from public.studkab_requests where id=p_request and deleting_at is null)
 or p_document-'reviewContext' is distinct from v.document-'reviewContext'
 or p_document#>>'{reviewContext,passportId}' is distinct from p.id::text
 or p_document#>>'{reviewContext,sourceFingerprint}' is distinct from p.source_fingerprint
 or coalesce(p_document#>>'{reviewContext,fingerprint}','') !~ '^[a-f0-9]{64}$'
 then raise exception 'RESULT_BINDING_STALE'; end if;
 select * into previous from public.studkab_result_passport_bindings where version_id=p_version order by created_at desc,id desc limit 1;
 if previous.id is null then raise exception 'RESULT_BINDING_STALE'; end if;
 select * into existing from public.studkab_result_passport_bindings where version_id=p_version and passport_id=p.id;
 if found then
  if existing.document_fingerprint is distinct from p_document#>>'{reviewContext,fingerprint}' then raise exception 'RESULT_BINDING_CONFLICT'; end if;
  return jsonb_build_object('bindingId',existing.id,'versionId',v.id,'fileHash',v.file_hash,'documentHash',v.document_hash,'duplicate',true);
 end if;
 select * into old_p from public.studkab_requirement_passports where id=previous.passport_id;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into ids from (
  select coalesce(n.item->>'id',o.item->>'id') id from
  (select value item from jsonb_array_elements(coalesce(p.items,'[]'::jsonb))) n
  full join (select value item from jsonb_array_elements(coalesce(old_p.items,'[]'::jsonb))) o
  on n.item->>'id'=o.item->>'id' where n.item is distinct from o.item
 ) changes;
 if p_changed_items is distinct from ids or length(trim(coalesce(p_confirmation,''))) not between 20 and 2000
 then raise exception 'RESULT_BINDING_CONFIRMATION_REQUIRED'; end if;
 insert into public.studkab_result_passport_bindings(id,version_id,passport_id,source_fingerprint,document_fingerprint,actor_id,changed_items,confirmation)
 values(gen_random_uuid(),v.id,p.id,p.source_fingerprint,p_document#>>'{reviewContext,fingerprint}',p_actor,ids,p_confirmation)
 returning * into existing;
 return jsonb_build_object('bindingId',existing.id,'versionId',v.id,'fileHash',v.file_hash,'documentHash',v.document_hash,'duplicate',false);
end $$;

-- Immutable associations are appended alongside their review/evidence rows.
create function public.studkab_bind_new_review() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid; current_id uuid;
begin
 select request_id into rid from public.studkab_result_versions where id=new.version_id;
 current_id:=public.studkab_current_result_binding(rid,new.version_id);
 if current_id is null then raise exception 'RESULT_BINDING_STALE'; end if;
 insert into public.studkab_result_review_bindings values(new.id,current_id);
 return new;
end $$;
create trigger bind_result_review after insert on public.studkab_result_reviews for each row execute function public.studkab_bind_new_review();
create function public.studkab_bind_new_evidence() returns trigger language plpgsql security definer set search_path='' as $$
declare current_id uuid;
begin
 current_id:=public.studkab_current_result_binding(new.request_id,new.version_id);
 if current_id is null then raise exception 'RESULT_BINDING_STALE'; end if;
 insert into public.studkab_quality_evidence_bindings values(new.id,current_id);
 return new;
end $$;
create trigger bind_quality_evidence after insert on public.studkab_quality_evidence for each row execute function public.studkab_bind_new_evidence();

create or replace function public.studkab_result_context_version() returns integer
language sql stable security invoker set search_path=pg_catalog as $$ select 2 $$;

revoke all on function public.studkab_current_result_binding(uuid,uuid),public.studkab_rebind_result_passport(uuid,uuid,uuid,jsonb,jsonb,text),public.studkab_binding_immutable(),public.studkab_initial_result_binding(),public.studkab_bind_new_review(),public.studkab_bind_new_evidence() from public,anon,authenticated;
grant execute on function public.studkab_current_result_binding(uuid,uuid),public.studkab_rebind_result_passport(uuid,uuid,uuid,jsonb,jsonb,text),public.studkab_binding_immutable(),public.studkab_initial_result_binding(),public.studkab_bind_new_review(),public.studkab_bind_new_evidence() to service_role;

-- Guards and RPCs are replaced atomically after backfill.
create or replace function public.studkab_manifest_output_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare rid uuid; verdict jsonb; p public.studkab_requirement_passports; context jsonb;
begin
 if tg_table_name='studkab_result_reviews' then
  if public.studkab_valid_review_notes(new.criteria) then return new; end if;
  select request_id into rid from public.studkab_result_versions where id=new.version_id;
 else rid:=new.request_id::uuid; end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,713));
 verdict:=public.studkab_material_manifest_check(rid);
 if verdict ? 'code' then raise exception '%',verdict->>'code'; end if;
 select * into p from public.studkab_requirement_passports where request_id=rid order by revision desc limit 1;
 if tg_table_name='studkab_gen_jobs' then
  if new.passport_id is distinct from p.id then raise exception 'PASSPORT_REQUIRED'; end if;
 else
  if tg_table_name='studkab_result_versions' then context:=new.document->'reviewContext';
  else select jsonb_build_object('passportId',b.passport_id,'sourceFingerprint',b.source_fingerprint) into context from public.studkab_result_passport_bindings b where b.id=public.studkab_current_result_binding(rid,new.version_id); end if;
  if context is null or context->>'passportId' is distinct from p.id::text or context->>'sourceFingerprint' is distinct from p.source_fingerprint
  then raise exception 'Review passport changed'; end if;
 end if;
 return new;
end $$;

create or replace function public.studkab_quality_context(p_request uuid,p_version uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare v public.studkab_result_versions; p public.studkab_requirement_passports; owner_id uuid; requirement jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 select student_id into owner_id from public.studkab_requests where id=p_request and deleting_at is null for share;
 if owner_id is null then raise exception 'QUALITY_STALE'; end if;
 if public.studkab_material_manifest_check(p_request)->>'valid' is distinct from 'true' then raise exception 'QUALITY_PASSPORT'; end if;
 select * into v from public.studkab_result_versions where request_id=p_request order by revision desc limit 1;
 select * into p from public.studkab_requirement_passports where request_id=p_request order by revision desc limit 1;
 if v.id is distinct from p_version or v.recipient_id is distinct from owner_id or p.status is distinct from 'approved'
 or public.studkab_current_result_binding(p_request,p_version) is null then raise exception 'QUALITY_STALE'; end if;
 select j into requirement from jsonb_array_elements(p.items) j where j->>'id'='ANTIPLAGIARISM';
 requirement:=public.studkab_originality_rule(requirement);
 return jsonb_build_object('versionId',v.id,'recipientId',owner_id,'passportId',p.id,'fileHash',v.file_hash,'documentHash',v.document_hash,'sourceFingerprint',p.source_fingerprint,'thresholdRequirement',requirement);
end $$;

create or replace function public.studkab_quality_check(p_request uuid,p_version uuid) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare c jsonb; e public.studkab_quality_evidence; k text; ids jsonb:='{}'; missing jsonb:='[]';
begin
 c:=public.studkab_quality_context(p_request,p_version);
 foreach k in array array['internal_borrowing','external_originality'] loop
  select * into e from public.studkab_quality_evidence e1 join public.studkab_quality_evidence_bindings eb on eb.evidence_id=e1.id where e1.version_id=p_version and e1.kind=k and eb.binding_id=public.studkab_current_result_binding(p_request,p_version) order by e1.sequence desc limit 1;
  if e.id is null or e.payload->>'disposition' is distinct from 'pass' or e.passport_id::text is distinct from c->>'passportId' then missing:=missing||jsonb_build_array(k); else ids:=ids||jsonb_build_object(k,e.id); end if;
 end loop;
 return jsonb_build_object('eligible',jsonb_array_length(missing)=0,'blockingCodes',missing,'evidenceIds',ids,'bindings',c);
end $$;

create or replace function public.studkab_quality_output_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare rid uuid; verdict jsonb; linked jsonb;
begin
 if tg_table_name='studkab_result_reviews' then
  if public.studkab_valid_review_notes(new.criteria) then return new; end if;
 end if;
 select request_id into rid from public.studkab_result_versions where id=new.version_id;
 verdict:=public.studkab_quality_check(rid,new.version_id);
 if verdict->>'eligible' is distinct from 'true' then raise exception 'QUALITY_EVIDENCE_REQUIRED'; end if;
 if tg_table_name='studkab_result_reviews' then new.quality_evidence_ids:=verdict->'evidenceIds';
 else
  select r.quality_evidence_ids into linked from public.studkab_result_reviews r join public.studkab_result_review_bindings rb on rb.review_id=r.id where r.id=new.review_id and r.version_id=new.version_id and rb.binding_id=public.studkab_current_result_binding(rid,new.version_id);
  if linked is distinct from verdict->'evidenceIds' then raise exception 'QUALITY_REVIEW_STALE'; end if;
 end if;
 return new;
end $$;

create or replace function public.review_studkab_result(request uuid,version uuid,review uuid,reviewer uuid,recipient uuid,file_hash text,document_hash text,criteria jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 if public.studkab_quality_check(request,version)->>'eligible' is distinct from 'true' then raise exception 'QUALITY_EVIDENCE_REQUIRED'; end if;
 if public.studkab_material_manifest_check(request) ? 'code' then raise exception 'MATERIAL_MANIFEST_REQUIRED'; end if;
 if public.studkab_current_result_binding(request,version) is null then raise exception 'Review passport changed'; end if;
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where request_id=request order by revision desc limit 1;
 if v.id is null or v.id<>version or v.recipient_id is distinct from actual or actual is distinct from recipient or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
 if not public.studkab_valid_review(criteria) then return jsonb_build_object('error','criteria'); end if;
 select * into r from public.studkab_result_reviews where id=review;
 if found then
  if r.quality_evidence_ids is distinct from public.studkab_quality_check(request,version)->'evidenceIds' then raise exception 'QUALITY_REVIEW_STALE'; end if;
  if r.version_id<>version or r.reviewer_id<>reviewer or r.criteria<>criteria or not exists(select 1 from public.studkab_result_review_bindings rb where rb.review_id=r.id and rb.binding_id=public.studkab_current_result_binding(request,version)) then return jsonb_build_object('error','conflict'); end if;
 else
  insert into public.studkab_result_reviews(id,version_id,reviewer_id,criteria) values(review,version,reviewer,criteria) returning * into r;
 end if;
 return jsonb_build_object('reviewId',r.id,'versionId',r.version_id,'reviewedAt',r.created_at);
end $$;

create or replace function public.deliver_reviewed_studkab_result(request uuid,delivery uuid,version uuid,review uuid,recipient uuid,file_hash text,document_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews; old public.studkab_results; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 if public.studkab_quality_check(request,version)->>'eligible' is distinct from 'true' then raise exception 'QUALITY_EVIDENCE_REQUIRED'; end if;
 if public.studkab_material_manifest_check(request) ? 'code' then raise exception 'MATERIAL_MANIFEST_REQUIRED'; end if;
 if public.studkab_current_result_binding(request,version) is null then raise exception 'Review passport changed'; end if;
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where id=version and request_id=request;
 if v.id is null or actual is distinct from recipient or v.recipient_id is distinct from actual or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
 if (select quality_evidence_ids from public.studkab_result_reviews where id=review and version_id=version) is distinct from public.studkab_quality_check(request,version)->'evidenceIds' then raise exception 'QUALITY_REVIEW_STALE'; end if;
 if not exists(select 1 from public.studkab_result_review_bindings rb where rb.review_id=review and rb.binding_id=public.studkab_current_result_binding(request,version)) then return jsonb_build_object('error','review_required'); end if;
 select * into old from public.studkab_results where request_id=request and delivery_id=delivery;
 if found then
  if old.version_id is distinct from version or old.review_id is distinct from review then return jsonb_build_object('error','conflict'); end if;
  return jsonb_build_object('deliveryId',old.delivery_id,'createdAt',old.created_at,'duplicate',true);
 end if;
 if version is distinct from (select id from public.studkab_result_versions where request_id=request order by revision desc limit 1) then return jsonb_build_object('error','stale'); end if;
 select * into r from public.studkab_result_reviews where id=review and version_id=version;
 if r.id is null or not public.studkab_valid_review(r.criteria) or not exists(select 1 from public.studkab_result_review_bindings rb where rb.review_id=r.id and rb.binding_id=public.studkab_current_result_binding(request,version)) then return jsonb_build_object('error','review_required'); end if;
 insert into public.studkab_results(request_id,delivery_id,document,version_id,review_id) values(request,delivery,v.document,version,review) returning * into old;
 return jsonb_build_object('deliveryId',old.delivery_id,'createdAt',old.created_at,'duplicate',false);
end $$;

create or replace function public.record_studkab_review_notes(request uuid,version uuid,review uuid,reviewer uuid,recipient uuid,file_hash text,document_hash text,criteria jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where request_id=request order by revision desc limit 1;
 if v.id is null or v.id<>version or v.recipient_id is distinct from actual or actual is distinct from recipient or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
 if exists(select 1 from public.studkab_results d join public.studkab_result_review_bindings rb on rb.review_id=d.review_id where d.version_id=version and rb.binding_id=public.studkab_current_result_binding(request,version)) then return jsonb_build_object('error','stale'); end if;
 if public.studkab_current_result_binding(request,version) is null then return jsonb_build_object('error','stale'); end if;
 if not public.studkab_valid_review_notes(criteria) then return jsonb_build_object('error','criteria'); end if;
 select * into r from public.studkab_result_reviews where id=review;
 if found then
  if r.version_id<>version or r.reviewer_id<>reviewer or r.criteria<>criteria or not exists(select 1 from public.studkab_result_review_bindings rb where rb.review_id=r.id and rb.binding_id=public.studkab_current_result_binding(request,version)) then return jsonb_build_object('error','conflict'); end if;
 else
  insert into public.studkab_result_reviews(id,version_id,reviewer_id,criteria) values(review,version,reviewer,criteria) returning * into r;
 end if;
 return jsonb_build_object('reviewId',r.id,'versionId',r.version_id,'reviewedAt',r.created_at);
end $$;

create or replace function public.studkab_guard_result_delivery()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews;
 p public.studkab_requirement_passports; actual uuid; context jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,713));
 select student_id into actual from public.studkab_requests where id=new.request_id for share;
 select * into v from public.studkab_result_versions where request_id=new.request_id order by revision desc limit 1;
 select * into r from public.studkab_result_reviews where id=new.review_id;
 if v.id is null or new.version_id is distinct from v.id or r.version_id is distinct from v.id or v.recipient_id is distinct from actual or new.document is distinct from v.document or not public.studkab_valid_review(r.criteria) then raise exception 'Versioned review required'; end if;
 if public.studkab_current_result_binding(new.request_id,new.version_id) is null or not exists(select 1 from public.studkab_result_review_bindings rb where rb.review_id=new.review_id and rb.binding_id=public.studkab_current_result_binding(new.request_id,new.version_id)) then raise exception 'Review passport changed'; end if;
 return new;
end $$;

create or replace function public.studkab_guard_latest_review() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,713));
 if new.review_id is distinct from (select id from public.studkab_result_reviews where version_id=new.version_id order by created_at desc,id desc limit 1) then raise exception 'Latest version review required'; end if;
 if not exists(select 1 from public.studkab_result_review_bindings rb where rb.review_id=new.review_id and rb.binding_id=public.studkab_current_result_binding(new.request_id,new.version_id)) then raise exception 'Latest version review required'; end if;
 return new;
end $$;

create or replace function public.studkab_test_delivery_context(p_request uuid,p_actor uuid,p_executor_only boolean default true)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r public.studkab_requests; g public.studkab_test_request_grants; v public.studkab_result_versions; p public.studkab_requirement_passports; executor boolean;
begin
 if p_actor is null or p_request is null then return jsonb_build_object('eligible',false,'reason','FORBIDDEN'); end if;
 executor:=exists(select 1 from auth.users u join public.studkab_request_config c on lower(c.executor_email)=lower(u.email) where u.id=p_actor);
 if p_executor_only and not executor then return jsonb_build_object('eligible',false,'reason','FORBIDDEN'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 select * into r from public.studkab_requests where id=p_request and deleting_at is null for share;
 if r.id is null or (not executor and (r.student_id<>p_actor or not exists(select 1 from public.studkab_members where user_id=p_actor)))
 then return jsonb_build_object('eligible',false,'reason','FORBIDDEN'); end if;
 perform 1 from public.studkab_members where user_id=r.student_id for share;
 if not found then return jsonb_build_object('eligible',false,'reason','TEST_ACCESS_UNAVAILABLE'); end if;
 select * into g from public.studkab_test_request_grants where request_id=p_request for share;
 if g.request_id is null or g.revoked_at is not null or g.recipient_id<>r.student_id then return jsonb_build_object('eligible',false,'reason','TEST_NOT_ALLOWED'); end if;
 if exists(select 1 from public.studkab_material_revisions where request_id=p_request and closed_at is null)
 then return jsonb_build_object('eligible',false,'reason','MATERIAL_REVISION_OPEN'); end if;
 if public.studkab_material_manifest_check(p_request)->>'valid' is distinct from 'true' then return jsonb_build_object('eligible',false,'reason','MATERIAL_MANIFEST_REQUIRED'); end if;
 select * into p from public.studkab_requirement_passports where request_id=p_request order by revision desc limit 1;
 select * into v from public.studkab_result_versions where request_id=p_request order by revision desc limit 1;
 if p.status is distinct from 'approved' or v.id is null or v.recipient_id<>r.student_id or public.studkab_current_result_binding(p_request,v.id) is null
 then return jsonb_build_object('eligible',false,'reason','TEST_VERSION_CHANGED'); end if;
 return jsonb_build_object('eligible',true,'reason','','versionId',v.id,'recipientId',r.student_id,'fileHash',v.file_hash,
 'documentHash',v.document_hash,'passportId',p.id,'sourceFingerprint',p.source_fingerprint);
end $$;
commit;
