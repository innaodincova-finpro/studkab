-- ROUTE-02-C: whole-kit adequacy and attributed answer assessment, no activation.
alter function public.studkab_registered_analysis_source(uuid) rename to studkab_registered_analysis_original_source;
create function public.studkab_registered_analysis_source(p_request uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select src || jsonb_build_object('studyProtocol','registered-kit-review-1',
 'studentAnswers',coalesce((select jsonb_agg(a || jsonb_build_object('itemId',c.item_id) order by c.answered_at,c.id)
 from jsonb_array_elements(src->'studentAnswers') a join public.studkab_clarifications c on c.id=(a->>'id')::uuid),'[]'::jsonb))
 from (select public.studkab_registered_analysis_original_source(p_request) src) s where src is not null
$$;
revoke all on function public.studkab_registered_analysis_source(uuid),public.studkab_registered_analysis_original_source(uuid) from public,anon,authenticated;
grant execute on function public.studkab_registered_analysis_source(uuid),public.studkab_registered_analysis_original_source(uuid) to service_role;

alter function public.studkab_registered_questions_refresh(uuid) rename to studkab_registered_field_questions_refresh;
create function public.studkab_registered_questions_refresh(p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb;j public.studkab_intake_analysis_jobs;gap jsonb;
begin
 perform 1 from public.studkab_requests where id=p_request for update;
 src=public.studkab_registered_analysis_source(p_request);
 if src is null then return jsonb_build_object('stale',true);end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid and manifest=encode(sha256(convert_to(src::text,'UTF8')),'hex') and version='intake-analysis-2' and state='done';
 if not found or j.result->'kitReview'->>'version' is distinct from 'registered-kit-review-1' then return jsonb_build_object('unavailable',true);end if;
 for gap in select value from jsonb_array_elements(j.result->'kitReview'->'gaps') loop
  insert into public.studkab_question_proposals(request_id,analysis_id,item_id,question,reason,evidence)
  values(p_request,j.id,'FIELD_GAP_'||(gap->>'key'),gap->>'question',gap->>'reason',jsonb_build_array(jsonb_build_object('value',gap->>'reason','refs',gap->'refs')))
  on conflict(analysis_id,item_id) do nothing;
 end loop;
 update public.studkab_question_proposals q set restudy_analysis_id=j.id,
 restudy_reason=case r->>'status' when 'resolved' then 'Вопрос снят по заключению: ' when 'unresolved' then 'Вопрос остаётся существенным: ' else 'Снятие вопроса не подтверждено: ' end||(r->>'reason')
 from jsonb_array_elements(j.result->'kitReview'->'returnedReviews') r
 where q.request_id=p_request and q.state='returned' and q.id::text=r->>'proposalId' and q.analysis_id<>j.id;
 update public.studkab_question_proposals q set restudy_analysis_id=j.id,
 restudy_reason=case a->>'status' when 'sufficient' then 'Ответ достаточен по текущему заключению: ' when 'insufficient' then 'Ответ недостаточен: ' else 'Достаточность ответа не установлена: ' end||(a->>'reason')
 from jsonb_array_elements(j.result->'kitReview'->'answerReviews') a
 where q.request_id=p_request and q.state='published' and q.id::text=a->>'questionId' and q.analysis_id<>j.id;
 return jsonb_build_object('analysisId',j.id,'proposals',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at,q.id) from public.studkab_question_proposals q where q.request_id=p_request),'[]'::jsonb));
end $$;
revoke all on function public.studkab_registered_questions_refresh(uuid),public.studkab_registered_field_questions_refresh(uuid) from public,anon,authenticated;
grant execute on function public.studkab_registered_questions_refresh(uuid),public.studkab_registered_field_questions_refresh(uuid) to service_role;

