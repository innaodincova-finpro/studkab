-- C098: versioned, discipline-specific evidence, no rewriting historical passports.
alter table public.studkab_requirement_passports add column material_manifest jsonb;
create function public.studkab_material_manifest_check(p_request uuid,p_passport uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare p public.studkab_requirement_passports; payload jsonb; m jsonb; r jsonb; ref text; n integer; seen text[]:=array[]::text[];
begin
 select q.payload into payload from public.studkab_requests q where q.id=p_request and q.deleting_at is null for share;
 if not found then return jsonb_build_object('code','MATERIAL_MANIFEST_REQUIRED'); end if;
 select * into p from public.studkab_requirement_passports where request_id=p_request order by revision desc limit 1;
 if p.id is null or (p_passport is not null and p.id<>p_passport) or (p_passport is null and p.status<>'approved')
 then return jsonb_build_object('code','MATERIAL_MANIFEST_REQUIRED'); end if;
 m:=p.material_manifest;
 if jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(m->'basis') is distinct from 'string'
 or length(trim(m->>'basis')) not between 1 and 4000 or jsonb_typeof(m->'requirements') is distinct from 'array'
 then return jsonb_build_object('code','MATERIAL_MANIFEST_REQUIRED'); end if;
 if jsonb_array_length(m->'requirements') not between 1 and 100 then return jsonb_build_object('code','MATERIAL_MANIFEST_REQUIRED'); end if;
 for r in select value from jsonb_array_elements(m->'requirements') loop
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'id','')!~'^[A-Za-z0-9_-]{1,80}$'
  or r->>'id'=any(seen) or jsonb_typeof(r->'label') is distinct from 'string' or length(trim(r->>'label')) not between 1 and 2000
  or jsonb_typeof(r->'required') is distinct from 'boolean'
  then return jsonb_build_object('code','MATERIAL_MANIFEST_REQUIRED'); end if;
  seen:=array_append(seen,r->>'id');n:=0;
  foreach ref in array array['attachment_ids','answer_ids','payload_fields'] loop
   if jsonb_typeof(r->ref) is distinct from 'array' then return jsonb_build_object('code','MATERIAL_EVIDENCE_INVALID','requirementId',r->>'id'); end if;
   if jsonb_array_length(r->ref)>100 then return jsonb_build_object('code','MATERIAL_EVIDENCE_INVALID','requirementId',r->>'id'); end if;
  end loop;
  for ref in select jsonb_array_elements_text(r->'attachment_ids') loop
   if ref is null or not exists(select 1 from public.studkab_request_attachments a where a.id::text=ref and a.request_id=p_request
     and a.size_bytes>0 and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))
   then return jsonb_build_object('code','MATERIAL_EVIDENCE_INVALID','requirementId',r->>'id'); end if;n:=n+1;
  end loop;
  for ref in select jsonb_array_elements_text(r->'answer_ids') loop
   if ref is null or not exists(select 1 from public.studkab_clarifications c join public.studkab_requests q on q.id=c.request_id
     where c.id::text=ref and c.request_id=p_request and c.answered_by=q.student_id and length(trim(c.answer))>0)
   then return jsonb_build_object('code','MATERIAL_EVIDENCE_INVALID','requirementId',r->>'id'); end if;n:=n+1;
  end loop;
  for ref in select jsonb_array_elements_text(r->'payload_fields') loop
   if ref is null or ref<>all(array['mn','rq','org']) or jsonb_typeof(payload->ref) is distinct from 'string' or length(trim(payload->>ref))=0
   then return jsonb_build_object('code','MATERIAL_EVIDENCE_INVALID','requirementId',r->>'id'); end if;n:=n+1;
  end loop;
  if r->>'required'='true' and n=0 then return jsonb_build_object('code','MATERIAL_EVIDENCE_MISSING','requirementId',r->>'id'); end if;
  if r->>'required'='false' and (jsonb_typeof(r->'not_applicable_reason') is distinct from 'string' or length(trim(r->>'not_applicable_reason')) not between 1 and 2000)
  then return jsonb_build_object('code','MATERIAL_EVIDENCE_MISSING','requirementId',r->>'id'); end if;
 end loop;
 return jsonb_build_object('valid',true);
end $$;
-- Validate stored evidence at actual approval, including direct SQL status updates.
create function public.studkab_manifest_passport_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare verdict jsonb;
begin
 if tg_op='UPDATE' and new.material_manifest is distinct from old.material_manifest then raise exception 'MATERIAL_MANIFEST_IMMUTABLE'; end if;
 if new.status='approved' then
  if tg_op='INSERT' then raise exception 'MATERIAL_MANIFEST_REQUIRES_DRAFT'; end if;
  perform 1 from public.studkab_requests where id=new.request_id for update;
  verdict:=public.studkab_material_manifest_check(new.request_id,new.id);
  if verdict ? 'code' then raise exception '%',verdict->>'code'; end if;
 end if;
 return new;
