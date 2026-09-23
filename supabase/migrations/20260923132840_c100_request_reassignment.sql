-- Empty administrative allowlist; no production identifiers or automatic grants.
create table public.studkab_request_reassignment_permissions(
 request_id uuid primary key references public.studkab_requests(id) on delete cascade,
 from_student_id uuid not null references auth.users(id),to_student_id uuid not null references auth.users(id),
 reason text not null check(length(trim(reason)) between 10 and 2000),revoked_at timestamptz,
 check(from_student_id<>to_student_id)
);
create table public.studkab_request_reassignments(
 operation_id uuid primary key,request_id uuid not null unique references public.studkab_requests(id) on delete cascade,
 from_student_id uuid not null references auth.users(id),to_student_id uuid not null references auth.users(id),
 actor_id uuid not null references auth.users(id),reason text not null,
 request_revision_before integer not null,request_revision_after integer not null,
 source_cloud_revision bigint not null,target_cloud_revision_before bigint not null,target_cloud_revision_after bigint not null,
 work_id text not null,work_hash text not null,payload_hash text not null,
 source_cloud_hash text not null,target_cloud_before_hash text not null,target_cloud_after_hash text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.studkab_request_reassignment_permissions enable row level security;
alter table public.studkab_request_reassignments enable row level security;
revoke all on public.studkab_request_reassignment_permissions,public.studkab_request_reassignments from public,anon,authenticated,service_role;
grant select on public.studkab_request_reassignments to service_role;
create function public.studkab_reassignment_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and current_user='postgres' and exists(select 1 from public.studkab_requests where id=old.request_id and deleting_at is not null) then return old; end if;
 raise exception 'REQUEST_REASSIGNMENT_IMMUTABLE';
end $$;
create trigger request_reassignment_immutable before update or delete on public.studkab_request_reassignments for each row execute function public.studkab_reassignment_immutable();

create function public.studkab_reassign_request(
 p_operation uuid,p_request uuid,p_from uuid,p_to uuid,p_actor uuid,p_reason text,
 p_expected_revision integer,p_expected_source_cloud_revision bigint,p_expected_target_cloud_revision bigint,p_work jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; permission public.studkab_request_reassignment_permissions;
 prior public.studkab_request_reassignments; source public.app_data; target public.app_data; next_data jsonb;
 work_hash text; original_payload_hash text; mapping text[];
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
 or exists(select 1 from public.studkab_clarifications where request_id=p_request)
 or exists(select 1 from public.studkab_material_revisions where request_id=p_request)
 or exists(select 1 from public.studkab_test_request_grants where request_id=p_request)
 or exists(select 1 from public.studkab_test_deliveries where request_id=p_request)
 then raise exception 'REQUEST_REASSIGNMENT_HISTORY'; end if;
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
 work_id,work_hash,payload_hash,source_cloud_hash,target_cloud_before_hash,target_cloud_after_hash)
 values(p_operation,p_request,p_from,p_to,p_actor,trim(p_reason),r.revision,r.revision+1,source.rev,target.rev,target.rev+1,
 p_work->>'id',work_hash,original_payload_hash,encode(sha256(convert_to(source.data::text,'UTF8')),'hex'),
 encode(sha256(convert_to(target.data::text,'UTF8')),'hex'),encode(sha256(convert_to(next_data::text,'UTF8')),'hex'));
 update public.studkab_requests set student_id=p_to,revision=revision+1 where id=p_request;
 update public.studkab_requirement_passports set status='stale' where request_id=p_request and status<>'stale';
 update public.app_data set data=next_data,rev=rev+1,updated_at=clock_timestamp() where user_id=p_to and app='kabinet';
 return jsonb_build_object('reassigned',true,'duplicate',false,'requestId',r.id,'number',r.number,'requestRevision',r.revision+1,'cloudRevision',target.rev+1);
end $$;
revoke all on function public.studkab_reassign_request(uuid,uuid,uuid,uuid,uuid,text,integer,bigint,bigint,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.studkab_reassignment_immutable() from public,anon,authenticated;
grant execute on function public.studkab_reassignment_immutable() to service_role;

-- Preserve upload authorship and require an explicit material cycle.
create or replace function public.studkab_attachment_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; active_cycle uuid;
begin
 -- Same request row lock as passport save, payload update and deletion.
 select * into r from public.studkab_requests where id=new.request_id for update;
 if not found or r.deleting_at is not null or r.student_id<>new.student_id then raise exception 'Attachment request unavailable'; end if;
 select id into active_cycle from public.studkab_material_revisions where request_id=r.id and closed_at is null;
 if new.material_revision_id is distinct from active_cycle then raise exception 'Material revision changed'; end if;
 if exists(select 1 from public.studkab_gen_jobs where request_id=r.id::text)
 or exists(select 1 from public.studkab_result_versions where request_id=r.id)
 or exists(select 1 from public.studkab_results where request_id=r.id)
 or ((exists(select 1 from public.studkab_requirement_passports where request_id=r.id and status='approved')
      or exists(select 1 from public.studkab_material_revisions where request_id=r.id)
      or exists(select 1 from public.studkab_request_reassignments where request_id=r.id))
     and not exists(select 1 from public.studkab_material_revisions where request_id=r.id and closed_at is null))
 then raise exception 'Preparation already started'; end if;
 if not exists(select 1 from public.studkab_members where user_id=new.student_id)
 then raise exception 'Attachment author unavailable'; end if;
 if (select count(*) from public.studkab_request_attachments where request_id=new.request_id)>=200
 then raise exception 'Attachment history limit'; end if;
 if new.supersedes is not null then
  if not exists(select 1 from public.studkab_request_attachments a where a.id=new.supersedes
    and a.request_id=new.request_id and a.category=new.category
    and (a.student_id=new.student_id or exists(select 1 from public.studkab_request_reassignments x where x.request_id=new.request_id and x.from_student_id=a.student_id and x.to_student_id=new.student_id))
    and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))
  then raise exception 'Attachment version conflict'; end if;
 elsif exists(select 1 from public.studkab_request_attachments a where a.request_id=new.request_id
    and a.category=new.category and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))
 then raise exception 'Explicit replacement required';
 end if;
 if new.supersedes is null and (select count(*) from public.studkab_request_attachments a
   where a.request_id=new.request_id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))>=8
 then raise exception 'Attachment limit'; end if;
 update public.studkab_requests set revision=revision+1 where id=new.request_id;
 return new;
