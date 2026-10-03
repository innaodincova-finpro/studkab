-- ROUTE-02-C, KIT-06. Разбор зарегистрированной заявки пошаговой проверкой checklist-3:
-- три части одного способа — сведения о работе, перечень нужного и заключение.
-- Запрос заключения строится во время выполнения из результата перечня (часть deferred),
-- поэтому у неё нет сохранённого текста запроса; резерв задан верхней границей и
-- по-прежнему проходит денежную проверку dispatch. Прежние способы и пределы не меняются.
create or replace function public.studkab_intake_analysis_start(p_student uuid, p_draft uuid, p_manifest text, p_plan jsonb)
 returns jsonb language plpgsql set search_path to '' as $function$
declare src jsonb; j public.studkab_intake_analysis_jobs; x jsonb; whole boolean; list boolean; i int;
begin
 src=public.studkab_intake_analysis_snapshot(p_student,p_draft);
 if src ? 'missing' or src ? 'unread' or src ? 'limited' then return src; end if;
 if src->>'manifest' is distinct from p_manifest then return jsonb_build_object('conflict',true); end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=p_manifest and version='intake-analysis-2';
 if found then return jsonb_build_object('id',j.id,'state',j.state); end if;
 if not exists(select 1 from public.studkab_intake_analysis_policy where id and enabled and limit_microusd>0) then return jsonb_build_object('disabled',true); end if;
 if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) not between 1 and 120 or octet_length(p_plan::text)>16000000 then return jsonb_build_object('limited',true); end if;
 if src->>'studyProtocol'='registered-kit-review-1' and (p_plan->-1->>'kind' is distinct from 'kit_review' or p_plan->-1->>'review_version' is distinct from 'registered-kit-review-1') then return jsonb_build_object('invalid',true);end if;
 -- KIT-06: пошаговая проверка — ровно три части одного способа с одинаковым комплектом.
 list=p_plan->0->>'method'='checklist-3';
 if list then
  if jsonb_array_length(p_plan)<>3 or src->>'studyProtocol' is distinct from 'registered-kit-review-1' then return jsonb_build_object('invalid',true);end if;
  for i in 0..2 loop
   x=p_plan->i;
   if x->>'method' is distinct from 'checklist-3' or x->>'kind' is distinct from (array['kit_extraction','checklist_inventory','kit_review'])[i+1]
    or x->>'analysis_version' is distinct from 'intake-analysis-2' or x->'blocks' is distinct from p_plan->0->'blocks'
    or jsonb_typeof(x->'blocks') is distinct from 'array' or jsonb_array_length(x->'blocks') not between 1 and 500
    or x->>'max_output_tokens' is distinct from '4000' or coalesce(x->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$'
    or (i<2 and (coalesce(x->>'prompt','')='' or octet_length(x->>'prompt')>40000))
    or (i=2 and (x->'deferred' is distinct from 'true'::jsonb or x ? 'prompt' or x->>'review_version' is distinct from 'registered-kit-review-1'))
   then return jsonb_build_object('invalid',true);end if;
  end loop;
  insert into public.studkab_intake_analysis_jobs(draft_id,manifest,version,plan) values(p_draft,p_manifest,'intake-analysis-2',p_plan) returning * into j;
  return jsonb_build_object('id',j.id,'state',j.state);
 end if;
 -- Новый способ: ровно две части одного способа, первая — разбор всего комплекта.
 whole=p_plan->0->>'kind'='kit_extraction';
 if whole and (jsonb_array_length(p_plan)<>2 or src->>'studyProtocol' is distinct from 'registered-kit-review-1'
  or p_plan->0->>'method' is distinct from 'whole-kit-2' or p_plan->1->>'method' is distinct from 'whole-kit-2'
  or p_plan->0->'blocks' is distinct from p_plan->1->'blocks') then return jsonb_build_object('invalid',true);end if;
 for x in select value from jsonb_array_elements(p_plan) loop
  if x->>'kind'='kit_extraction' then
   if not whole or x is distinct from p_plan->0 or x->>'analysis_version' is distinct from 'intake-analysis-2' or jsonb_typeof(x->'blocks') is distinct from 'array' or jsonb_array_length(x->'blocks') not between 1 and 500 or coalesce(x->>'prompt','')='' or octet_length(x->>'prompt')>40000 or x->>'max_output_tokens' is distinct from '4000' or coalesce(x->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$' then return jsonb_build_object('invalid',true);end if;
  elsif x->>'kind'='kit_review' then
   if src->>'studyProtocol' is distinct from 'registered-kit-review-1' or x is distinct from p_plan->-1 or x->>'review_version' is distinct from 'registered-kit-review-1' or x->>'analysis_version' is distinct from 'intake-analysis-2' or jsonb_typeof(x->'blocks') is distinct from 'array' or jsonb_array_length(x->'blocks') not between 1 and 500 or coalesce(x->>'prompt','')='' or octet_length(x->>'prompt')>40000 or x->>'max_output_tokens' is distinct from '4000' or coalesce(x->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$' then return jsonb_build_object('invalid',true);end if;
  else
  if whole or x->>'analysis_version' is distinct from 'intake-analysis-2' or jsonb_array_length(x->'blocks') not between 1 and 12 or (select coalesce(sum(octet_length(b->>'text')),0) from jsonb_array_elements(x->'blocks') b)>3000 or exists(select 1 from jsonb_array_elements(x->'blocks') b where octet_length(b->>'text')>1200) or jsonb_typeof(x->'blocks') is distinct from 'array' or coalesce(x->>'prompt','')='' or octet_length(x->>'prompt')>40000 or x->>'max_output_tokens' is distinct from '4000' or coalesce(x->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$' then return jsonb_build_object('invalid',true); end if;
  end if;
 end loop;
 insert into public.studkab_intake_analysis_jobs(draft_id,manifest,version,plan) values(p_draft,p_manifest,'intake-analysis-2',p_plan) returning * into j;
 return jsonb_build_object('id',j.id,'state',j.state);
end $function$;

create or replace function public.studkab_intake_analysis_finish(p_job uuid, p_claim uuid, p_request uuid, p_part jsonb, p_result jsonb, p_raw text, p_error text)
 returns text language plpgsql set search_path to '' as $function$
declare j public.studkab_intake_analysis_jobs; src jsonb; s text; retry boolean:=false;
begin
 -- Same lock order as registration/material changes: request, draft, job, budget.
 perform 1 from public.studkab_requests where id=(select d.submitted_request_id
 from public.studkab_intake_drafts d join public.studkab_intake_analysis_jobs queued_job on queued_job.draft_id=d.id where queued_job.id=p_job) for update;
 perform 1 from public.studkab_intake_drafts where id=(select draft_id from public.studkab_intake_analysis_jobs where id=p_job) for update;
 select * into j from public.studkab_intake_analysis_jobs where id=p_job for update;
 if not found or j.state<>'sent' or j.claim is distinct from p_claim or j.provider_request_id is distinct from p_request or j.lease_until<=clock_timestamp() then raise exception 'STALE_RESULT'; end if;
 if octet_length(p_raw)>100000 or octet_length(p_part::text)>2000000 or octet_length(p_result::text)>4000000 then raise exception 'RESULT_TOO_BIG'; end if;
 if p_error is not null and p_error<>'length' and p_error<>'invalid' and p_error !~ '^invalid:[A-Z_]{1,60}$' then raise exception 'INVALID_ERROR'; end if;
 src=public.studkab_intake_analysis_source(j.draft_id);
 s=case when p_error='length' then 'output_limited' when p_error like 'invalid%' then 'invalid' when p_part is null then 'unknown'
 when src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex')<>j.manifest then 'stale'
 when j.ordinal+1=jsonb_array_length(j.plan) then 'done' else 'queued' end;
 -- KIT-02/KIT-06: один повтор той же части нового способа после брака формата.
 if s='invalid' and j.plan->j.ordinal->>'method' in ('whole-kit-2','checklist-3') and not exists(select 1 from jsonb_array_elements(j.raw_outputs) e
  where e->>'error' like 'invalid%' and e->>'ordinal'=j.ordinal::text) then s='queued'; retry=true; end if;
 if s in ('queued','done') and not retry and (jsonb_typeof(p_part->'candidates') is distinct from 'array' or jsonb_typeof(p_part->'roles') is distinct from 'array') then raise exception 'INVALID_RESULT'; end if;
 if s='done' and (p_result->>'analysisVersion' is distinct from j.version or p_result->>'status' is distinct from 'candidate') then raise exception 'INVALID_RESULT'; end if;
 update public.studkab_intake_analysis_jobs set state=s,ordinal=ordinal+case when s in ('done','queued') and not retry then 1 else 0 end,
 part_results=part_results||case when s in ('done','queued') and not retry then jsonb_build_array(p_part) else '[]'::jsonb end,
 raw_outputs=raw_outputs||jsonb_build_array(jsonb_build_object('request_id',p_request,'text',p_raw,'error',p_error,'ordinal',j.ordinal)),
 claim=case when retry then null else claim end,
 result=case when s='done' then p_result else null end,lease_until=null where id=j.id;
 return case when retry then 'retry' else s end;
end $function$;

-- Тексты возвращённых вопросов для заключения: только машинный доступ, только возвраты заявки.
create or replace function public.studkab_registered_returned_questions(p_request uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('proposalId',q.id,'question',q.question) order by q.decided_at,q.id),'[]'::jsonb)
 from public.studkab_question_proposals q where q.request_id=p_request and q.state='returned'
$$;
revoke all on function public.studkab_registered_returned_questions(uuid) from public,anon,authenticated;
grant execute on function public.studkab_registered_returned_questions(uuid) to service_role;