end $$;
create trigger passport_manifest_guard before insert or update on public.studkab_requirement_passports for each row execute function public.studkab_manifest_passport_guard();
-- Guard every new job/result/delivery, without affecting reads or deleting old rows.
create function public.studkab_manifest_output_guard() returns trigger language plpgsql security invoker set search_path='' as $$
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
  else select document->'reviewContext' into context from public.studkab_result_versions where id=new.version_id and request_id=rid; end if;
  if context is null or context->>'passportId' is distinct from p.id::text or context->>'sourceFingerprint' is distinct from p.source_fingerprint
  then raise exception 'Review passport changed'; end if;
 end if;
 return new;
end $$;
create trigger gen_manifest_guard before insert on public.studkab_gen_jobs for each row execute function public.studkab_manifest_output_guard();
create trigger result_manifest_guard before insert on public.studkab_result_versions for each row execute function public.studkab_manifest_output_guard();
create trigger delivery_manifest_guard before insert on public.studkab_results for each row execute function public.studkab_manifest_output_guard();
create trigger review_manifest_guard before insert on public.studkab_result_reviews for each row execute function public.studkab_manifest_output_guard();

drop function public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text,integer);
create function public.studkab_requirement_passport_save(
 p_request uuid,p_actor uuid,p_title text,p_summary text,p_items jsonb,p_source_fingerprint text,p_expected_revision integer default null,p_material_manifest jsonb default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare next_revision integer; created public.studkab_requirement_passports;
begin
 if not exists(select 1 from auth.users u join public.studkab_request_config cfg on lower(u.email)=lower(cfg.executor_email) where u.id=p_actor)
 then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.studkab_requests where id=p_request for update;
 if not found then raise exception 'request_not_found'; end if;
 if exists(select 1 from public.studkab_material_revisions where request_id=p_request and closed_at is null)
 then return jsonb_build_object('error','Завершите дополнение материалов перед изменением паспорта'); end if;
 if (p_expected_revision is not null or exists(select 1 from public.studkab_material_revisions where request_id=p_request))
 and p_expected_revision is distinct from (select revision from public.studkab_requests where id=p_request)
 then return jsonb_build_object('error','Материалы изменились. Откройте паспорт заново'); end if;
 select coalesce(max(revision),0)+1 into next_revision from public.studkab_requirement_passports where request_id=p_request;
 insert into public.studkab_requirement_passports(request_id,revision,title,summary,items,source_fingerprint,created_by,material_manifest)
 values(p_request,next_revision,p_title,p_summary,p_items,p_source_fingerprint,p_actor,p_material_manifest) returning * into created;
 return to_jsonb(created);
end $$;


create or replace function public.studkab_gen_start(
 p_owner uuid,p_request text,p_input jsonb,p_plan jsonb,p_passport uuid,
 p_work_kind text,p_max_cost_microusd bigint
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_snapshot jsonb; v_base text; v_version text; v_id uuid; v_status text; v_n integer; s jsonb; approved uuid; allowed bigint;
begin
 if p_request !~ '^[a-f0-9-]{36}$' then raise exception 'INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request,713));
 perform 1 from public.studkab_requests where id=p_request::uuid and deleting_at is null for update;
 if not found then raise exception 'INVALID_REQUEST'; end if;
 if exists(select 1 from public.studkab_material_revisions where request_id=p_request::uuid and closed_at is null)
 then raise exception 'MATERIAL_REVISION_OPEN'; end if;
 select id into approved from public.studkab_requirement_passports
  where id=p_passport and request_id=p_request::uuid and status='approved'
    and source_fingerprint=coalesce(p_input->>'material_fingerprint','') for share;
 if approved is null then raise exception 'PASSPORT_REQUIRED'; end if;
 if public.studkab_material_manifest_check(p_request::uuid,p_passport) ? 'code' then raise exception 'MATERIAL_MANIFEST_REQUIRED'; end if;
 select max_cost_microusd into allowed from public.studkab_gen_limits where work_kind=p_work_kind;
 if allowed is null or allowed<>p_max_cost_microusd then raise exception 'INVALID_WORK_LIMIT'; end if;
 if p_input is null or jsonb_typeof(p_input)!='object' or p_plan is null or jsonb_typeof(p_plan)!='array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_plan) not between 1 and 100 then raise exception 'INVALID_PLAN'; end if;
 for s in select value from jsonb_array_elements(p_plan) loop
  if jsonb_typeof(s)!='object' or coalesce(s->>'id','')='' or coalesce(s->>'prompt','')=''
     or coalesce(s->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,11}$'
     or coalesce(s->>'max_output_tokens','') !~ '^[1-9][0-9]{0,3}$'
     or (s->>'max_output_tokens')::integer>8000 then raise exception 'INVALID_PART'; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_plan))!=jsonb_array_length(p_plan) then raise exception 'DUPLICATE_PART'; end if;
 v_snapshot=jsonb_build_object('input',p_input,'plan',p_plan,'passport_id',p_passport,
  'work_kind',p_work_kind,'max_cost_microusd',p_max_cost_microusd);
 if octet_length(v_snapshot::text)>1000000 then raise exception 'INPUT_TOO_BIG'; end if;
 v_base=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_request,0));
 select id,status into v_id,v_status from public.studkab_gen_jobs
  where owner_id=p_owner and request_id=p_request and (version=v_base or version like v_base||':r%')
  order by created_at desc limit 1;
 if v_id is not null and v_status not in ('cancelled','stale') then return v_id; end if;
 select count(*) into v_n from public.studkab_gen_jobs
  where owner_id=p_owner and request_id=p_request and (version=v_base or version like v_base||':r%');
 v_version=case when v_n=0 then v_base else v_base||':r'||v_n end;
 insert into public.studkab_gen_jobs(owner_id,request_id,version,snapshot,passport_id,work_kind,max_cost_microusd)
 values(p_owner,p_request,v_version,v_snapshot,p_passport,p_work_kind,p_max_cost_microusd) returning id into v_id;
 insert into public.studkab_gen_parts(job_id,ordinal,spec)
 select v_id,(ordinality-1)::integer,value from jsonb_array_elements(p_plan) with ordinality;
 return v_id;
