-- The read-only context is SECURITY DEFINER solely to lock SELECT-only grant/member
-- rows without granting service_role administrative UPDATE. Actor/owner checks remain.
-- Explicit administrator grant; never inferred from titles or browser flags.
create table public.studkab_test_request_grants(
 request_id uuid primary key references public.studkab_requests(id) on delete cascade,
 recipient_id uuid not null references auth.users(id),
 reason text not null check(length(trim(reason)) between 10 and 2000),
 granted_at timestamptz not null default clock_timestamp(),revoked_at timestamptz
);
create table public.studkab_test_deliveries(
 id uuid primary key,request_id uuid not null references public.studkab_requests(id) on delete cascade,
 version_id uuid not null references public.studkab_result_versions(id) on delete cascade,
 recipient_id uuid not null references auth.users(id),
 file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),document_hash text not null check(document_hash ~ '^[a-f0-9]{64}$'),
 passport_id uuid not null references public.studkab_requirement_passports(id),source_fingerprint text not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 quality_status text not null default 'incomplete' check(quality_status='incomplete')
);
alter table public.studkab_test_request_grants enable row level security;
alter table public.studkab_test_deliveries enable row level security;
revoke all on public.studkab_test_request_grants,public.studkab_test_deliveries from public,anon,authenticated,service_role;
grant select on public.studkab_test_request_grants to service_role;
grant select,insert on public.studkab_test_deliveries to service_role;
create index studkab_test_deliveries_request on public.studkab_test_deliveries(request_id,created_at desc,id);

create function public.studkab_test_delivery_context(p_request uuid,p_actor uuid,p_executor_only boolean default true)
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
 if p.status is distinct from 'approved' or v.id is null or v.recipient_id<>r.student_id or v.document#>>'{reviewContext,passportId}' is distinct from p.id::text
 or v.document#>>'{reviewContext,sourceFingerprint}' is distinct from p.source_fingerprint
 then return jsonb_build_object('eligible',false,'reason','TEST_VERSION_CHANGED'); end if;
 return jsonb_build_object('eligible',true,'reason','','versionId',v.id,'recipientId',r.student_id,'fileHash',v.file_hash,
 'documentHash',v.document_hash,'passportId',p.id,'sourceFingerprint',p.source_fingerprint);
end $$;

create function public.studkab_test_delivery_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare c jsonb;
begin
 if tg_op='DELETE' then
  if current_user='postgres' and exists(select 1 from public.studkab_requests where id=old.request_id and deleting_at is not null) then return old; end if;
  raise exception 'TEST_DELIVERY_IMMUTABLE';
 elsif tg_op='UPDATE' then raise exception 'TEST_DELIVERY_IMMUTABLE'; end if;
 c:=public.studkab_test_delivery_context(new.request_id,new.created_by,true);
 if c->>'eligible' is distinct from 'true' then raise exception 'TEST_DELIVERY_UNAVAILABLE'; end if;
 if new.version_id::text is distinct from c->>'versionId' or new.recipient_id::text is distinct from c->>'recipientId'
 or new.file_hash is distinct from c->>'fileHash' or new.document_hash is distinct from c->>'documentHash'
 or new.passport_id::text is distinct from c->>'passportId' or new.source_fingerprint is distinct from c->>'sourceFingerprint'
 then raise exception 'TEST_VERSION_CHANGED'; end if;
 return new;
end $$;
create trigger test_delivery_guard before insert or update or delete on public.studkab_test_deliveries for each row execute function public.studkab_test_delivery_guard();

