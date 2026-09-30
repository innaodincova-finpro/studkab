-- C177: an immutable requirement set for each Word/passport binding. Existing
-- deliveries remain historical; all future positive reviews require coverage.
begin;

create table public.studkab_result_requirement_snapshots (
 binding_id uuid primary key references public.studkab_result_passport_bindings(id) on delete cascade,
 passport_id uuid not null references public.studkab_requirement_passports(id),
 version_id uuid not null references public.studkab_result_versions(id) on delete cascade,
 source_fingerprint text not null,
 document_fingerprint text not null,
 file_hash text not null,
 document_hash text not null,
 items jsonb not null check(jsonb_typeof(items)='array'),
 created_at timestamptz not null default clock_timestamp()
);
create table public.studkab_result_requirement_evidence (
 id uuid primary key default gen_random_uuid(),
 binding_id uuid not null references public.studkab_result_passport_bindings(id) on delete cascade,
 item_id text not null,
 disposition text not null check(disposition in ('pass','fail','not_checked','not_applicable')),
 source_locator text not null,
 word_locator text not null,
 source_quote text not null default '',
 word_quote text not null default '',
 explanation text not null,
 actor_id uuid not null references auth.users(id),
 review_job_id uuid references public.studkab_gen_jobs(id),
 created_at timestamptz not null default clock_timestamp(),
 check(length(item_id) between 1 and 80),
 check(length(source_locator)<=500 and length(word_locator)<=500 and length(source_quote)<=2000
  and length(word_quote)<=2000 and length(explanation)<=2000)
);
create index studkab_requirement_evidence_latest on public.studkab_result_requirement_evidence(binding_id,item_id,created_at desc,id desc);
create unique index studkab_requirement_review_once on public.studkab_result_requirement_evidence(review_job_id,item_id) where review_job_id is not null;
alter table public.studkab_result_requirement_snapshots enable row level security;
alter table public.studkab_result_requirement_evidence enable row level security;
revoke all on public.studkab_result_requirement_snapshots,public.studkab_result_requirement_evidence from public,anon,authenticated,service_role;
grant select on public.studkab_result_requirement_snapshots,public.studkab_result_requirement_evidence to service_role;

insert into public.studkab_result_requirement_snapshots(binding_id,passport_id,version_id,source_fingerprint,document_fingerprint,file_hash,document_hash,items)
select b.id,b.passport_id,b.version_id,b.source_fingerprint,b.document_fingerprint,v.file_hash,v.document_hash,p.items
from public.studkab_result_passport_bindings b
join public.studkab_result_versions v on v.id=b.version_id
join public.studkab_requirement_passports p on p.id=b.passport_id;

create function public.studkab_snapshot_result_requirements() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.studkab_result_requirement_snapshots(binding_id,passport_id,version_id,source_fingerprint,document_fingerprint,file_hash,document_hash,items)
 select new.id,new.passport_id,new.version_id,new.source_fingerprint,new.document_fingerprint,v.file_hash,v.document_hash,p.items
 from public.studkab_result_versions v join public.studkab_requirement_passports p on p.id=new.passport_id
 where v.id=new.version_id and p.request_id=v.request_id and p.source_fingerprint=new.source_fingerprint;
 if not found then raise exception 'REQUIREMENT_SNAPSHOT_STALE'; end if;
 return new;
end $$;
create trigger snapshot_result_requirements after insert on public.studkab_result_passport_bindings
for each row execute function public.studkab_snapshot_result_requirements();

create function public.studkab_requirement_evidence_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and (
  not exists(select 1 from public.studkab_result_passport_bindings b where b.id=old.binding_id)
  or exists(select 1 from public.studkab_result_passport_bindings b
   join public.studkab_requirement_passports p on p.id=b.passport_id
   join public.studkab_requests r on r.id=p.request_id
   where b.id=old.binding_id and r.deleting_at is not null)
 ) then return old; end if;
 raise exception 'REQUIREMENT_EVIDENCE_IMMUTABLE';
end $$;
create trigger requirement_snapshot_immutable before update or delete on public.studkab_result_requirement_snapshots
for each row execute function public.studkab_requirement_evidence_immutable();
create trigger requirement_evidence_immutable before update or delete on public.studkab_result_requirement_evidence
for each row execute function public.studkab_requirement_evidence_immutable();

