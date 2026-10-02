-- ROUTE-02-C3: proposals stay private until executor publishes exact wording.
create table public.studkab_question_proposals (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 analysis_id uuid not null references public.studkab_intake_analysis_jobs(id),
 item_id text not null check(item_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 question text not null check(length(question) between 1 and 2000),
 reason text not null, evidence jsonb not null,
 state text not null default 'pending' check(state in ('pending','published','returned')),
 decided_by uuid references auth.users(id),decided_at timestamptz,
 published_text text,return_comment text,
 restudy_analysis_id uuid references public.studkab_intake_analysis_jobs(id),restudy_reason text,
 created_at timestamptz not null default now(),
 unique(analysis_id,item_id),
 check((state='pending' and decided_by is null and decided_at is null and published_text is null and return_comment is null)
 or (state='published' and decided_by is not null and decided_at is not null and length(published_text) between 1 and 2000 and return_comment is null)
 or (state='returned' and decided_by is not null and decided_at is not null and published_text is null and length(return_comment) between 10 and 1000))
);
create index studkab_question_proposals_request on public.studkab_question_proposals(request_id,created_at,id);
alter table public.studkab_question_proposals enable row level security;
revoke all on public.studkab_question_proposals from public,anon,authenticated,service_role;
grant select,insert,update on public.studkab_question_proposals to service_role;
create or replace function public.studkab_registered_analysis_source(p_request uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('requestId',r.id,'requestRevision',r.revision,'studentId',r.student_id,
 'deadline',r.payload->>'dl','notes',d.notes,'draftId',d.id,
 'reviewInstructions',coalesce((select jsonb_agg(jsonb_build_object('proposalId',q.id,'itemId',q.item_id,'comment',q.return_comment) order by q.decided_at,q.id)
 from public.studkab_question_proposals q where q.request_id=r.id and q.state='returned'),'[]'::jsonb),
 'studentAnswers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'question',c.question,'answer',c.answer,'source',c.answer_source,'author',c.answered_by) order by c.answered_at,c.id)
 from public.studkab_clarifications c where c.request_id=r.id and c.answered_at is not null),'[]'::jsonb),
 'files',coalesce((select jsonb_agg(jsonb_build_object(
 'id',f.id,'file_name',f.file_name,'file_hash',f.file_hash,'state',f.state,
 'read_status',f.read_status,'read_version',f.read_version,'read_result',f.read_result,
 'attachmentId',a.id,'storagePath',a.storage_path,
 'registeredReadRequest',f.registered_read_request,'registeredReadRevision',f.registered_read_revision) order by f.created_at,f.id)
 from public.studkab_request_attachments a join public.studkab_intake_files f on f.id=a.intake_file_id
 where a.request_id=r.id and a.student_id=r.student_id and f.draft_id=d.id
 and f.state='saved' and a.file_hash=f.file_hash and a.storage_path=f.storage_path
 and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id)), '[]'::jsonb))
 from public.studkab_requests r join public.studkab_intake_drafts d on d.submitted_request_id=r.id
 where r.id=p_request and r.intake_received and r.ready_at is not null and r.deleting_at is null
 and d.state='submitted' and d.student_id=r.student_id and d.submitted_request_revision=r.revision
 and exists(select 1 from public.studkab_members m where m.user_id=r.student_id)
 -- Every current attachment must be a matching original from this saved submission.
 and not exists(select 1 from public.studkab_request_attachments a
 left join public.studkab_intake_files f on f.id=a.intake_file_id
 where a.request_id=r.id and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id)
 and (a.student_id is distinct from r.student_id or f.draft_id is distinct from d.id
 or f.state is distinct from 'saved' or a.file_hash is distinct from f.file_hash
 or a.storage_path is distinct from f.storage_path or (f.read_status='ready' and (
 (f.registered_read_request is not null and (f.registered_read_request is distinct from r.id or f.registered_read_revision is distinct from r.revision))
 or f.read_result->>'fileId' is distinct from f.id::text or f.read_result->>'fileHash' is distinct from f.file_hash))))
