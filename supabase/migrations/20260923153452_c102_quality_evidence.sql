-- C102: immutable, version-bound evidence; no provider integration or automatic originality claim.
create table public.studkab_quality_evidence(
 id uuid primary key, request_id uuid not null references public.studkab_requests(id),
 version_id uuid not null references public.studkab_result_versions(id) on delete cascade,
 passport_id uuid not null references public.studkab_requirement_passports(id), recipient_id uuid not null,
 file_hash text not null, document_hash text not null, source_fingerprint text not null,
 kind text not null check(kind in ('internal_borrowing','external_originality')),
 payload jsonb not null, report_base64 text, report_hash text,
 actor_id uuid not null, created_at timestamptz not null default clock_timestamp(),
 sequence bigint generated always as identity unique
);
create index quality_evidence_version_kind on public.studkab_quality_evidence(version_id,kind,sequence desc);
create index quality_evidence_request on public.studkab_quality_evidence(request_id);
create index quality_evidence_passport on public.studkab_quality_evidence(passport_id);
alter table public.studkab_quality_evidence enable row level security;
revoke all on public.studkab_quality_evidence from public,anon,authenticated,service_role;
grant select,insert on public.studkab_quality_evidence to service_role;
revoke all on sequence public.studkab_quality_evidence_sequence_seq from public,anon,authenticated,service_role;
grant usage,select on sequence public.studkab_quality_evidence_sequence_seq to service_role;
alter table public.studkab_result_reviews add column quality_evidence_ids jsonb;

create function public.studkab_quality_context(p_request uuid,p_version uuid) returns jsonb
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
 or v.document#>>'{reviewContext,passportId}' is distinct from p.id::text
 or v.document#>>'{reviewContext,sourceFingerprint}' is distinct from p.source_fingerprint then raise exception 'QUALITY_STALE'; end if;
 select j into requirement from jsonb_array_elements(p.items) j where j->>'id'='ANTIPLAGIARISM';
 return jsonb_build_object('versionId',v.id,'recipientId',owner_id,'passportId',p.id,'fileHash',v.file_hash,'documentHash',v.document_hash,'sourceFingerprint',p.source_fingerprint,'thresholdRequirement',jsonb_build_object('itemId','ANTIPLAGIARISM','text',requirement->>'text'));
end $$;

