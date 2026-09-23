-- C-096: explicit owner material revision, only before any generated/result history.
begin;
create table public.studkab_material_revisions (
 id uuid primary key,
 request_id uuid not null references public.studkab_requests(id),
 opened_by uuid not null references auth.users(id),
 reason text not null check(length(trim(reason)) between 10 and 500),
 opened_revision integer not null,
 opened_at timestamptz not null default clock_timestamp(),
 closed_by uuid references auth.users(id),
 closed_revision integer,
 closed_at timestamptz,
 check ((closed_at is null and closed_by is null and closed_revision is null)
     or (closed_at is not null and closed_by is not null and closed_revision>opened_revision))
);
create unique index studkab_material_revision_open on public.studkab_material_revisions(request_id) where closed_at is null;
alter table public.studkab_material_revisions enable row level security;
revoke all on public.studkab_material_revisions from public,anon,authenticated;
grant select,insert,update on public.studkab_material_revisions to service_role;
-- Existing input rows remain unchanged (NULL = original intake).
alter table public.studkab_request_attachments add column material_revision_id uuid references public.studkab_material_revisions(id);

create function public.studkab_material_revision_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if current_user='postgres' and exists(select 1 from public.studkab_requests where id=old.request_id and deleting_at is not null)
  then return old; end if;
  raise exception 'Immutable material revision history';
 end if;
 if old.closed_at is not null or new.closed_at is null
 or (new.id,new.request_id,new.opened_by,new.reason,new.opened_revision,new.opened_at)
 is distinct from (old.id,old.request_id,old.opened_by,old.reason,old.opened_revision,old.opened_at)
 then raise exception 'Immutable material revision history'; end if;
 return new;
end $$;
create trigger material_revision_immutable before update or delete on public.studkab_material_revisions
for each row execute function public.studkab_material_revision_immutable();

create function public.studkab_material_revision_state(p_request uuid,p_actor uuid)
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
 when has_passport or blocked or c.id is not null then 'locked' else 'initial' end;
 return jsonb_build_object('materials',jsonb_build_object('state',state,'requestRevision',r.revision,
 'cycleId',c.id,'reason',c.reason,'canUpload',not executor and not blocked and state in ('initial','open'),
 'canReopen',executor and not blocked and state='locked',
 'canComplete',not executor and r.student_id=p_actor and state='open' and not blocked,
 'blockingReason',case when blocked then 'Возврат недоступен: подготовка результата уже началась'
 when state='open' then 'Ожидается завершение дополнения материалов студентом' else null end));
end $$;

create function public.studkab_material_revision_open(p_request uuid,p_actor uuid,p_cycle uuid,p_reason text,p_expected integer)
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
 then return jsonb_build_object('error','Материалы ещё доступны автору без возврата'); end if;
 if (select count(*) from public.studkab_material_revisions where request_id=p_request)>=100
 then return jsonb_build_object('error','Достигнут лимит возвратов'); end if;
 insert into public.studkab_material_revisions(id,request_id,opened_by,reason,opened_revision)
 values(p_cycle,p_request,p_actor,trim(p_reason),r.revision+1);
 update public.studkab_requirement_passports set status='stale' where request_id=p_request and status<>'stale';
 update public.studkab_requests set revision=revision+1 where id=p_request;
 return public.studkab_material_revision_state(p_request,p_actor);
end $$;