end $$;
revoke all on function public.studkab_material_manifest_check(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studkab_material_manifest_check(uuid,uuid) to service_role;
revoke all on function public.studkab_manifest_passport_guard() from public,anon,authenticated;
grant execute on function public.studkab_manifest_passport_guard() to service_role;
revoke all on function public.studkab_manifest_output_guard() from public,anon,authenticated;
grant execute on function public.studkab_manifest_output_guard() to service_role;
revoke all on function public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text,integer,jsonb) to service_role;

drop function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text,integer);
create or replace function public.studkab_requirement_passport_approve(
 p_request uuid,p_passport uuid,p_actor uuid,p_expected_items jsonb,p_expected_fingerprint text,p_expected_revision integer default null,p_expected_manifest jsonb default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare selected public.studkab_requirement_passports; i jsonb; q public.studkab_clarifications;
 required_ids text[]:=array['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER'];
 key text; answer_id text;
begin
 if not exists(select 1 from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) where u.id=p_actor)
 then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then raise exception 'request_not_found'; end if;
 if exists(select 1 from public.studkab_material_revisions where request_id=p_request and closed_at is null)
 then return jsonb_build_object('error','Завершите дополнение материалов перед изменением паспорта'); end if;
 if (p_expected_revision is not null or exists(select 1 from public.studkab_material_revisions where request_id=p_request))
 and p_expected_revision is distinct from (select revision from public.studkab_requests where id=p_request)
 then return jsonb_build_object('error','Материалы изменились. Откройте паспорт заново'); end if;
 select * into selected from public.studkab_requirement_passports where id=p_passport and request_id=p_request for update;
 if not found then raise exception 'passport_not_found'; end if;
 if selected.material_manifest is distinct from p_expected_manifest then raise exception 'MATERIAL_MANIFEST_CHANGED'; end if;
 if selected.status<>'draft' or selected.items is distinct from p_expected_items
 or coalesce(selected.source_fingerprint,'')='' or selected.source_fingerprint is distinct from p_expected_fingerprint
 or exists(select 1 from public.studkab_requirement_passports where request_id=p_request and revision>selected.revision)
 then raise exception 'passport_changed'; end if;
 foreach key in array required_ids loop
  if (select count(*) from jsonb_array_elements(selected.items) j where j->>'id'=key)<>1 then raise exception 'PASSPORT_REQUIRED_ITEMS'; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(selected.items))<>(select count(distinct j->>'id') from jsonb_array_elements(selected.items) j)
 then raise exception 'PASSPORT_DUPLICATE_ITEMS'; end if;
 for i in select * from jsonb_array_elements(selected.items) loop
  if i->>'id'=any(required_ids) or i->>'required' is distinct from 'false' then
   if i->>'verified' is distinct from 'true' or length(trim(coalesce(i->>'source','')))=0
   or length(trim(coalesce(i->>'text','')))=0 or i->>'text' ~* 'не указано|требуется уточнить|порог не задан|ожидается ответ'
   then raise exception 'PASSPORT_UNVERIFIED'; end if;
  end if;
  if i ? 'answer_ids' then
   if jsonb_typeof(i->'answer_ids')<>'array' then raise exception 'PASSPORT_EVIDENCE'; end if;
   for answer_id in select jsonb_array_elements_text(i->'answer_ids') loop
    if not exists(select 1 from public.studkab_clarifications c where c.id::text=answer_id and c.request_id=p_request and c.item_id=i->>'id' and c.answer is not null)
    then raise exception 'PASSPORT_EVIDENCE'; end if;
   end loop;
  end if;
 end loop;
 for q in select * from public.studkab_clarifications where request_id=p_request loop
  if q.answer is null or selected.created_at<q.answered_at or not exists(select 1 from jsonb_array_elements(selected.items) j
    where j->>'id'=q.item_id and j->>'verified'='true' and length(trim(coalesce(j->>'source','')))>0
    and coalesce(j->'answer_ids','[]'::jsonb) ? q.id::text)
  then raise exception 'CLARIFICATION_UNREVIEWED'; end if;
 end loop;
 update public.studkab_requirement_passports set status='stale' where request_id=p_request and status='approved';
 update public.studkab_requirement_passports set status='approved',approved_by=p_actor,approved_at=now() where id=p_passport returning * into selected;
 return to_jsonb(selected);