create function public.studkab_quality_insert_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare c jsonb; x jsonb; f jsonb; bytes bytea; ids text[]; source_count integer;
begin
 c:=public.studkab_quality_context(new.request_id,new.version_id);
 if new.actor_id is null or not exists(select 1 from auth.users u join public.studkab_request_config cfg on lower(u.email)=lower(cfg.executor_email) where u.id=new.actor_id) then raise exception 'QUALITY_FORBIDDEN'; end if;
 if new.recipient_id::text is distinct from c->>'recipientId' or new.passport_id::text is distinct from c->>'passportId'
 or new.file_hash is distinct from c->>'fileHash' or new.document_hash is distinct from c->>'documentHash' or new.source_fingerprint is distinct from c->>'sourceFingerprint' then raise exception 'QUALITY_STALE'; end if;
 x:=new.payload;
 if jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'disposition','') not in ('pass','fail','manual') or length(trim(coalesce(x->>'notes',''))) not between 10 and 4000 then raise exception 'QUALITY_INVALID'; end if;
 if new.kind='external_originality' then
  if length(trim(coalesce(x->>'service',''))) not between 1 and 200 or length(trim(coalesce(x->>'checkId',''))) not between 1 and 300
  or x->>'thresholdItemId' is distinct from 'ANTIPLAGIARISM' or x->>'thresholdBasis' is distinct from c#>>'{thresholdRequirement,text}'
  or length(trim(coalesce(x->>'thresholdBasis','')))=0 or x->'requirementConfirmed' is distinct from 'true'::jsonb or x->'wordBindingConfirmed' is distinct from 'true'::jsonb
  or jsonb_typeof(x->'thresholdPercent') is distinct from 'number' or jsonb_typeof(x->'actualPercent') is distinct from 'number'
  then raise exception 'QUALITY_REPORT_INVALID'; end if;
  if (x->>'thresholdPercent')::numeric not between 0 and 100 or (x->>'actualPercent')::numeric not between 0 and 100
   or (x->>'checkedAt') is null or (x->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' then raise exception 'QUALITY_REPORT_INVALID'; end if;
  if new.report_base64 is null or length(new.report_base64)>6990508 or new.report_base64!~'^[A-Za-z0-9+/]*={0,2}$' then raise exception 'QUALITY_REPORT_INVALID'; end if;
  bytes:=decode(new.report_base64,'base64');
  if octet_length(bytes)<5 or octet_length(bytes)>5242880 or convert_from(substring(bytes from 1 for 9),'UTF8')!~E'^%PDF-(1\\.[0-7]|2\\.0)[\r\n]' or encode(substring(bytes from greatest(1,octet_length(bytes)-1023)),'escape')!~'%%EOF[[:space:]]*$' then raise exception 'QUALITY_REPORT_INVALID'; end if;
  new.report_hash:=encode(sha256(bytes),'hex');
  if x->>'disposition'='pass' and (x->>'actualPercent')::numeric<(x->>'thresholdPercent')::numeric then raise exception 'QUALITY_BELOW_THRESHOLD'; end if;
 else
  if new.report_base64 is not null or new.report_hash is not null or jsonb_typeof(x->'scan') is distinct from 'object'
  or x#>>'{scan,fileHash}' is distinct from new.file_hash or coalesce(x->>'scanHash','')!~'^[a-f0-9]{64}$'
  then raise exception 'QUALITY_SCAN_INVALID'; end if;
  -- Trusted Edge computes the bounded scan from stored DOCX bytes. Database rechecks corpus identity.
  if jsonb_typeof(x->'sourceBindings') is distinct from 'array' then raise exception 'QUALITY_SCAN_INVALID'; end if;
  select count(*) into source_count from public.studkab_request_attachments a where a.request_id=new.request_id and a.category='sources' and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id);
  if jsonb_array_length(x->'sourceBindings')<>source_count then raise exception 'QUALITY_SCAN_STALE'; end if;
  ids:=array[]::text[];
  for f in select value from jsonb_array_elements(x->'sourceBindings') loop
   if f->>'id'=any(ids) or not exists(select 1 from public.studkab_request_attachments a where a.id::text=f->>'id' and a.request_id=new.request_id and a.category='sources' and a.file_hash=f->>'fileHash' and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) then raise exception 'QUALITY_SCAN_STALE'; end if;
   ids:=array_append(ids,f->>'id');
  end loop;
  if x->>'disposition'='pass' then
   if source_count=0 or exists(select 1 from public.studkab_request_attachments a where a.request_id=new.request_id and a.category='sources' and length(trim(coalesce(a.extracted_text,'')))=0 and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) or x->'scanComplete' is distinct from 'true'::jsonb or jsonb_typeof(x->'findingDecisions') is distinct from 'array' or jsonb_typeof(x->'findingIds') is distinct from 'array'
   or jsonb_array_length(x->'findingIds')<>jsonb_array_length(x->'findingDecisions') then raise exception 'QUALITY_SCAN_INCOMPLETE'; end if;
   ids:=array[]::text[];
   for f in select value from jsonb_array_elements(x->'findingDecisions') loop
    if coalesce(f->>'findingId','')='' or f->>'findingId'=any(ids) or not (x->'findingIds' ? (f->>'findingId')) or f->>'disposition' is distinct from 'explained' or length(trim(coalesce(f->>'notes',''))) not between 10 and 2000 then raise exception 'QUALITY_FINDING_UNREVIEWED'; end if;
    ids:=array_append(ids,f->>'findingId');
   end loop;
  end if;
 end if;
 return new;
