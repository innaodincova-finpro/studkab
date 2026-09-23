-- Preserve answered clarification provenance; no production identifiers or mutations.
alter table public.studkab_request_reassignments
 add column clarification_count integer not null default 0 check(clarification_count>=0),
 add column clarification_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(clarification_snapshot)='object');

create or replace function public.studkab_reassign_request(
 p_operation uuid,p_request uuid,p_from uuid,p_to uuid,p_actor uuid,p_reason text,
 p_expected_revision integer,p_expected_source_cloud_revision bigint,p_expected_target_cloud_revision bigint,p_work jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; permission public.studkab_request_reassignment_permissions;
 prior public.studkab_request_reassignments; source public.app_data; target public.app_data; next_data jsonb;
 work_hash text; original_payload_hash text; mapping text[]; answer_snapshot jsonb; answer_count integer;
begin
 if current_user<>'postgres' then raise exception 'REQUEST_REASSIGNMENT_ADMIN_ONLY'; end if;
 if p_operation is null or p_request is null or p_from is null or p_to is null or p_from=p_to or p_actor is null
 or p_expected_revision is null or p_expected_source_cloud_revision is null or p_expected_target_cloud_revision is null
 or p_reason is null or length(trim(p_reason)) not between 10 and 2000
 then raise exception 'REQUEST_REASSIGNMENT_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 select * into r from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then raise exception 'REQUEST_REASSIGNMENT_UNAVAILABLE'; end if;
 select * into permission from public.studkab_request_reassignment_permissions where request_id=p_request for share;
 if not found or permission.revoked_at is not null or permission.from_student_id<>p_from or permission.to_student_id<>p_to
 then raise exception 'REQUEST_REASSIGNMENT_NOT_ALLOWED'; end if;
 if not exists(select 1 from auth.users u join public.studkab_request_config c on lower(c.executor_email)=lower(u.email) where u.id=p_actor)
 then raise exception 'REQUEST_REASSIGNMENT_ACTOR'; end if;
 work_hash:=encode(sha256(convert_to(p_work::text,'UTF8')),'hex');
 select * into prior from public.studkab_request_reassignments where operation_id=p_operation or request_id=p_request;
 if found then
  if prior.operation_id=p_operation and prior.request_id=p_request and prior.from_student_id=p_from and prior.to_student_id=p_to
   and prior.actor_id=p_actor and prior.reason=trim(p_reason) and prior.work_hash=work_hash
   and prior.request_revision_before=p_expected_revision and prior.source_cloud_revision=p_expected_source_cloud_revision
   and prior.target_cloud_revision_before=p_expected_target_cloud_revision and r.student_id=p_to
  then return jsonb_build_object('reassigned',true,'duplicate',true,'requestId',r.id,'number',r.number); end if;
  raise exception 'REQUEST_REASSIGNMENT_CONFLICT';
 end if;
 if r.student_id<>p_from or r.revision<>p_expected_revision then raise exception 'REQUEST_REASSIGNMENT_CHANGED'; end if;
 perform 1 from auth.users u where u.id=p_to and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
 and not exists(select 1 from public.studkab_request_config c where lower(c.executor_email)=lower(u.email)) for share;
 if not found then raise exception 'REQUEST_REASSIGNMENT_RECIPIENT'; end if;
 perform 1 from public.studkab_members where user_id=p_to for share;
 if not found then raise exception 'REQUEST_REASSIGNMENT_RECIPIENT'; end if;
 if exists(select 1 from public.studkab_requests where student_id=p_to and client_id=r.client_id)
 or exists(select 1 from public.studkab_gen_jobs where request_id=p_request::text)
 or exists(select 1 from public.studkab_result_versions where request_id=p_request)
 or exists(select 1 from public.studkab_results where request_id=p_request)
 or exists(select 1 from public.studkab_material_revisions where request_id=p_request)
 or exists(select 1 from public.studkab_test_request_grants where request_id=p_request)
 or exists(select 1 from public.studkab_test_deliveries where request_id=p_request)
 then raise exception 'REQUEST_REASSIGNMENT_HISTORY'; end if;
 -- Ask/answer both take this same request row lock before touching clarification rows.
 -- The transfer already holds it: after a wait the following VOLATILE statements
 -- inspect committed answers; no unlocked precheck can authorize the transfer.
 if exists(select 1 from public.studkab_clarifications c where c.request_id=p_request and (
  c.answer is null or length(trim(c.answer))=0 or c.answer_source is null or length(trim(c.answer_source))=0
  or c.answered_at is null or c.answered_at<c.created_at or c.answered_by is distinct from p_from
  or not exists(select 1 from auth.users u join public.studkab_request_config cfg on lower(cfg.executor_email)=lower(u.email) where u.id=c.asked_by)))
 then raise exception 'REQUEST_REASSIGNMENT_CLARIFICATION'; end if;
 select count(*)::integer,coalesce(jsonb_object_agg(c.id::text,encode(sha256(convert_to((to_jsonb(c)||jsonb_build_object('created_at',extract(epoch from c.created_at),'answered_at',extract(epoch from c.answered_at)))::text,'UTF8')),'hex')),'{}'::jsonb)
 into answer_count,answer_snapshot from public.studkab_clarifications c where c.request_id=p_request;
 perform 1 from public.app_data where app='kabinet' and user_id in (p_from,p_to) order by user_id for update;
 select * into source from public.app_data where app='kabinet' and user_id=p_from;
 select * into target from public.app_data where app='kabinet' and user_id=p_to;
 if source.user_id is null or target.user_id is null or source.rev<>p_expected_source_cloud_revision or target.rev<>p_expected_target_cloud_revision
 or jsonb_typeof(source.data->'works') is distinct from 'array' or jsonb_typeof(target.data->'works') is distinct from 'array'
 then raise exception 'REQUEST_REASSIGNMENT_CLOUD_CHANGED'; end if;
 if jsonb_typeof(p_work) is distinct from 'object' or coalesce(p_work->>'id','')!~'^w[A-Za-z0-9_-]{1,99}$' or p_work->>'id' in (r.client_id,r.id::text)
 or p_work#>>'{req,id}' is distinct from r.client_id or p_work#>>'{req,serverId}' is distinct from r.id::text
 or p_work#>>'{req,number}' is distinct from r.number::text or p_work->>'topic' is distinct from r.payload->>'t'
 then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 if p_work#>>'{req,preserveSubmittedFields}' is distinct from 'true' or p_work->>'status' is distinct from 'draft'
 or p_work->'tasks' is distinct from '[]'::jsonb or p_work#>'{req,pendingFiles}' is distinct from '[]'::jsonb
 or p_work#>>'{req,filesPending}' is distinct from 'false' or p_work#>>'{req,sentBy}' is distinct from 'direct'
 or p_work#>>'{req,sent}' is distinct from to_char(r.created_at at time zone 'UTC','YYYY-MM-DD')
 or p_work->>'created' is distinct from to_char(r.created_at at time zone 'UTC','YYYY-MM-DD')
 then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 foreach mapping slice 1 in array array[
 ['student','n'],['group','g'],['deadline','dl'],['requirements','rq']
 ] loop
  if p_work->mapping[1] is distinct from r.payload->mapping[2] then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 end loop;
 foreach mapping slice 1 in array array[['contact','cn'],['org','org'],['notes','mn']] loop
  if p_work->'req'->mapping[1] is distinct from r.payload->mapping[2] then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 end loop;
 foreach mapping slice 1 in array array[['workType','k'],['discipline','d'],['univ','u'],['faculty','fc'],['kafedra','kf'],['city','ct'],['program','pr'],['form','fo'],['course','co'],['supervisor','s']] loop
  if p_work->'format'->mapping[1] is distinct from r.payload->mapping[2] then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 end loop;
 foreach mapping slice 1 in array array[['mTop','mt'],['mRight','mr'],['mBottom','mb'],['mLeft','ml'],['font','fn'],['size','sz'],['spacing','sp'],['indent','ind']] loop
  if p_work->'format'->mapping[1] is distinct from r.payload->'fm'->mapping[2] then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 end loop;
 if p_work#>'{req,attachments}' is distinct from to_jsonb((select count(*) from public.studkab_request_attachments a where a.request_id=p_request and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))) then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 if jsonb_typeof(p_work->'structure') is distinct from 'object' then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_work->'structure') key) is distinct from array['appendices','chapter1','chapter2','chapter3','conclusion','introduction','references'] then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 if exists(select 1 from jsonb_each(p_work->'structure') s where s.value is distinct from '{"text":"","status":"draft"}'::jsonb)
 then raise exception 'REQUEST_REASSIGNMENT_WORK'; end if;
 if exists(select 1 from jsonb_array_elements(source.data->'works') w where w#>>'{req,id}'=r.client_id or w#>>'{req,serverId}'=r.id::text)
 or exists(select 1 from jsonb_array_elements(target.data->'works') w where w->>'id'=p_work->>'id' or w#>>'{req,id}'=r.client_id or w#>>'{req,serverId}'=r.id::text)
 then raise exception 'REQUEST_REASSIGNMENT_WORK_CONFLICT'; end if;
 next_data:=jsonb_set(target.data,'{works}',(target.data->'works')||jsonb_build_array(p_work));
 if octet_length(next_data::text)>10485760 then raise exception 'REQUEST_REASSIGNMENT_CLOUD_SIZE'; end if;
 original_payload_hash:=encode(sha256(convert_to(r.payload::text,'UTF8')),'hex');
 insert into public.studkab_request_reassignments(operation_id,request_id,from_student_id,to_student_id,actor_id,reason,
 request_revision_before,request_revision_after,source_cloud_revision,target_cloud_revision_before,target_cloud_revision_after,
 work_id,work_hash,payload_hash,source_cloud_hash,target_cloud_before_hash,target_cloud_after_hash,clarification_count,clarification_snapshot)
 values(p_operation,p_request,p_from,p_to,p_actor,trim(p_reason),r.revision,r.revision+1,source.rev,target.rev,target.rev+1,
 p_work->>'id',work_hash,original_payload_hash,encode(sha256(convert_to(source.data::text,'UTF8')),'hex'),
 encode(sha256(convert_to(target.data::text,'UTF8')),'hex'),encode(sha256(convert_to(next_data::text,'UTF8')),'hex'),answer_count,answer_snapshot);
 update public.studkab_requests set student_id=p_to,revision=revision+1 where id=p_request;
 update public.studkab_requirement_passports set status='stale' where request_id=p_request and status<>'stale';
 update public.app_data set data=next_data,rev=rev+1,updated_at=clock_timestamp() where user_id=p_to and app='kabinet';
 return jsonb_build_object('reassigned',true,'duplicate',false,'requestId',r.id,'number',r.number,'requestRevision',r.revision+1,'cloudRevision',target.rev+1);
end $$;

-- Only the exact retained historical answer may satisfy a material reference.
create or replace function public.studkab_material_manifest_check(p_request uuid,p_passport uuid default null)
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
     where c.id::text=ref and c.request_id=p_request and (c.answered_by=q.student_id or exists(select 1 from public.studkab_request_reassignments history
      where history.request_id=c.request_id and history.from_student_id=c.answered_by and history.to_student_id=q.student_id
      and history.clarification_snapshot->>c.id::text=encode(sha256(convert_to((to_jsonb(c)||jsonb_build_object('created_at',extract(epoch from c.created_at),'answered_at',extract(epoch from c.answered_at)))::text,'UTF8')),'hex'))) and length(trim(c.answer))>0)
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
