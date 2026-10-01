-- R15/R3/R4: revalidate saved responses into a distinct paused continuation.
-- No paid dispatch, policy activation, reserve release or historical mutation.
alter table public.studkab_intake_analysis_jobs
 add column parent_job_id uuid references public.studkab_intake_analysis_jobs(id),
 add column cached_request_ids uuid[] not null default '{}',
 add column recovery_depth integer not null default 0 check(recovery_depth in (0,1));
alter table public.studkab_intake_analysis_jobs add constraint intake_continuation_lineage
 check((parent_job_id is null and recovery_depth=0 and cardinality(cached_request_ids)=0)
 or (parent_job_id is not null and recovery_depth=1 and cardinality(cached_request_ids) between 1 and 120));
alter table public.studkab_intake_analysis_jobs drop constraint studkab_intake_analysis_jobs_draft_id_manifest_version_key;
create unique index intake_analysis_root on public.studkab_intake_analysis_jobs(draft_id,manifest,version) where parent_job_id is null;
create unique index intake_analysis_continuation on public.studkab_intake_analysis_jobs(parent_job_id) where parent_job_id is not null;
alter table public.studkab_intake_analysis_jobs drop constraint studkab_intake_analysis_jobs_state_check;
alter table public.studkab_intake_analysis_jobs add constraint studkab_intake_analysis_jobs_state_check check(state in ('queued','claimed','sent','unknown','budget','done','invalid','stale','output_limited','paused'));
create or replace function public.studkab_intake_analysis_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.draft_id,new.manifest,new.version,new.plan,new.created_at,new.parent_job_id,new.cached_request_ids,new.recovery_depth) is distinct from
    (old.id,old.draft_id,old.manifest,old.version,old.plan,old.created_at,old.parent_job_id,old.cached_request_ids,old.recovery_depth)
 or new.reserved_microusd<old.reserved_microusd then raise exception 'IMMUTABLE_INTAKE_ANALYSIS'; end if;
 if old.state in ('done','unknown','invalid','stale','output_limited') and new is distinct from old then raise exception 'TERMINAL_INTAKE_ANALYSIS'; end if;
 if old.state='paused' and new is distinct from old and current_user in ('service_role','anon','authenticated') then raise exception 'PAUSED_CONTINUATION'; end if;
 return new;
end $$;