create or replace function public.studkab_registered_passport_gate() returns trigger
language plpgsql security invoker set search_path='' as $$
declare src jsonb;j public.studkab_intake_analysis_jobs;
begin
 if new.status<>'approved' or not exists(select 1 from public.studkab_requests where id=new.request_id and intake_received) then return new;end if;
 src=public.studkab_registered_analysis_source(new.request_id);
 if src is null then raise exception 'INTAKE_STUDY_REQUIRED';end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid and manifest=encode(sha256(convert_to(src::text,'UTF8')),'hex') and version='intake-analysis-2' and state='done';
 if not found or j.result->'kitReview'->>'version' is distinct from 'registered-kit-review-1' or jsonb_typeof(j.result->'kitReview'->'gaps') is distinct from 'array' or jsonb_typeof(j.result->'kitReview'->'answerReviews') is distinct from 'array' or jsonb_typeof(j.result->'kitReview'->'returnedReviews') is distinct from 'array' then raise exception 'INTAKE_STUDY_REQUIRED';end if;
 if jsonb_array_length(j.result->'kitReview'->'gaps')>0 then raise exception 'INTAKE_ESSENTIAL_GAPS_UNRESOLVED';end if;
 if exists(select 1 from public.studkab_question_proposals where request_id=new.request_id and analysis_id=j.id and state='pending')

 then raise exception 'INTAKE_QUESTIONS_REVIEW_REQUIRED';end if;
 return new;
end $$;