create function public.studkab_test_deliver(p_request uuid,p_actor uuid,p_delivery uuid,p_version uuid,p_recipient uuid,p_file_hash text,p_document_hash text,p_passport uuid,p_source_fingerprint text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c jsonb; d public.studkab_test_deliveries;
begin
 c:=public.studkab_test_delivery_context(p_request,p_actor,true);
 if c->>'eligible' is distinct from 'true' then return jsonb_build_object('error',c->>'reason'); end if;
 if p_version::text is distinct from c->>'versionId' or p_recipient::text is distinct from c->>'recipientId'
 or p_file_hash is distinct from c->>'fileHash' or p_document_hash is distinct from c->>'documentHash'
 or p_passport::text is distinct from c->>'passportId' or p_source_fingerprint is distinct from c->>'sourceFingerprint'
 then return jsonb_build_object('error','TEST_VERSION_CHANGED'); end if;
 select * into d from public.studkab_test_deliveries where id=p_delivery;
 if found then
  if d.request_id<>p_request or d.created_by<>p_actor or d.version_id<>p_version or d.recipient_id<>p_recipient
  or d.file_hash<>p_file_hash or d.document_hash<>p_document_hash or d.passport_id<>p_passport or d.source_fingerprint<>p_source_fingerprint
  then return jsonb_build_object('error','TEST_OPERATION_CONFLICT'); end if;
 else
  insert into public.studkab_test_deliveries(id,request_id,version_id,recipient_id,file_hash,document_hash,passport_id,source_fingerprint,created_by)
  values(p_delivery,p_request,p_version,p_recipient,p_file_hash,p_document_hash,p_passport,p_source_fingerprint,p_actor) returning * into d;
 end if;
 return jsonb_build_object('deliveryId',d.id,'versionId',d.version_id,'createdAt',d.created_at,'qualityStatus','incomplete','label','Тестовый файл — проверка качества не завершена');
end $$;

create function public.studkab_test_result(p_request uuid,p_actor uuid,p_include_file boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare c jsonb; d public.studkab_test_deliveries; file text;
begin
 c:=public.studkab_test_delivery_context(p_request,p_actor,false);
 if c->>'eligible' is distinct from 'true' then return jsonb_build_object('error',c->>'reason'); end if;
 select * into d from public.studkab_test_deliveries where request_id=p_request order by created_at desc,id desc limit 1;
 if not found then return jsonb_build_object('testDelivery',null); end if;
 if d.version_id::text is distinct from c->>'versionId' or d.recipient_id::text is distinct from c->>'recipientId'
 or d.file_hash is distinct from c->>'fileHash' or d.document_hash is distinct from c->>'documentHash'
 or d.passport_id::text is distinct from c->>'passportId' or d.source_fingerprint is distinct from c->>'sourceFingerprint'
 then
  if not p_include_file and exists(select 1 from auth.users u join public.studkab_request_config cfg on lower(cfg.executor_email)=lower(u.email) where u.id=p_actor) then return jsonb_build_object('testDelivery',null); end if;
  return jsonb_build_object('error','TEST_VERSION_CHANGED');
 end if;
 if p_include_file then select docx_base64 into file from public.studkab_result_versions where id=d.version_id; end if;
 return jsonb_build_object('testDelivery',(c-'eligible'-'reason')||jsonb_build_object('deliveryId',d.id,'createdAt',d.created_at,
 'qualityStatus','incomplete','label','Тестовый файл — проверка качества не завершена')||case when p_include_file then jsonb_build_object('docxBase64',file) else '{}'::jsonb end);
end $$;
revoke all on function public.studkab_test_delivery_context(uuid,uuid,boolean),public.studkab_test_delivery_guard(),public.studkab_test_deliver(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text),public.studkab_test_result(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.studkab_test_delivery_context(uuid,uuid,boolean),public.studkab_test_delivery_guard(),public.studkab_test_deliver(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text),public.studkab_test_result(uuid,uuid,boolean) to service_role;

-- Preserve prepared deletion and count the separate test history before cascades.
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
  delete from public.studkab_requests where id=p_request;

  insert into public.studkab_request_deletion_audit(request_id,actor_id,reason,deleted_counts)
  values(p_request,p_actor,trim(p_reason),v_counts)
  on conflict(request_id) do nothing;
  return jsonb_build_object('deleted',true,'absent',false,'id',p_request,'counts',v_counts);
end $$;
