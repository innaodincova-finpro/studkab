-- C-084. Private clarification history; authenticated actors are resolved by Edge.
create table public.studkab_clarifications (
 id uuid primary key,
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 item_id text not null check(item_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 question text not null check(length(trim(question)) between 1 and 2000),
 asked_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 answer text check(length(trim(answer)) between 1 and 4000),
 answer_source text check(length(trim(answer_source)) between 1 and 1000),
 answered_by uuid references auth.users(id),
 answered_at timestamptz,
 check ((answer is null and answer_source is null and answered_by is null and answered_at is null)
 or (answer is not null and answer_source is not null and answered_by is not null and answered_at is not null))
);
create index studkab_clarifications_request on public.studkab_clarifications(request_id,created_at,id);
alter table public.studkab_clarifications enable row level security;
revoke all on public.studkab_clarifications from public,anon,authenticated;
grant select,insert,update,delete on public.studkab_clarifications to service_role;

create function public.studkab_clarification_ask(p_request uuid,p_actor uuid,p_id uuid,p_item text,p_question text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.studkab_clarifications; latest public.studkab_requirement_passports;
begin
 if not exists(select 1 from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) where u.id=p_actor)
 then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then return jsonb_build_object('error','Заявка не найдена'); end if;
 select * into q from public.studkab_clarifications where id=p_id;
 if found then
  if q.request_id=p_request and q.asked_by=p_actor and q.item_id=p_item and q.question=trim(p_question) then return to_jsonb(q); end if;
  return jsonb_build_object('error','Конфликт повторной отправки вопроса');
 end if;
 select * into latest from public.studkab_requirement_passports where request_id=p_request order by revision desc limit 1;
 if not found or not exists(select 1 from jsonb_array_elements(latest.items) i where i->>'id'=p_item)
 then return jsonb_build_object('error','Откройте актуальные требования'); end if;
 if (select count(*) from public.studkab_clarifications where request_id=p_request)>=100
 then return jsonb_build_object('error','Достигнут лимит уточнений'); end if;
 insert into public.studkab_clarifications(id,request_id,item_id,question,asked_by)
 values(p_id,p_request,p_item,trim(p_question),p_actor) returning * into q;
 update public.studkab_requirement_passports set status='stale' where request_id=p_request and status='approved';
 return to_jsonb(q);
end $$;

create function public.studkab_clarification_answer(p_request uuid,p_actor uuid,p_id uuid,p_answer text,p_source text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.studkab_clarifications;
begin
 perform 1 from public.studkab_requests r where r.id=p_request and r.student_id=p_actor and r.deleting_at is null
 and exists(select 1 from public.studkab_members m where m.user_id=p_actor) for update;
 if not found then raise exception 'FORBIDDEN'; end if;
 select * into q from public.studkab_clarifications where id=p_id and request_id=p_request for update;
 if not found then return jsonb_build_object('error','Вопрос не найден'); end if;
 if q.answer is not null then
  if q.answer=trim(p_answer) and q.answer_source=trim(p_source) and q.answered_by=p_actor then return to_jsonb(q); end if;
  return jsonb_build_object('error','Ответ уже сохранён. Для исправления попросите исполнителя создать новое уточнение');
 end if;
 if p_answer is null or p_source is null then return jsonb_build_object('error','Укажите ответ и основание'); end if;
 update public.studkab_clarifications set answer=trim(p_answer),answer_source=trim(p_source),answered_by=p_actor,answered_at=now()
 where id=p_id returning * into q;
 return to_jsonb(q);
end $$;
revoke all on function public.studkab_clarification_ask(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.studkab_clarification_answer(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.studkab_clarification_ask(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.studkab_clarification_answer(uuid,uuid,uuid,text,text) to service_role;

-- The locked server gate, not a wording heuristic, owns approval.
create or replace function public.studkab_requirement_passport_approve(
 p_request uuid,p_passport uuid,p_actor uuid,p_expected_items jsonb,p_expected_fingerprint text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare selected public.studkab_requirement_passports; i jsonb; q public.studkab_clarifications;
 required_ids text[]:=array['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER'];
 key text; answer_id text;
begin
 if not exists(select 1 from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) where u.id=p_actor)
 then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then raise exception 'request_not_found'; end if;
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

  -- The three immutable-history triggers and the generation-attempt trigger are
  -- intentionally bypassed only inside this revoked, service-role-only function.
  perform set_config('session_replication_role','replica',true);
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
  delete from public.studkab_request_payload_history where request_id=p_request;
  delete from public.studkab_requests where id=p_request;
  perform set_config('session_replication_role','origin',true);

  insert into public.studkab_request_deletion_audit(request_id,actor_id,reason,deleted_counts)
  values(p_request,p_actor,trim(p_reason),v_counts)
  on conflict(request_id) do nothing;
  return jsonb_build_object('deleted',true,'absent',false,'id',p_request,'counts',v_counts);
exception when others then
  perform set_config('session_replication_role','origin',true);
  raise;
end $$;

revoke all on function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.studkab_requirement_passport_approve(uuid,uuid,uuid,jsonb,text) to service_role;