create function public.studkab_material_revision_complete(p_request uuid,p_actor uuid,p_cycle uuid,p_expected integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; c public.studkab_material_revisions;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 select * into r from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found or r.student_id is distinct from p_actor or not exists(select 1 from public.studkab_members where user_id=p_actor)
 or exists(select 1 from auth.users u join public.studkab_request_config cfg on lower(u.email)=lower(cfg.executor_email) where u.id=p_actor)
 then raise exception 'FORBIDDEN'; end if;
 select * into c from public.studkab_material_revisions where id=p_cycle and request_id=p_request;
 if not found then return jsonb_build_object('error','Возврат материалов не найден'); end if;
 if c.closed_at is not null then
  if c.closed_by=p_actor and c.closed_revision=p_expected+1 then return public.studkab_material_revision_state(p_request,p_actor); end if;
  return jsonb_build_object('error','Конфликт повторного завершения');
 end if;
 if p_expected is null or r.revision<>p_expected then return jsonb_build_object('error','Заявка изменилась. Обновите материалы'); end if;
 if exists(select 1 from public.studkab_gen_jobs where request_id=p_request::text)
 or exists(select 1 from public.studkab_result_versions where request_id=p_request)
 or exists(select 1 from public.studkab_results where request_id=p_request)
 then return jsonb_build_object('error','Подготовка результата уже началась'); end if;
 update public.studkab_material_revisions set closed_by=p_actor,closed_revision=r.revision+1,closed_at=clock_timestamp() where id=p_cycle;
 update public.studkab_requests set revision=revision+1 where id=p_request;
 return public.studkab_material_revision_state(p_request,p_actor);
end $$;

-- Gates on actual inserts also cover direct service-role callers, after locking request.
create function public.studkab_material_revision_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare rid uuid; r public.studkab_requests; p public.studkab_requirement_passports; context jsonb;
begin
 rid:=new.request_id::uuid;
 select * into r from public.studkab_requests where id=rid for share;
 if not found or r.deleting_at is not null then raise exception 'Request unavailable'; end if;
 if exists(select 1 from public.studkab_material_revisions where request_id=rid and closed_at is null)
 then raise exception 'MATERIAL_REVISION_OPEN'; end if;
 if tg_table_name='studkab_gen_jobs' then
  select * into p from public.studkab_requirement_passports where request_id=rid order by revision desc limit 1;
  if p.id is null or p.status<>'approved' or p.id is distinct from new.passport_id
  then raise exception 'PASSPORT_REQUIRED'; end if;
 elsif exists(select 1 from public.studkab_material_revisions where request_id=rid) then
  select * into p from public.studkab_requirement_passports where request_id=rid order by revision desc limit 1;
  context:=new.document->'reviewContext';
  if p.id is null or p.status<>'approved' or context is null
  or p.id::text is distinct from context->>'passportId'
  or p.source_fingerprint is distinct from context->>'sourceFingerprint'
  then raise exception 'Review passport changed'; end if;
 end if;
 return new;
end $$;
create trigger gen_material_revision_guard before insert on public.studkab_gen_jobs for each row execute function public.studkab_material_revision_guard();
create trigger result_material_revision_guard before insert on public.studkab_result_versions for each row execute function public.studkab_material_revision_guard();

create function public.studkab_passport_material_revision_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status in ('draft','approved') then
  perform 1 from public.studkab_requests where id=new.request_id and deleting_at is null for update;
  if not found then raise exception 'request_not_found'; end if;
  if exists(select 1 from public.studkab_material_revisions where request_id=new.request_id and closed_at is null)
  then raise exception 'MATERIAL_REVISION_OPEN'; end if;
 end if;
 return new;
end $$;
create trigger passport_material_revision_guard before insert or update on public.studkab_requirement_passports
for each row execute function public.studkab_passport_material_revision_guard();
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
      or exists(select 1 from public.studkab_material_revisions where request_id=r.id))
     and not exists(select 1 from public.studkab_material_revisions where request_id=r.id and closed_at is null))
 then raise exception 'Preparation already started'; end if;
 if not exists(select 1 from public.studkab_members where user_id=new.student_id)
 then raise exception 'Attachment author unavailable'; end if;
 if (select count(*) from public.studkab_request_attachments where request_id=new.request_id)>=200
 then raise exception 'Attachment history limit'; end if;
 if new.supersedes is not null then
  if not exists(select 1 from public.studkab_request_attachments a where a.id=new.supersedes
    and a.request_id=new.request_id and a.category=new.category and a.student_id=new.student_id
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

alter function public.delete_studkab_request(uuid,uuid,text) owner to postgres;
revoke all on function public.delete_studkab_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.delete_studkab_request(uuid,uuid,text) to service_role;


revoke all on function public.studkab_material_revision_immutable(),public.studkab_material_revision_guard(),public.studkab_passport_material_revision_guard(),public.studkab_material_revision_state(uuid,uuid),public.studkab_material_revision_open(uuid,uuid,uuid,text,integer),public.studkab_material_revision_complete(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.studkab_material_revision_immutable(),public.studkab_material_revision_guard(),public.studkab_passport_material_revision_guard(),public.studkab_material_revision_state(uuid,uuid),public.studkab_material_revision_open(uuid,uuid,uuid,text,integer),public.studkab_material_revision_complete(uuid,uuid,uuid,integer) to service_role;
-- Remove old overloads: omitted revision remains compatible only before any cycle.
drop function public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text);
drop function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text);
create function public.studkab_requirement_passport_save(
 p_request uuid,p_actor uuid,p_title text,p_summary text,p_items jsonb,p_source_fingerprint text,p_expected_revision integer default null
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
 insert into public.studkab_requirement_passports(request_id,revision,title,summary,items,source_fingerprint,created_by)
 values(p_request,next_revision,p_title,p_summary,p_items,p_source_fingerprint,p_actor) returning * into created;
 return to_jsonb(created);
end $$;

create or replace function public.studkab_requirement_passport_approve(
 p_request uuid,p_passport uuid,p_actor uuid,p_expected_items jsonb,p_expected_fingerprint text,p_expected_revision integer default null
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

-- Preserve C-079/C-080 explicit graph cleanup.

revoke all on function public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text,integer),public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.studkab_requirement_passport_save(uuid,uuid,text,text,jsonb,text,integer),public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text,integer) to service_role;

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
 if exists(select 1 from public.studkab_requirement_passports where request_id=r.id and status='approved')
 or exists(select 1 from public.studkab_gen_jobs where request_id=r.id::text)
 or exists(select 1 from public.studkab_result_versions where request_id=r.id)
 or exists(select 1 from public.studkab_results where request_id=r.id)
 or exists(select 1 from public.studkab_material_revisions where request_id=r.id)
 then return jsonb_build_object('locked',true); end if;
 insert into public.studkab_request_payload_history(request_id,payload) values(r.id,r.payload);
 update public.studkab_requests set payload=p_content,revision=revision+1 where id=r.id;
 return jsonb_build_object('id',r.id,'number',r.number,'duplicate',false);
end $$;
revoke all on function public.update_studkab_request(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.update_studkab_request(uuid,uuid,jsonb,jsonb) to service_role;


commit;