end $$;
create trigger quality_insert_guard before insert on public.studkab_quality_evidence for each row execute function public.studkab_quality_insert_guard();
create function public.studkab_quality_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and current_user='postgres' and exists(select 1 from public.studkab_requests where id=old.request_id and deleting_at is not null) then return old; end if;
 raise exception 'QUALITY_IMMUTABLE';
end $$;
create trigger quality_immutable before update or delete on public.studkab_quality_evidence for each row execute function public.studkab_quality_immutable();

create function public.studkab_quality_check(p_request uuid,p_version uuid) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare c jsonb; e public.studkab_quality_evidence; k text; ids jsonb:='{}'; missing jsonb:='[]';
begin
 c:=public.studkab_quality_context(p_request,p_version);
 foreach k in array array['internal_borrowing','external_originality'] loop
  select * into e from public.studkab_quality_evidence where version_id=p_version and kind=k order by sequence desc limit 1;
  if e.id is null or e.payload->>'disposition' is distinct from 'pass' or e.passport_id::text is distinct from c->>'passportId' then missing:=missing||jsonb_build_array(k); else ids:=ids||jsonb_build_object(k,e.id); end if;
 end loop;
 return jsonb_build_object('eligible',jsonb_array_length(missing)=0,'blockingCodes',missing,'evidenceIds',ids,'bindings',c);
end $$;
create function public.studkab_quality_output_guard() returns trigger language plpgsql security invoker set search_path='' as $$
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
  select quality_evidence_ids into linked from public.studkab_result_reviews where id=new.review_id and version_id=new.version_id;
  if linked is distinct from verdict->'evidenceIds' then raise exception 'QUALITY_REVIEW_STALE'; end if;
 end if;
 return new;
end $$;
create trigger quality_review_guard before insert on public.studkab_result_reviews for each row execute function public.studkab_quality_output_guard();
create trigger quality_delivery_guard before insert on public.studkab_results for each row execute function public.studkab_quality_output_guard();

