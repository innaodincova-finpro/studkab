begin;

alter table public.studkab_request_payload_history
 add column correction_operation uuid unique,
 add column correction_actor uuid,
 add column correction_assignment uuid,
 add column correction_reason text,
 add column correction_new_kind text,
 add column correction_revision_before integer;

create function public.studkab_request_kind_correct(
 p_operation uuid,p_request uuid,p_actor uuid,p_assignment uuid,
 p_expected_revision integer,p_expected_kind text,p_new_kind text,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; a public.studkab_request_attachments; prior public.studkab_request_payload_history;
begin
 if p_operation is null or p_request is null or p_actor is null or p_assignment is null
 or p_expected_revision is null or p_expected_revision<0
 or length(trim(coalesce(p_expected_kind,''))) not between 2 and 120
 or length(trim(coalesce(p_new_kind,''))) not between 2 and 120
 or p_expected_kind=p_new_kind or length(trim(coalesce(p_reason,''))) not between 10 and 500
 then return jsonb_build_object('error','Неверные данные исправления'); end if;
 if not exists(select 1 from auth.users u join public.studkab_request_config cfg
  on lower(u.email)=lower(cfg.executor_email) where u.id=p_actor)
 then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 select * into prior from public.studkab_request_payload_history where correction_operation=p_operation;
 if found then
  if prior.request_id=p_request and prior.correction_actor=p_actor and prior.correction_assignment=p_assignment
   and prior.correction_revision_before=p_expected_revision and prior.payload->>'k'=p_expected_kind
   and prior.correction_new_kind=p_new_kind and prior.correction_reason=trim(p_reason)
  then return jsonb_build_object('corrected',true,'duplicate',true,'revision',prior.correction_revision_before+1); end if;
  return jsonb_build_object('error','Конфликт повторного исправления');
 end if;
 select * into r from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then return jsonb_build_object('error','Заявка не найдена'); end if;
 if r.revision<>p_expected_revision or r.payload->>'k' is distinct from p_expected_kind
 then return jsonb_build_object('error','Заявка изменилась. Обновите её'); end if;
 if exists(select 1 from public.studkab_results where request_id=p_request)
 or exists(select 1 from public.studkab_gen_jobs where request_id=p_request::text)
 or exists(select 1 from public.studkab_material_revisions where request_id=p_request and closed_at is null)
 then return jsonb_build_object('error','Исправление недоступно до завершения текущего действия'); end if;
 select * into a from public.studkab_request_attachments current_assignment where current_assignment.id=p_assignment and current_assignment.request_id=p_request
 and current_assignment.category='assignment' and not exists(select 1 from public.studkab_request_attachments newer where newer.supersedes=current_assignment.id);
 if not found or not (
  position('вид работы: '||lower(trim(p_new_kind)) in lower(coalesce(a.extracted_text,'')))>0
  or lower(left(trim(coalesce(a.extracted_text,'')),length(trim(p_new_kind))))=lower(trim(p_new_kind))
 ) then return jsonb_build_object('error','Актуальное задание не подтверждает вид работы'); end if;
 insert into public.studkab_request_payload_history(request_id,payload,correction_operation,correction_actor,correction_assignment,correction_reason,correction_new_kind,correction_revision_before)
 values(p_request,r.payload,p_operation,p_actor,p_assignment,trim(p_reason),trim(p_new_kind),p_expected_revision);
 update public.studkab_requests set payload=jsonb_set(payload,'{k}',to_jsonb(trim(p_new_kind)),true),revision=revision+1 where id=p_request;
 update public.studkab_requirement_passports set status='stale' where request_id=p_request and status<>'stale';
 return jsonb_build_object('corrected',true,'duplicate',false,'revision',p_expected_revision+1);
end $$;
revoke all on function public.studkab_request_kind_correct(uuid,uuid,uuid,uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.studkab_request_kind_correct(uuid,uuid,uuid,uuid,integer,text,text,text) to service_role;
commit;
