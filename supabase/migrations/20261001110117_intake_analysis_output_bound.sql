-- INTAKE-02: bounded output migration, no policy activation, no reserve release.
alter table public.studkab_intake_analysis_jobs drop constraint studkab_intake_analysis_jobs_version_check;
alter table public.studkab_intake_analysis_jobs add constraint studkab_intake_analysis_jobs_version_check check(version in ('intake-analysis-1','intake-analysis-2'));
alter table public.studkab_intake_analysis_jobs drop constraint studkab_intake_analysis_jobs_state_check;
alter table public.studkab_intake_analysis_jobs add constraint studkab_intake_analysis_jobs_state_check check(state in ('queued','claimed','sent','unknown','budget','done','invalid','stale','output_limited'));
create or replace function public.studkab_intake_analysis_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.draft_id,new.manifest,new.version,new.plan,new.created_at) is distinct from
    (old.id,old.draft_id,old.manifest,old.version,old.plan,old.created_at)
 or new.reserved_microusd<old.reserved_microusd then raise exception 'IMMUTABLE_INTAKE_ANALYSIS'; end if;
 if old.state in ('done','unknown','invalid','stale','output_limited') and new is distinct from old then raise exception 'TERMINAL_INTAKE_ANALYSIS'; end if;
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
 for x in select value from jsonb_array_elements(p_plan) loop
  if x->>'analysis_version' is distinct from 'intake-analysis-2' or jsonb_array_length(x->'blocks') not between 1 and 12 or (select coalesce(sum(octet_length(b->>'text')),0) from jsonb_array_elements(x->'blocks') b)>3000 or exists(select 1 from jsonb_array_elements(x->'blocks') b where octet_length(b->>'text')>1200) or jsonb_typeof(x->'blocks') is distinct from 'array' or coalesce(x->>'prompt','')='' or octet_length(x->>'prompt')>40000 or x->>'max_output_tokens' is distinct from '4000' or coalesce(x->>'max_cost_microusd','') !~ '^[1-9][0-9]{0,6}$' then return jsonb_build_object('invalid',true); end if;
 end loop;
 insert into public.studkab_intake_analysis_jobs(draft_id,manifest,version,plan) values(p_draft,p_manifest,'intake-analysis-2',p_plan) returning * into j;
 return jsonb_build_object('id',j.id,'state',j.state);
end $$;

create or replace function public.studkab_intake_analysis_state(p_student uuid,p_draft uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare src jsonb; m text; j public.studkab_intake_analysis_jobs;
begin
 perform 1 from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open';
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 src=public.studkab_intake_analysis_source(p_draft);m=encode(sha256(convert_to(src::text,'UTF8')),'hex');
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=m and version in ('intake-analysis-1','intake-analysis-2') order by version desc,created_at desc limit 1;
 if not found then return jsonb_build_object('state',case when exists(select 1 from public.studkab_intake_analysis_jobs where draft_id=p_draft) then 'stale' else 'idle' end); end if;
 return jsonb_build_object('id',j.id,'state',j.state,'completed',j.ordinal,'parts',jsonb_array_length(j.plan),'result',case when j.state='done' then j.result else null end);
end $$;

create or replace function public.studkab_intake_analysis_finish(p_job uuid,p_claim uuid,p_request uuid,p_part jsonb,p_result jsonb,p_raw text,p_error text) returns text language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; src jsonb; s text;
begin
 perform 1 from public.studkab_intake_drafts where id=(select draft_id from public.studkab_intake_analysis_jobs where id=p_job) for update;
 select * into j from public.studkab_intake_analysis_jobs where id=p_job for update;
 if not found or j.state<>'sent' or j.claim is distinct from p_claim or j.provider_request_id is distinct from p_request or j.lease_until<=clock_timestamp() then raise exception 'STALE_RESULT'; end if;
 if octet_length(p_raw)>100000 or octet_length(p_part::text)>2000000 or octet_length(p_result::text)>4000000 then raise exception 'RESULT_TOO_BIG'; end if;
 src=public.studkab_intake_analysis_source(j.draft_id);
 s=case when p_error='length' then 'output_limited' when p_error='invalid' then 'invalid' when p_part is null then 'unknown'
 when src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex')<>j.manifest then 'stale'
 when j.ordinal+1=jsonb_array_length(j.plan) then 'done' else 'queued' end;
 if s in ('queued','done') and (jsonb_typeof(p_part->'candidates') is distinct from 'array' or jsonb_typeof(p_part->'roles') is distinct from 'array') then raise exception 'INVALID_RESULT'; end if;
 if s='done' and (p_result->>'analysisVersion' is distinct from j.version or p_result->>'status' is distinct from 'candidate') then raise exception 'INVALID_RESULT'; end if;
 update public.studkab_intake_analysis_jobs set state=s,ordinal=ordinal+case when s in ('done','queued') then 1 else 0 end,
 part_results=part_results||case when s in ('done','queued') then jsonb_build_array(p_part) else '[]'::jsonb end,
 raw_outputs=raw_outputs||jsonb_build_array(jsonb_build_object('request_id',p_request,'text',p_raw,'error',p_error)),
 result=case when s='done' then p_result else null end,lease_until=null where id=j.id;
 return s;
end $$;

create or replace function public.studkab_intake_confirmation_state(p_student uuid,p_draft uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; c public.studkab_intake_confirmations; latest integer; src jsonb; m text;
begin
 perform 1 from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open';
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select coalesce(max(revision),0) into latest from public.studkab_intake_confirmations where draft_id=p_draft;
 src=public.studkab_intake_analysis_source(p_draft);m=encode(sha256(convert_to(src::text,'UTF8')),'hex');
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=m and version in ('intake-analysis-1','intake-analysis-2') order by version desc,created_at desc limit 1;
 if not found or j.state<>'done' then return jsonb_build_object('state',case when latest>0 then 'stale' else 'unavailable' end,'revision',latest,'answers','{}'::jsonb); end if;
 select * into c from public.studkab_intake_confirmations where draft_id=p_draft and analysis_id=j.id order by revision desc limit 1;
 return jsonb_build_object('state',coalesce(c.state,'editing'),'analysisId',j.id,'manifest',m,'revision',latest,
  'answers',coalesce(c.answers,'{}'::jsonb),'savedAt',c.created_at,'rules',public.studkab_intake_confirmation_rules(j.result));
end $$;