$$;
create function public.studkab_registered_questions_refresh(p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb;j public.studkab_intake_analysis_jobs;field record;key text; evidence jsonb;
begin
 perform 1 from public.studkab_requests where id=p_request for update;
 src=public.studkab_registered_analysis_source(p_request);if src is null then return jsonb_build_object('stale',true);end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid and manifest=encode(sha256(convert_to(src::text,'UTF8')),'hex') and version='intake-analysis-2' and state='done';
 if not found then return jsonb_build_object('unavailable',true);end if;
 -- Only grounded ambiguity generates a proposal. Missing header fields do not.
 for field in select * from jsonb_each(j.result->'fields') loop
  if field.value->>'status' not in ('conflict','needs_review') then continue;end if;
  key='FIELD_'||field.key;evidence=field.value->'values';
  -- An attributed answer requires executor review, not the same repeated question.
  if exists(select 1 from public.studkab_clarifications c where c.request_id=p_request and c.item_id=key and c.answered_at is not null) then continue;end if;
  if jsonb_typeof(evidence) is distinct from 'array' or jsonb_array_length(evidence)=0
  or exists(select 1 from jsonb_array_elements(evidence) e where jsonb_typeof(e->'refs') is distinct from 'array' or jsonb_array_length(e->'refs')=0) then continue;end if;
  insert into public.studkab_question_proposals(request_id,analysis_id,item_id,question,reason,evidence)
  values(p_request,j.id,key,'Уточните, какое условие по пункту «'||left(field.value->>'label',100)||'» применяется к вашей работе. Укажите документ, страницу или пояснение преподавателя.',
  case when field.value->>'status'='conflict' then 'В изученном комплекте обнаружены разные значения. До подготовки нужно проверить применимое условие.' else 'В документе условие задано с ограничением применимости. Нужно проверить, относится ли оно к этой работе.' end,evidence)
  on conflict(analysis_id,item_id) do nothing;
 end loop;
 update public.studkab_question_proposals q set restudy_analysis_id=j.id,
 restudy_reason=case when exists(select 1 from public.studkab_question_proposals next where next.analysis_id=j.id and next.item_id=q.item_id)
 then 'После повторного изучения неоднозначность сохранилась. Новое предложение требует отдельного решения исполнителя.'
 else 'Повторный анализ текущего комплекта не обнаружил прежней неоднозначности. Вывод и источники требуют проверки исполнителя.' end
 where q.request_id=p_request and q.state='returned' and q.analysis_id<>j.id and q.restudy_analysis_id is distinct from j.id;
 update public.studkab_question_proposals q set restudy_analysis_id=j.id,
 restudy_reason='Ответ студента включён в повторное изучение текущего комплекта. Исполнитель должен сверить применимое условие и учесть ответ в новой версии требований; тот же вопрос автоматически не отправляется.'
 where q.request_id=p_request and q.state='published' and q.analysis_id<>j.id
 and exists(select 1 from public.studkab_clarifications c where c.id=q.id and c.answered_at is not null)
 and q.restudy_analysis_id is distinct from j.id;
 return jsonb_build_object('analysisId',j.id,'proposals',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at,q.id) from public.studkab_question_proposals q where q.request_id=p_request),'[]'::jsonb));
end $$;
create function public.studkab_registered_question_decide(p_request uuid,p_actor uuid,p_proposal uuid,p_decision text,p_text text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb;q public.studkab_question_proposals;j public.studkab_intake_analysis_jobs;
begin
 if not exists(select 1 from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) where u.id=p_actor) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then return jsonb_build_object('stale',true);end if;
 select * into q from public.studkab_question_proposals where id=p_proposal and request_id=p_request for update;
 if not found then return jsonb_build_object('missing',true);end if;
 if p_decision not in ('publish','return') or p_decision is null or p_text is null or p_text<>btrim(p_text)
 or length(p_text)<(case when p_decision='return' then 10 else 1 end)
 or length(p_text)>(case when p_decision='return' then 1000 else 2000 end) then return jsonb_build_object('invalid',true);end if;
 if q.state<>'pending' then
  if q.decided_by=p_actor and ((q.state='published' and p_decision='publish' and q.published_text=p_text) or (q.state='returned' and p_decision='return' and q.return_comment=p_text)) then return to_jsonb(q)||jsonb_build_object('duplicate',true);end if;
  return jsonb_build_object('conflict',true);
 end if;
 src=public.studkab_registered_analysis_source(p_request);
 select * into j from public.studkab_intake_analysis_jobs where id=q.analysis_id;
 if src is null or j.state<>'done' or j.manifest is distinct from encode(sha256(convert_to(src::text,'UTF8')),'hex') then return jsonb_build_object('stale',true);end if;
 if p_decision='publish' then
  if (select count(*) from public.studkab_clarifications where request_id=p_request)>=100 then return jsonb_build_object('limited',true);end if;
  insert into public.studkab_clarifications(id,request_id,item_id,question,asked_by) values(q.id,p_request,q.item_id,p_text,p_actor);
  update public.studkab_requirement_passports set status='stale' where request_id=p_request and status='approved';
 else
  if (select count(*) from public.studkab_question_proposals where request_id=p_request and state='returned')>=20 then return jsonb_build_object('limited',true);end if;
 end if;
 update public.studkab_question_proposals set state=case when p_decision='publish' then 'published' else 'returned' end,
 decided_by=p_actor,decided_at=clock_timestamp(),published_text=case when p_decision='publish' then p_text end,
 return_comment=case when p_decision='return' then p_text end where id=q.id returning * into q;
 return to_jsonb(q);
end $$;
revoke all on function public.studkab_registered_questions_refresh(uuid),public.studkab_registered_question_decide(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.studkab_registered_questions_refresh(uuid),public.studkab_registered_question_decide(uuid,uuid,uuid,text,text) to service_role;

create function public.studkab_question_proposal_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.request_id,new.analysis_id,new.item_id,new.question,new.reason,new.evidence,new.created_at) is distinct from
 (old.id,old.request_id,old.analysis_id,old.item_id,old.question,old.reason,old.evidence,old.created_at)
 or (old.state<>'pending' and (new.state,new.decided_by,new.decided_at,new.published_text,new.return_comment) is distinct from
 (old.state,old.decided_by,old.decided_at,old.published_text,old.return_comment)) then raise exception 'IMMUTABLE_QUESTION_PROPOSAL';end if;
 return new;
end $$;
create trigger immutable_question_proposal before update on public.studkab_question_proposals for each row execute function public.studkab_question_proposal_immutable();
revoke all on function public.studkab_question_proposal_immutable() from public,anon,authenticated;