create function public.studkab_quality_save(p_request uuid,p_version uuid,p_id uuid,p_actor uuid,p_recipient uuid,p_passport uuid,p_file_hash text,p_document_hash text,p_source_fingerprint text,p_kind text,p_payload jsonb,p_report_base64 text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.studkab_quality_evidence;
begin
 perform public.studkab_quality_context(p_request,p_version);
 if p_actor is null or not exists(select 1 from auth.users u join public.studkab_request_config cfg on lower(u.email)=lower(cfg.executor_email) where u.id=p_actor) then raise exception 'QUALITY_FORBIDDEN'; end if;
 select * into e from public.studkab_quality_evidence where id=p_id;
 if found then
  if e.request_id is distinct from p_request or e.version_id is distinct from p_version or e.actor_id is distinct from p_actor or e.recipient_id is distinct from p_recipient or e.passport_id is distinct from p_passport or e.file_hash is distinct from p_file_hash or e.document_hash is distinct from p_document_hash or e.source_fingerprint is distinct from p_source_fingerprint or e.kind is distinct from p_kind or e.payload is distinct from p_payload or e.report_base64 is distinct from p_report_base64 then raise exception 'QUALITY_CONFLICT'; end if;
 else
  insert into public.studkab_quality_evidence(id,request_id,version_id,actor_id,recipient_id,passport_id,file_hash,document_hash,source_fingerprint,kind,payload,report_base64)
  values(p_id,p_request,p_version,p_actor,p_recipient,p_passport,p_file_hash,p_document_hash,p_source_fingerprint,p_kind,p_payload,p_report_base64) returning * into e;
 end if;
 return to_jsonb(e)-'report_base64';
end $$;
revoke all on function public.studkab_quality_context(uuid,uuid),public.studkab_quality_insert_guard(),public.studkab_quality_immutable(),public.studkab_quality_check(uuid,uuid),public.studkab_quality_output_guard(),public.studkab_quality_save(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studkab_quality_context(uuid,uuid),public.studkab_quality_insert_guard(),public.studkab_quality_immutable(),public.studkab_quality_check(uuid,uuid),public.studkab_quality_output_guard(),public.studkab_quality_save(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text) to service_role;

create or replace function public.review_studkab_result(request uuid,version uuid,review uuid,reviewer uuid,recipient uuid,file_hash text,document_hash text,criteria jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 if public.studkab_quality_check(request,version)->>'eligible' is distinct from 'true' then raise exception 'QUALITY_EVIDENCE_REQUIRED'; end if;
 if public.studkab_material_manifest_check(request) ? 'code' then raise exception 'MATERIAL_MANIFEST_REQUIRED'; end if;
 if not exists(select 1 from public.studkab_result_versions evidence_version join public.studkab_requirement_passports p on p.id::text=evidence_version.document#>>'{reviewContext,passportId}' and p.request_id=evidence_version.request_id and p.status='approved' and p.source_fingerprint=evidence_version.document#>>'{reviewContext,sourceFingerprint}' where evidence_version.id=version and evidence_version.request_id=request and p.revision=(select max(revision) from public.studkab_requirement_passports where request_id=request)) then raise exception 'Review passport changed'; end if;
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where request_id=request order by revision desc limit 1;
 if v.id is null or v.id<>version or v.recipient_id is distinct from actual or actual is distinct from recipient or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
 if not public.studkab_valid_review(criteria) then return jsonb_build_object('error','criteria'); end if;
 select * into r from public.studkab_result_reviews where id=review;
 if found then
  if r.quality_evidence_ids is distinct from public.studkab_quality_check(request,version)->'evidenceIds' then raise exception 'QUALITY_REVIEW_STALE'; end if;
  if r.version_id<>version or r.reviewer_id<>reviewer or r.criteria<>criteria then return jsonb_build_object('error','conflict'); end if;
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
 if not exists(select 1 from public.studkab_result_versions evidence_version join public.studkab_requirement_passports p on p.id::text=evidence_version.document#>>'{reviewContext,passportId}' and p.request_id=evidence_version.request_id and p.status='approved' and p.source_fingerprint=evidence_version.document#>>'{reviewContext,sourceFingerprint}' where evidence_version.id=version and evidence_version.request_id=request and p.revision=(select max(revision) from public.studkab_requirement_passports where request_id=request)) then raise exception 'Review passport changed'; end if;
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where id=version and request_id=request;
 if v.id is null or actual is distinct from recipient or v.recipient_id is distinct from actual or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
 if (select quality_evidence_ids from public.studkab_result_reviews where id=review and version_id=version) is distinct from public.studkab_quality_check(request,version)->'evidenceIds' then raise exception 'QUALITY_REVIEW_STALE'; end if;
 select * into old from public.studkab_results where request_id=request and delivery_id=delivery;
 if found then
  if old.version_id is distinct from version or old.review_id is distinct from review then return jsonb_build_object('error','conflict'); end if;
  return jsonb_build_object('deliveryId',old.delivery_id,'createdAt',old.created_at,'duplicate',true);
 end if;
 if version is distinct from (select id from public.studkab_result_versions where request_id=request order by revision desc limit 1) then return jsonb_build_object('error','stale'); end if;
 select * into r from public.studkab_result_reviews where id=review and version_id=version;
 if r.id is null or not public.studkab_valid_review(r.criteria) then return jsonb_build_object('error','review_required'); end if;
 insert into public.studkab_results(request_id,delivery_id,document,version_id,review_id) values(request,delivery,v.document,version,review) returning * into old;
 return jsonb_build_object('deliveryId',old.delivery_id,'createdAt',old.created_at,'duplicate',false);
end $$;

create or replace function public.delete_studkab_request(
  p_request uuid,
  p_actor uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claims jsonb;
  v_jobs uuid[];
  v_versions uuid[];
  v_reviews uuid[];
  v_counts jsonb;
begin
  begin
    v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then
    v_claims:='{}'::jsonb;
  end;
  if coalesce(v_claims->>'role','')<>'service_role' then
    raise exception 'REQUEST_DELETE_FORBIDDEN';
  end if;
  if p_request is null or p_actor is null or p_reason is null
     or length(trim(p_reason)) not between 10 and 500 then
    raise exception 'REQUEST_DELETE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
  perform 1 from public.studkab_requests where id=p_request for update;
  if not found then
    return jsonb_build_object('deleted',true,'absent',true,'id',p_request);
  end if;
  if (select deleting_at is null from public.studkab_requests where id=p_request) then
    raise exception 'REQUEST_DELETE_NOT_PREPARED';
  end if;

  select coalesce(array_agg(id),'{}') into v_jobs
  from public.studkab_gen_jobs where request_id=p_request::text;
  if exists(
    select 1 from public.studkab_gen_attempts a
    where a.job_id=any(v_jobs)
      and not exists(
        select 1 from public.studkab_gen_reconciliations r
        where a.request_id=any(r.request_ids)
      )
  ) then
    raise exception 'REQUEST_DELETE_UNRECONCILED_COST';
  end if;

  select coalesce(array_agg(id),'{}') into v_versions
  from public.studkab_result_versions where request_id=p_request;
  select coalesce(array_agg(id),'{}') into v_reviews
  from public.studkab_result_reviews where version_id=any(v_versions);
  v_counts:=jsonb_build_object(
    'qualityEvidence',(select count(*) from public.studkab_quality_evidence where request_id=p_request),
    'material_revisions',(select count(*) from public.studkab_material_revisions where request_id=p_request),
    'clarifications',(select count(*) from public.studkab_clarifications where request_id=p_request),
    'payload_history',(select count(*) from public.studkab_request_payload_history where request_id=p_request),
    'reassignments',(select count(*) from public.studkab_request_reassignments where request_id=p_request),
    'reassignmentPermissions',(select count(*) from public.studkab_request_reassignment_permissions where request_id=p_request),
    'testDeliveries',(select count(*) from public.studkab_test_deliveries where request_id=p_request),
    'testGrants',(select count(*) from public.studkab_test_request_grants where request_id=p_request),
    'attachments',(select count(*) from public.studkab_request_attachments where request_id=p_request),
    'passports',(select count(*) from public.studkab_requirement_passports where request_id=p_request),
    'versions',cardinality(v_versions),
    'reviews',cardinality(v_reviews),
    'results',(select count(*) from public.studkab_results where request_id=p_request),
    'jobs',cardinality(v_jobs),
    'parts',(select count(*) from public.studkab_gen_parts where job_id=any(v_jobs)),
    'attempts',(select count(*) from public.studkab_gen_attempts where job_id=any(v_jobs)),
    'recoveries',(select count(*) from public.studkab_gen_recoveries where job_id=any(v_jobs))
  );

  delete from public.studkab_results
    where request_id=p_request or version_id=any(v_versions) or review_id=any(v_reviews);
  delete from public.studkab_result_reviews where id=any(v_reviews);
  delete from public.studkab_result_versions where id=any(v_versions);
  delete from public.studkab_gen_recoveries where job_id=any(v_jobs);
  delete from public.studkab_gen_attempts where job_id=any(v_jobs);
  delete from public.studkab_gen_parts where job_id=any(v_jobs);
  delete from public.studkab_gen_jobs where id=any(v_jobs);
  delete from public.studkab_clarifications where request_id=p_request;
  delete from public.studkab_requirement_passports where request_id=p_request;
  delete from public.studkab_request_attachments where request_id=p_request;
  delete from public.studkab_material_revisions where request_id=p_request;
  delete from public.studkab_request_payload_history where request_id=p_request;
  delete from public.studkab_request_reassignments where request_id=p_request;
  delete from public.studkab_request_reassignment_permissions where request_id=p_request;
  delete from public.studkab_requests where id=p_request;

  insert into public.studkab_request_deletion_audit(request_id,actor_id,reason,deleted_counts)
  values(p_request,p_actor,trim(p_reason),v_counts)
  on conflict(request_id) do nothing;
  return jsonb_build_object('deleted',true,'absent',false,'id',p_request,'counts',v_counts);
end $$;