create or replace function public.studkab_intake_analysis_start(p_student uuid,p_draft uuid,p_manifest text,p_plan jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare src jsonb; j public.studkab_intake_analysis_jobs; x jsonb;
begin
 src=public.studkab_intake_analysis_snapshot(p_student,p_draft);
 if src ? 'missing' or src ? 'unread' or src ? 'limited' then return src; end if;
 if src->>'manifest' is distinct from p_manifest then return jsonb_build_object('conflict',true); end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=p_manifest and version='intake-analysis-2' order by recovery_depth desc,created_at desc limit 1;
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
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=m and version in ('intake-analysis-1','intake-analysis-2') order by version desc,recovery_depth desc,created_at desc limit 1;
 if not found then return jsonb_build_object('state',case when exists(select 1 from public.studkab_intake_analysis_jobs where draft_id=p_draft) then 'stale' else 'idle' end); end if;
 return jsonb_build_object('id',j.id,'state',j.state,'completed',j.ordinal,'parts',jsonb_array_length(j.plan),'result',case when j.state='done' then j.result else null end);
end $$;

create or replace function public.studkab_intake_confirmation_state(p_student uuid,p_draft uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; c public.studkab_intake_confirmations; latest integer; src jsonb; m text;
begin
 perform 1 from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open';
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select coalesce(max(revision),0) into latest from public.studkab_intake_confirmations where draft_id=p_draft;
 src=public.studkab_intake_analysis_source(p_draft);m=encode(sha256(convert_to(src::text,'UTF8')),'hex');
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=m and version in ('intake-analysis-1','intake-analysis-2') order by version desc,recovery_depth desc,created_at desc limit 1;
 if not found or j.state<>'done' then return jsonb_build_object('state',case when latest>0 then 'stale' else 'unavailable' end,'revision',latest,'answers','{}'::jsonb); end if;
 select * into c from public.studkab_intake_confirmations where draft_id=p_draft and analysis_id=j.id order by revision desc limit 1;
 return jsonb_build_object('state',coalesce(c.state,'editing'),'analysisId',j.id,'manifest',m,'revision',latest,
  'answers',coalesce(c.answers,'{}'::jsonb),'savedAt',c.created_at,'rules',public.studkab_intake_confirmation_rules(j.result));
end $$;

-- Service-only snapshot for deterministic Edge verification; owner checked before data.
create function public.studkab_intake_continuation_source(p_student uuid,p_draft uuid,p_job uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb; j public.studkab_intake_analysis_jobs;
begin
 src=public.studkab_intake_analysis_snapshot(p_student,p_draft);
 if src ? 'missing' or src ? 'unread' or src ? 'limited' then return src; end if;
 select * into j from public.studkab_intake_analysis_jobs where id=p_job and draft_id=p_draft and manifest=src->>'manifest' and version='intake-analysis-2' and state='invalid' and parent_job_id is null;
 if not found then return jsonb_build_object('unavailable',true); end if;
 return jsonb_build_object('snapshot',src,'job',to_jsonb(j));
end $$;
create function public.studkab_intake_continuation_prepare(p_student uuid,p_draft uuid,p_job uuid,p_parts jsonb,p_result jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb; j public.studkab_intake_analysis_jobs; c public.studkab_intake_analysis_jobs; n integer; ids uuid[]; i integer;
begin
 -- Snapshot locks the draft, serializing duplicate preparations and source changes.
 src=public.studkab_intake_analysis_snapshot(p_student,p_draft);
 if src ? 'missing' or src ? 'unread' or src ? 'limited' then return src; end if;
 select * into j from public.studkab_intake_analysis_jobs where id=p_job and draft_id=p_draft and version='intake-analysis-2' and state='invalid' and parent_job_id is null;
 if not found then return jsonb_build_object('unavailable',true); end if;
 if j.manifest is distinct from src->>'manifest' then return jsonb_build_object('conflict',true); end if;
 select * into c from public.studkab_intake_analysis_jobs where parent_job_id=j.id;
 if found then return jsonb_build_object('id',c.id,'state',c.state,'completed',c.ordinal,'parts',jsonb_array_length(c.plan),'duplicate',true); end if;
 n=j.ordinal+1;
 if n>jsonb_array_length(j.plan) or jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts)<>n or octet_length(p_parts::text)>16000000 or jsonb_array_length(j.part_results)<>j.ordinal or jsonb_array_length(j.raw_outputs)<>n then return jsonb_build_object('invalid',true); end if;
 for i in 0..n-1 loop
  if jsonb_typeof(p_parts->i->'candidates') is distinct from 'array' or jsonb_typeof(p_parts->i->'roles') is distinct from 'array' or jsonb_typeof(p_parts->i->'covered') is distinct from 'array'
   or (i<j.ordinal and p_parts->i is distinct from j.part_results->i)
   or jsonb_typeof(j.raw_outputs->i->'text') is distinct from 'string'
   or (i<j.ordinal and j.raw_outputs->i->>'error' is not null)
   or (i=j.ordinal and j.raw_outputs->i->>'error' is distinct from 'invalid') then return jsonb_build_object('invalid',true); end if;
 end loop;
 select array_agg((x->>'request_id')::uuid order by ord) into ids from jsonb_array_elements(j.raw_outputs) with ordinality q(x,ord);
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) or array_position(ids,null) is not null then return jsonb_build_object('invalid',true); end if;
 if n=jsonb_array_length(j.plan) and (p_result->>'analysisVersion' is distinct from j.version or p_result->>'status' is distinct from 'candidate' or octet_length(p_result::text)>4000000) then return jsonb_build_object('invalid',true); end if;
 insert into public.studkab_intake_analysis_jobs(draft_id,manifest,version,plan,state,ordinal,part_results,parent_job_id,cached_request_ids,recovery_depth,result)
 values(j.draft_id,j.manifest,j.version,j.plan,case when n=jsonb_array_length(j.plan) then 'done' else 'paused' end,n,p_parts,j.id,ids,1,case when n=jsonb_array_length(j.plan) then p_result else null end) returning * into c;
 return jsonb_build_object('id',c.id,'state',c.state,'completed',c.ordinal,'parts',jsonb_array_length(c.plan));
end $$;
-- Administrative activation is a separate action after explicit spending authorization.
-- Normal Edge/service/student roles cannot activate a paused continuation.
create function public.studkab_intake_continuation_activate(p_job uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; needed bigint; policy public.studkab_intake_analysis_policy; b public.studkab_gen_budget; src jsonb;
begin
 perform 1 from public.studkab_intake_drafts where id=(select draft_id from public.studkab_intake_analysis_jobs where id=p_job) for update;
 select * into j from public.studkab_intake_analysis_jobs where id=p_job and state='paused' and parent_job_id is not null for update;
 if not found then return false; end if;
 src=public.studkab_intake_analysis_source(j.draft_id);
 if src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex')<>j.manifest or not exists(select 1 from public.studkab_members m join public.studkab_intake_drafts d on d.student_id=m.user_id where d.id=j.draft_id) then return false; end if;
 select coalesce(sum((x->>'max_cost_microusd')::bigint),0) into needed from jsonb_array_elements(j.plan) with ordinality q(x,ord) where ord>j.ordinal;
 select * into policy from public.studkab_intake_analysis_policy where id for update;
 select * into b from public.studkab_gen_budget where id for update;
 if not found or b.reserved_microusd<>public.studkab_gen_expected_reserved() or policy.enabled is distinct from true or needed>policy.limit_microusd-(select coalesce(sum(reserved_microusd),0) from public.studkab_intake_analysis_jobs) or needed>b.limit_microusd-b.reserved_microusd then return false; end if;
 -- A cached complete plan is still paused: final distribution needs a separate verifier.
 if needed=0 then return false; end if;
 update public.studkab_intake_analysis_jobs set state='queued' where id=j.id;
 return true;
end $$;
revoke all on function public.studkab_intake_continuation_source(uuid,uuid,uuid),public.studkab_intake_continuation_prepare(uuid,uuid,uuid,jsonb,jsonb),public.studkab_intake_continuation_activate(uuid) from public,anon,authenticated,service_role;
grant execute on function public.studkab_intake_continuation_source(uuid,uuid,uuid),public.studkab_intake_continuation_prepare(uuid,uuid,uuid,jsonb,jsonb) to service_role;