create function public.studkab_requirement_coverage_check(p_request uuid,p_version uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b uuid; s public.studkab_result_requirement_snapshots; p public.studkab_requirement_passports;
 v public.studkab_result_versions; item jsonb; e public.studkab_result_requirement_evidence;
 originality public.studkab_quality_evidence;
 target_id text; seen text[]:='{}'; blocked jsonb:='[]'; covered jsonb:='{}';
begin
 b:=public.studkab_current_result_binding(p_request,p_version);
 if b is null then return jsonb_build_object('eligible',false,'blockingCodes',jsonb_build_array('binding_stale')); end if;
 select * into s from public.studkab_result_requirement_snapshots where binding_id=b;
 select * into p from public.studkab_requirement_passports where id=s.passport_id and request_id=p_request;
 select * into v from public.studkab_result_versions where id=p_version and request_id=p_request;
 if s.binding_id is null or p.id is null or v.id is null or p.items is distinct from s.items
 or p.source_fingerprint is distinct from s.source_fingerprint
 or v.file_hash is distinct from s.file_hash or v.document_hash is distinct from s.document_hash
 or s.version_id is distinct from p_version or s.document_fingerprint is distinct from
  (select document_fingerprint from public.studkab_result_passport_bindings where id=b)
 then return jsonb_build_object('eligible',false,'blockingCodes',jsonb_build_array('snapshot_stale')); end if;
 if jsonb_array_length(s.items)=0 then blocked:=blocked||jsonb_build_array('items_empty'); end if;
 for item in select value from jsonb_array_elements(s.items) loop
  target_id:=item->>'id';
  if target_id is null or target_id='' or target_id=any(seen) then
   blocked:=blocked||jsonb_build_array('item_identity'); continue;
  end if;
  seen:=array_append(seen,target_id);
  if nullif(trim(coalesce(item->>'source','')),'') is null then
   blocked:=blocked||jsonb_build_array(target_id); continue;
  end if;
  -- C102 already binds the external PDF and its explicit Word confirmation to
  -- this exact version. The model has no PDF and cannot certify this item.
  if target_id='ANTIPLAGIARISM' then
   select * into originality from public.studkab_quality_evidence
    where version_id=p_version and kind='external_originality'
    order by sequence desc limit 1;
   if originality.id is null or originality.request_id is distinct from p_request
    or originality.passport_id is distinct from s.passport_id
    or originality.file_hash is distinct from s.file_hash
    or originality.document_hash is distinct from s.document_hash
    or originality.source_fingerprint is distinct from s.source_fingerprint
    or originality.report_hash is null
    or originality.payload->>'disposition' is distinct from 'pass'
    or originality.payload->>'thresholdItemId' is distinct from target_id
    or originality.payload->>'thresholdBasis' is distinct from item->>'text'
    or originality.payload->'requirementConfirmed' is distinct from 'true'::jsonb
    or originality.payload->'wordBindingConfirmed' is distinct from 'true'::jsonb
    or not exists(select 1 from public.studkab_quality_evidence_bindings eb
     where eb.evidence_id=originality.id and eb.binding_id=b)
   then blocked:=blocked||jsonb_build_array(target_id);
   else covered:=covered||jsonb_build_object(target_id,originality.id); end if;
   continue;
  end if;
  select evidence.* into e from public.studkab_result_requirement_evidence evidence
   left join public.studkab_gen_jobs j on j.id=evidence.review_job_id
   where evidence.binding_id=b and evidence.item_id=target_id
   order by coalesce(j.created_at,evidence.created_at) desc,evidence.id desc limit 1;
  if e.id is null or e.disposition='fail' or e.disposition='not_checked'
   or nullif(trim(e.source_locator),'') is null
   or (e.disposition='pass' and (nullif(trim(e.word_locator),'') is null
    or nullif(item->>'source_attachment_id','') is null
    or e.source_locator is distinct from item->>'source_attachment_id'))
   or (e.disposition='not_applicable' and (coalesce((item->>'required')::boolean,true)
     or nullif(trim(e.explanation),'') is null))
  then blocked:=blocked||jsonb_build_array(target_id);
  else covered:=covered||jsonb_build_object(target_id,e.id); end if;
 end loop;
 return jsonb_build_object('eligible',jsonb_array_length(blocked)=0,'blockingCodes',blocked,
  'evidenceIds',covered,'bindingId',b,'passportId',s.passport_id,'versionId',s.version_id,
  'fileHash',s.file_hash,'documentHash',s.document_hash);
end $$;

-- Only a server-side executor operation may append an assertion. The actor
-- cannot choose another Word or an item outside the immutable snapshot.
create function public.studkab_requirement_evidence_record(p_request uuid,p_version uuid,p_actor uuid,
 p_item text,p_disposition text,p_source_locator text,p_word_locator text,p_explanation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b uuid; s public.studkab_result_requirement_snapshots; inserted public.studkab_result_requirement_evidence;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 if not exists(select 1 from auth.users u join public.studkab_request_config c
  on lower(u.email)=lower(c.executor_email) where u.id=p_actor) then raise exception 'FORBIDDEN'; end if;
 b:=public.studkab_current_result_binding(p_request,p_version);
 select * into s from public.studkab_result_requirement_snapshots where binding_id=b;
 if s.binding_id is null or not exists(select 1 from jsonb_array_elements(s.items) i where i->>'id'=p_item)
 or not exists(select 1 from public.studkab_result_versions v where v.id=p_version and v.file_hash=s.file_hash and v.document_hash=s.document_hash)
 then raise exception 'REQUIREMENT_BINDING_STALE'; end if;
 -- A free-form service operation cannot assert a positive result. Only the
 -- completed job ingestion above can write a validated positive quotation.
 if p_disposition not in ('fail','not_checked')
 or length(trim(coalesce(p_source_locator,''))) not between 3 and 500
 or length(coalesce(p_word_locator,''))>500 or length(coalesce(p_explanation,''))>2000
 or (p_disposition='pass' and length(trim(coalesce(p_word_locator,'')))<3)
 or (p_disposition='not_applicable' and (exists(select 1 from jsonb_array_elements(s.items) i
  where i->>'id'=p_item and coalesce((i->>'required')::boolean,true))
  or length(trim(coalesce(p_explanation,'')))<10)) then raise exception 'REQUIREMENT_EVIDENCE_INVALID'; end if;
 insert into public.studkab_result_requirement_evidence(binding_id,item_id,disposition,source_locator,word_locator,explanation,actor_id)
 values(b,p_item,p_disposition,trim(p_source_locator),trim(coalesce(p_word_locator,'')),trim(coalesce(p_explanation,'')),p_actor)
 returning * into inserted;
 return jsonb_build_object('id',inserted.id,'bindingId',b,'itemId',p_item);
end $$;

-- The Edge reviewer validates exact excerpts against the stored source texts
-- and extracted Word, then submits the model's unchanged requirement array.
-- This transaction binds all items to the completed paid job at once.
create function public.studkab_requirement_review_ingest(p_request uuid,p_version uuid,p_job uuid,p_actor uuid,p_requirements jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b uuid; s public.studkab_result_requirement_snapshots; j public.studkab_gen_jobs;
 part public.studkab_gen_parts; item jsonb; row jsonb; n integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 if not exists(select 1 from auth.users u join public.studkab_request_config c
  on lower(u.email)=lower(c.executor_email) where u.id=p_actor) then raise exception 'FORBIDDEN'; end if;
 b:=public.studkab_current_result_binding(p_request,p_version);
 select * into s from public.studkab_result_requirement_snapshots where binding_id=b;
 select * into j from public.studkab_gen_jobs where id=p_job and request_id=p_request::text and status='complete';
 select * into part from public.studkab_gen_parts where job_id=p_job and spec->>'id'='quality_review' and state='done';
 if s.binding_id is null or j.id is null or part.job_id is null
 or j.snapshot#>>'{input,review_target,versionId}' is distinct from p_version::text
 or j.snapshot#>>'{input,review_target,fileHash}' is distinct from s.file_hash
 or j.snapshot#>>'{input,review_target,passportId}' is distinct from s.passport_id::text
 or jsonb_typeof(p_requirements) is distinct from 'array'
 or (part.result::jsonb)->'requirements' is distinct from p_requirements
 or jsonb_array_length(p_requirements)<>jsonb_array_length(s.items)
 then raise exception 'REQUIREMENT_REVIEW_STALE'; end if;
 for item in select value from jsonb_array_elements(s.items) loop
  select value into row from jsonb_array_elements(p_requirements)
   where value->>'id'=item->>'id';
  if row is null or (select count(*) from jsonb_array_elements(p_requirements)
    where value->>'id'=item->>'id')<>1
   or row->>'status' not in ('pass','fail','not_checked')
   or length(coalesce(row->>'sourceId',''))>80
   or length(coalesce(row->>'sourceQuote',''))>2000
   or length(coalesce(row->>'wordQuote',''))>2000
   or length(coalesce(row->>'wordLocator',''))>500
   or length(coalesce(row->>'explanation',''))>2000
   or (row->>'status'='pass' and (row->>'sourceId' is distinct from item->>'source_attachment_id'
     or length(trim(coalesce(row->>'sourceQuote','')))<12
     or length(trim(coalesce(row->>'wordQuote','')))<12
     or length(trim(coalesce(row->>'wordLocator','')))<3))
  then raise exception 'REQUIREMENT_REVIEW_INVALID'; end if;
  insert into public.studkab_result_requirement_evidence(binding_id,item_id,disposition,source_locator,word_locator,
   source_quote,word_quote,explanation,actor_id,review_job_id)
  values(b,item->>'id',row->>'status',coalesce(nullif(row->>'sourceId',''),'не подтверждено'),
   coalesce(row->>'wordLocator',''),coalesce(row->>'sourceQuote',''),coalesce(row->>'wordQuote',''),
   coalesce(row->>'explanation',''),p_actor,p_job)
  on conflict(review_job_id,item_id) where review_job_id is not null do nothing;
  n:=n+1;
 end loop;
 return jsonb_build_object('bindingId',b,'items',n,'jobId',p_job);
end $$;

revoke all on function public.studkab_snapshot_result_requirements(),public.studkab_requirement_evidence_immutable(),
 public.studkab_requirement_coverage_check(uuid,uuid),public.studkab_requirement_evidence_record(uuid,uuid,uuid,text,text,text,text,text),
 public.studkab_requirement_review_ingest(uuid,uuid,uuid,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.studkab_snapshot_result_requirements(),public.studkab_requirement_evidence_immutable(),
 public.studkab_requirement_coverage_check(uuid,uuid),public.studkab_requirement_evidence_record(uuid,uuid,uuid,text,text,text,text,text),
 public.studkab_requirement_review_ingest(uuid,uuid,uuid,uuid,jsonb)
 to service_role;

create or replace function public.studkab_quality_check(p_request uuid,p_version uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare c jsonb; e public.studkab_quality_evidence; k text; ids jsonb:='{}'; missing jsonb:='[]'; coverage jsonb;
begin
 c:=public.studkab_quality_context(p_request,p_version);
 foreach k in array array['internal_borrowing','external_originality'] loop
  select * into e from public.studkab_quality_evidence e1
   join public.studkab_quality_evidence_bindings eb on eb.evidence_id=e1.id
   where e1.version_id=p_version and e1.kind=k
    and eb.binding_id=public.studkab_current_result_binding(p_request,p_version)
   order by e1.sequence desc limit 1;
  if e.id is null or e.payload->>'disposition' is distinct from 'pass'
     or e.passport_id::text is distinct from c->>'passportId'
  then missing:=missing||jsonb_build_array(k);
  else ids:=ids||jsonb_build_object(k,e.id); end if;
 end loop;
 -- A positive manual review is never sufficient without a completed model
 -- report bound to the current immutable Word and approved passport.
 if not exists(
  select 1 from public.studkab_gen_jobs j
  join public.studkab_gen_parts part on part.job_id=j.id and part.spec->>'id'='quality_review'
  where j.request_id=p_request::text
   and j.snapshot#>>'{input,review_target,versionId}'=p_version::text
   and j.snapshot#>>'{input,review_target,fileHash}'=c->>'fileHash'
   and j.snapshot#>>'{input,review_target,passportId}'=c->>'passportId'
   and j.status='complete' and part.state='done'
   and public.studkab_ai_review_clear(part.result,c->>'fileHash')
 ) then missing:=missing||jsonb_build_array('ai_review_required'); end if;
 if exists(
  select 1 from public.studkab_gen_jobs j
  left join public.studkab_gen_parts part on part.job_id=j.id and part.spec->>'id'='quality_review'
  where j.request_id=p_request::text
   and j.snapshot#>>'{input,review_target,fileHash}'=c->>'fileHash'
   and ((j.snapshot#>>'{input,review_target,versionId}'=p_version::text
         and j.snapshot#>>'{input,review_target,passportId}'=c->>'passportId'
         and j.status in ('queued','running'))
        or j.status='unknown' or part.state='unknown'
        or (part.state='done' and not public.studkab_ai_review_clear(part.result,c->>'fileHash')))
 ) then missing:=missing||jsonb_build_array('ai_review_open'); end if;
 coverage:=public.studkab_requirement_coverage_check(p_request,p_version);
 if coverage->>'eligible' is distinct from 'true' then missing:=missing||jsonb_build_array('requirement_coverage'); end if;
 return jsonb_build_object('eligible',jsonb_array_length(missing)=0,
  'blockingCodes',missing,'evidenceIds',ids,'bindings',c,'requirementCoverage',coverage);
end $$;

-- The historic 16-item reviews remain readable. For a new review, the server
-- snapshots the exact evidence IDs for every item of this passport. A caller
-- cannot supply a positive status, invent a criterion, or reuse stale evidence.
create function public.studkab_valid_result_review(p_request uuid,p_version uuid,p_criteria jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare coverage jsonb; expected jsonb;
begin
 coverage:=public.studkab_requirement_coverage_check(p_request,p_version);
 if coverage->>'eligible' is distinct from 'true' then return false; end if;
 expected:=jsonb_build_object('_mode','passport_coverage_v1',
  'bindingId',coverage->'bindingId','evidenceIds',coverage->'evidenceIds');
 return p_criteria=expected;
end $$;

create function public.studkab_auto_review_result(p_request uuid,p_version uuid,p_review uuid,p_reviewer uuid,
 p_recipient uuid,p_file_hash text,p_document_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare verdict jsonb; coverage jsonb; criteria jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 verdict:=public.studkab_quality_check(p_request,p_version);
 coverage:=verdict->'requirementCoverage';
 if verdict->>'eligible' is distinct from 'true' or coverage->>'eligible' is distinct from 'true'
 then raise exception 'QUALITY_EVIDENCE_REQUIRED'; end if;
 criteria:=jsonb_build_object('_mode','passport_coverage_v1',
  'bindingId',coverage->'bindingId','evidenceIds',coverage->'evidenceIds');
 return public.review_studkab_result(p_request,p_version,p_review,p_reviewer,p_recipient,
  p_file_hash,p_document_hash,criteria);
end $$;

revoke all on function public.studkab_valid_result_review(uuid,uuid,jsonb),
 public.studkab_auto_review_result(uuid,uuid,uuid,uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.studkab_valid_result_review(uuid,uuid,jsonb),
 public.studkab_auto_review_result(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;


-- Replace the three final C109 entry points so the new exact-evidence
-- protocol is accepted while historical reviews keep their old contract.
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
 if not public.studkab_valid_result_review(request,version,criteria) then return jsonb_build_object('error','criteria'); end if;
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
 if r.id is null or not public.studkab_valid_result_review(request,version,r.criteria) or not exists(select 1 from public.studkab_result_review_bindings rb where rb.review_id=r.id and rb.binding_id=public.studkab_current_result_binding(request,version)) then return jsonb_build_object('error','review_required'); end if;
 insert into public.studkab_results(request_id,delivery_id,document,version_id,review_id) values(request,delivery,v.document,version,review) returning * into old;
 return jsonb_build_object('deliveryId',old.delivery_id,'createdAt',old.created_at,'duplicate',false);
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
 if v.id is null or new.version_id is distinct from v.id or r.version_id is distinct from v.id or v.recipient_id is distinct from actual or new.document is distinct from v.document or not public.studkab_valid_result_review(new.request_id,new.version_id,r.criteria) then raise exception 'Versioned review required'; end if;
 if public.studkab_current_result_binding(new.request_id,new.version_id) is null or not exists(select 1 from public.studkab_result_review_bindings rb where rb.review_id=new.review_id and rb.binding_id=public.studkab_current_result_binding(new.request_id,new.version_id)) then raise exception 'Review passport changed'; end if;
 return new;
end $$;

commit;