create or replace function public.studkab_intake_analysis_start(p_student uuid,p_draft uuid,p_manifest text,p_plan jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare src jsonb; j public.studkab_intake_analysis_jobs; x jsonb;
begin
 src=public.studkab_intake_analysis_snapshot(p_student,p_draft);
 if src ? 'missing' or src ? 'unread' or src ? 'limited' then return src; end if;
 if src->>'manifest' is distinct from p_manifest then return jsonb_build_object('conflict',true); end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=p_manifest and version='intake-analysis-2';
 if found then return jsonb_build_object('id',j.id,'state',j.state); end if;
 if not exists(select 1 from public.studkab_intake_analysis_policy where id and enabled and limit_microusd>0) then return jsonb_build_object('disabled',true); end if;
 if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) not between 1 and 120 or octet_length(p_plan::text)>16000000 then return jsonb_build_object('limited',true); end if;
 if src->>'studyProtocol'='registered-kit-review-1' and (p_plan->-1->>'kind' is distinct from 'kit_review' or p_plan->-1->>'review_version' is distinct from 'registered-kit-review-1') then return jsonb_build_object('invalid',true);end if;
 for x in select value from jsonb_array_elements(p_plan) loop
  if x->>'kind'='kit_review' then
   if src->>'studyProtocol' is distinct from 'registered-kit-review-1' or x is distinct from p_plan->-1 or x->>'review_version' is distinct from 'registered-kit-review-1' or x->>'analysis_version' is distinct from 'intake-analysis-2' or jsonb_typeof(x->'blocks') is distinct from 'array' or jsonb_array_length(x->'blocks') not between 1 and 500 or coalesce(x->>'prompt','')='' or octet_length(x->>'prompt')>40000 or x->>'max_output_tokens' is distinct from '4000' or coalesce(x->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$' then return jsonb_build_object('invalid',true);end if;
  else
  if x->>'analysis_version' is distinct from 'intake-analysis-2' or jsonb_array_length(x->'blocks') not between 1 and 12 or (select coalesce(sum(octet_length(b->>'text')),0) from jsonb_array_elements(x->'blocks') b)>3000 or exists(select 1 from jsonb_array_elements(x->'blocks') b where octet_length(b->>'text')>1200) or jsonb_typeof(x->'blocks') is distinct from 'array' or coalesce(x->>'prompt','')='' or octet_length(x->>'prompt')>40000 or x->>'max_output_tokens' is distinct from '4000' or coalesce(x->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$' then return jsonb_build_object('invalid',true); end if;
  end if;
 end loop;
 insert into public.studkab_intake_analysis_jobs(draft_id,manifest,version,plan) values(p_draft,p_manifest,'intake-analysis-2',p_plan) returning * into j;
 return jsonb_build_object('id',j.id,'state',j.state);
end $$;


create or replace function public.studkab_registered_analysis_start(p_request uuid,p_manifest text,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prefix jsonb;reuse public.studkab_intake_analysis_jobs; r public.studkab_requests; src jsonb; b public.studkab_gen_budget; policy public.studkab_intake_analysis_policy; cost bigint; used bigint; j public.studkab_intake_analysis_jobs;
begin
 select * into r from public.studkab_requests where id=p_request for update;
 perform 1 from public.studkab_intake_drafts where submitted_request_id=p_request for update;
 src=public.studkab_registered_analysis_source(p_request);
 if src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex') is distinct from p_manifest then return jsonb_build_object('stale',true); end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid and manifest=p_manifest and version='intake-analysis-2';
 if found then return jsonb_build_object('id',j.id,'state',j.state); end if;
 -- Reuse already paid, verified output when the exact source-bound plan matches.
 -- Extra receipt metadata does not justify buying the same analysis again.
 select * into j from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid
 and version='intake-analysis-2' and state='done' and plan=p_plan order by created_at limit 1;
 if found then
  insert into public.studkab_intake_analysis_jobs(draft_id,manifest,version,plan,state,ordinal,part_results,raw_outputs,result)
  values(j.draft_id,p_manifest,j.version,j.plan,'done',j.ordinal,j.part_results,jsonb_build_array(jsonb_build_object('reused_analysis_id',j.id)),j.result)
  returning * into j;
  return jsonb_build_object('id',j.id,'state',j.state,'reused',true);
 end if;
 if exists(select 1 from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid
 and plan=p_plan and reserved_microusd>0 and state<>'done') then
  insert into public.studkab_registered_analysis_blocks(request_id,manifest,reason) values(p_request,p_manifest,'reconciliation') on conflict(request_id,manifest) do update set reason='reconciliation';
  return jsonb_build_object('reconciliation',true);
 end if;
 -- Exact legacy extraction prefix is already paid; only the new review may dispatch.
 if jsonb_typeof(p_plan)='array' and p_plan->-1->>'kind'='kit_review' then
  select jsonb_agg(value-'extraction_parts' order by ordinal) into prefix from jsonb_array_elements(p_plan) with ordinality e(value,ordinal) where ordinal<jsonb_array_length(p_plan);
  select * into reuse from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid and version='intake-analysis-2' and plan=prefix and state='done' and ordinal=jsonb_array_length(prefix) and jsonb_array_length(part_results)=jsonb_array_length(prefix) order by created_at limit 1;
  if reuse.id is null and exists(select 1 from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid and plan=prefix and reserved_microusd>0 and state<>'done') then
   insert into public.studkab_registered_analysis_blocks(request_id,manifest,reason) values(p_request,p_manifest,'reconciliation') on conflict(request_id,manifest) do update set reason='reconciliation';
   return jsonb_build_object('reconciliation',true);
  end if;
 end if;
 select * into policy from public.studkab_intake_analysis_policy where id;
 if policy.enabled is distinct from true or coalesce(policy.limit_microusd,0)<=0 then return jsonb_build_object('disabled',true); end if;
 if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) not between 1 and 120 then return jsonb_build_object('invalid',true); end if;
 if exists(select 1 from jsonb_array_elements(p_plan) p where coalesce(p->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$') then return jsonb_build_object('invalid',true); end if;
 select sum((p->>'max_cost_microusd')::bigint) into cost from jsonb_array_elements(p_plan) with ordinality e(p,ordinal) where reuse.id is null or ordinal=jsonb_array_length(p_plan);
 select * into b from public.studkab_gen_budget where id for update;
 select coalesce(sum(reserved_microusd),0) into used from public.studkab_intake_analysis_jobs;
 if b.id is null or cost>policy.limit_microusd-used or cost>b.limit_microusd-b.reserved_microusd then
  insert into public.studkab_registered_analysis_blocks(request_id,manifest,reason) values(p_request,p_manifest,'budget') on conflict(request_id,manifest) do update set reason='budget';
  return jsonb_build_object('budget',true);
 end if;
 -- Existing start validates bounded parts; dispatch checks actual ledger and reserves.
 if reuse.id is not null then
  if octet_length(p_plan::text)>16000000 or p_plan->-1->>'review_version' is distinct from 'registered-kit-review-1' or octet_length(p_plan->-1->>'prompt')>40000 or p_plan->-1->>'max_output_tokens' is distinct from '4000' then return jsonb_build_object('invalid',true);end if;
  insert into public.studkab_intake_analysis_jobs(draft_id,manifest,version,plan,state,ordinal,part_results,raw_outputs)
  values(reuse.draft_id,p_manifest,reuse.version,p_plan,'queued',jsonb_array_length(prefix),reuse.part_results,jsonb_build_array(jsonb_build_object('reused_extraction_id',reuse.id))) returning * into j;
  return jsonb_build_object('id',j.id,'state',j.state,'reusedExtraction',true);
 end if;
 return public.studkab_intake_analysis_start(r.student_id,(src->>'draftId')::uuid,p_manifest,p_plan);
end $$;