end $$;

create or replace function public.studkab_requirement_passport_save(
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
 if (p_expected_revision is not null or exists(select 1 from public.studkab_material_revisions where request_id=p_request) or exists(select 1 from public.studkab_request_reassignments where request_id=p_request))
 and p_expected_revision is distinct from (select revision from public.studkab_requests where id=p_request)
 then return jsonb_build_object('error','Материалы изменились. Откройте паспорт заново'); end if;
 select coalesce(max(revision),0)+1 into next_revision from public.studkab_requirement_passports where request_id=p_request;
 insert into public.studkab_requirement_passports(request_id,revision,title,summary,items,source_fingerprint,created_by,material_manifest)
 values(p_request,next_revision,p_title,p_summary,p_items,p_source_fingerprint,p_actor,p_material_manifest) returning * into created;
 return to_jsonb(created);
end $$;

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
 if (p_expected_revision is not null or exists(select 1 from public.studkab_material_revisions where request_id=p_request) or exists(select 1 from public.studkab_request_reassignments where request_id=p_request))
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

create or replace function public.update_studkab_request(
  p_request uuid,p_student uuid,p_expected jsonb,p_content jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests;
begin
 select * into r from public.studkab_requests where id=p_request and student_id=p_student for update;
 if not found or r.deleting_at is not null then return jsonb_build_object('missing',true); end if;
 if p_content->>'id' is distinct from r.client_id then return jsonb_build_object('conflict',true); end if;
 if r.payload=p_content then return jsonb_build_object('id',r.id,'number',r.number,'duplicate',true); end if;
 if r.payload is distinct from p_expected then return jsonb_build_object('conflict',true); end if;
 if exists(select 1 from public.studkab_request_reassignments where request_id=r.id)
 or exists(select 1 from public.studkab_requirement_passports where request_id=r.id and status='approved')
 or exists(select 1 from public.studkab_gen_jobs where request_id=r.id::text)
 or exists(select 1 from public.studkab_result_versions where request_id=r.id)
 or exists(select 1 from public.studkab_results where request_id=r.id)
 or exists(select 1 from public.studkab_material_revisions where request_id=r.id)
 then return jsonb_build_object('locked',true); end if;
 insert into public.studkab_request_payload_history(request_id,payload) values(r.id,r.payload);
 update public.studkab_requests set payload=p_content,revision=revision+1 where id=r.id;
 return jsonb_build_object('id',r.id,'number',r.number,'duplicate',false);
end $$;

create or replace function public.studkab_material_revision_state(p_request uuid,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; c public.studkab_material_revisions; executor boolean; blocked boolean; has_passport boolean; state text;
begin
 select * into r from public.studkab_requests where id=p_request and deleting_at is null;
 if not found then return jsonb_build_object('error','Заявка не найдена'); end if;
 select exists(select 1 from auth.users u join public.studkab_request_config cfg on lower(u.email)=lower(cfg.executor_email) where u.id=p_actor) into executor;
 if not executor and (r.student_id is distinct from p_actor or not exists(select 1 from public.studkab_members where user_id=p_actor))
 then return jsonb_build_object('error','Заявка не найдена'); end if;
 select * into c from public.studkab_material_revisions where request_id=p_request order by opened_revision desc limit 1;
 blocked:=exists(select 1 from public.studkab_gen_jobs where request_id=p_request::text)
 or exists(select 1 from public.studkab_result_versions where request_id=p_request)
 or exists(select 1 from public.studkab_results where request_id=p_request);
 has_passport:=exists(select 1 from public.studkab_requirement_passports where request_id=p_request and status='approved');
 state:=case when c.id is not null and c.closed_at is null then 'open'
 when has_passport or blocked or c.id is not null or exists(select 1 from public.studkab_request_reassignments where request_id=p_request) then 'locked' else 'initial' end;
 return jsonb_build_object('materials',jsonb_build_object('state',state,'requestRevision',r.revision,
 'cycleId',c.id,'reason',c.reason,'canUpload',not executor and not blocked and state in ('initial','open'),
 'canReopen',executor and not blocked and state='locked',
 'canComplete',not executor and r.student_id=p_actor and state='open' and not blocked,
 'blockingReason',case when blocked then 'Возврат недоступен: подготовка результата уже началась'
 when state='open' then 'Ожидается завершение дополнения материалов студентом' else null end));
end $$;

create or replace function public.studkab_material_revision_open(p_request uuid,p_actor uuid,p_cycle uuid,p_reason text,p_expected integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; c public.studkab_material_revisions;
begin
 if not exists(select 1 from auth.users u join public.studkab_request_config cfg on lower(u.email)=lower(cfg.executor_email) where u.id=p_actor)
 then raise exception 'FORBIDDEN'; end if;
 if p_cycle is null or p_expected is null or p_expected<0 or p_reason is null or length(trim(p_reason)) not between 10 and 500
 then return jsonb_build_object('error','Укажите причину возврата и актуальную версию заявки'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 select * into r from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then return jsonb_build_object('error','Заявка не найдена'); end if;
 select * into c from public.studkab_material_revisions where id=p_cycle;
 if found then
  if c.request_id=p_request and c.opened_by=p_actor and c.reason=trim(p_reason) and c.opened_revision=p_expected+1
  then return public.studkab_material_revision_state(p_request,p_actor); end if;
  return jsonb_build_object('error','Конфликт повторного возврата');
 end if;
 if r.revision<>p_expected then return jsonb_build_object('error','Заявка изменилась. Обновите материалы'); end if;
 if exists(select 1 from public.studkab_gen_jobs where request_id=p_request::text)
 or exists(select 1 from public.studkab_result_versions where request_id=p_request)
 or exists(select 1 from public.studkab_results where request_id=p_request)
 then return jsonb_build_object('error','Возврат недоступен: подготовка результата уже началась'); end if;
 if exists(select 1 from public.studkab_material_revisions where request_id=p_request and closed_at is null)
 then return jsonb_build_object('error','Дополнение материалов уже открыто'); end if;
 if not exists(select 1 from public.studkab_requirement_passports where request_id=p_request and status='approved')
 and not exists(select 1 from public.studkab_material_revisions where request_id=p_request)
 and not exists(select 1 from public.studkab_request_reassignments where request_id=p_request)
 then return jsonb_build_object('error','Материалы ещё доступны автору без возврата'); end if;
 if (select count(*) from public.studkab_material_revisions where request_id=p_request)>=100
 then return jsonb_build_object('error','Достигнут лимит возвратов'); end if;
 insert into public.studkab_material_revisions(id,request_id,opened_by,reason,opened_revision)
 values(p_cycle,p_request,p_actor,trim(p_reason),r.revision+1);
 update public.studkab_requirement_passports set status='stale' where request_id=p_request and status<>'stale';
 update public.studkab_requests set revision=revision+1 where id=p_request;
 return public.studkab_material_revision_state(p_request,p_actor);
end $$;