end $$;
revoke all on function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text,integer,jsonb) to service_role;

create or replace function public.prepare_studkab_result(request uuid,version uuid,recipient uuid,content jsonb,file_base64 text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; actual uuid; bytes bytea;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 if public.studkab_material_manifest_check(request) ? 'code' then raise exception 'MATERIAL_MANIFEST_REQUIRED'; end if;
 if content->'reviewContext' is null then raise exception 'Review passport changed'; end if;
 select student_id into actual from public.studkab_requests where id=request for share;
 if actual is null or actual<>recipient then return jsonb_build_object('error','recipient'); end if;
 if file_base64 is null or length(file_base64)>4194304 or file_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' then return jsonb_build_object('error','file'); end if;
 bytes:=decode(file_base64,'base64');
 if octet_length(bytes)<4 or substring(bytes from 1 for 4)<>decode('504b0304','hex') then return jsonb_build_object('error','file'); end if;
 select * into v from public.studkab_result_versions where id=version;
 if found then
  if v.request_id<>request or v.recipient_id<>recipient or v.document<>content or v.docx_base64<>file_base64 then return jsonb_build_object('error','conflict'); end if;
 else
  insert into public.studkab_result_versions(id,request_id,recipient_id,document,docx_base64,document_hash,file_hash)
  values(version,request,recipient,content,file_base64,encode(sha256(convert_to(content::text,'UTF8')),'hex'),encode(sha256(bytes),'hex')) returning * into v;
 end if;
 return jsonb_build_object('versionId',v.id,'recipientId',v.recipient_id,'documentHash',v.document_hash,'fileHash',v.file_hash,'revision',v.revision);
end $$;

create or replace function public.review_studkab_result(request uuid,version uuid,review uuid,reviewer uuid,recipient uuid,file_hash text,document_hash text,criteria jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 if public.studkab_material_manifest_check(request) ? 'code' then raise exception 'MATERIAL_MANIFEST_REQUIRED'; end if;
 if not exists(select 1 from public.studkab_result_versions evidence_version join public.studkab_requirement_passports p on p.id::text=evidence_version.document#>>'{reviewContext,passportId}' and p.request_id=evidence_version.request_id and p.status='approved' and p.source_fingerprint=evidence_version.document#>>'{reviewContext,sourceFingerprint}' where evidence_version.id=version and evidence_version.request_id=request and p.revision=(select max(revision) from public.studkab_requirement_passports where request_id=request)) then raise exception 'Review passport changed'; end if;
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where request_id=request order by revision desc limit 1;
 if v.id is null or v.id<>version or v.recipient_id is distinct from actual or actual is distinct from recipient or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
 if not public.studkab_valid_review(criteria) then return jsonb_build_object('error','criteria'); end if;
 select * into r from public.studkab_result_reviews where id=review;
 if found then
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
 if public.studkab_material_manifest_check(request) ? 'code' then raise exception 'MATERIAL_MANIFEST_REQUIRED'; end if;
 if not exists(select 1 from public.studkab_result_versions evidence_version join public.studkab_requirement_passports p on p.id::text=evidence_version.document#>>'{reviewContext,passportId}' and p.request_id=evidence_version.request_id and p.status='approved' and p.source_fingerprint=evidence_version.document#>>'{reviewContext,sourceFingerprint}' where evidence_version.id=version and evidence_version.request_id=request and p.revision=(select max(revision) from public.studkab_requirement_passports where request_id=request)) then raise exception 'Review passport changed'; end if;
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where id=version and request_id=request;
 if v.id is null or actual is distinct from recipient or v.recipient_id is distinct from actual or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
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
