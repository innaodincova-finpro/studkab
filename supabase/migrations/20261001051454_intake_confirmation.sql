-- R15 / INTAKE-01 step 5: student confirmation, never passport approval/publication.
create table public.studkab_intake_confirmations (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.studkab_intake_drafts(id),
 analysis_id uuid not null references public.studkab_intake_analysis_jobs(id),
 manifest text not null check(manifest ~ '^[a-f0-9]{64}$'),
 revision integer not null check(revision>0),
 answers jsonb not null check(jsonb_typeof(answers)='object' and octet_length(answers::text)<=262144),
 state text not null check(state in ('editing','confirmed')),
 created_at timestamptz not null default now(),
 unique(draft_id,revision)
);
alter table public.studkab_intake_confirmations enable row level security;
revoke all on public.studkab_intake_confirmations from public,anon,authenticated,service_role;
grant select,insert on public.studkab_intake_confirmations to service_role;
-- Rules come from the persisted server result, not client-supplied questions.
create function public.studkab_intake_confirmation_rules(p_result jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare rules jsonb='{}'; f record; v jsonb; i integer;
begin
 for f in select * from jsonb_each(p_result->'fields') loop
  if f.key not in ('structure','formatting','data','sources') then
   rules=rules||jsonb_build_object('f:'||f.key,jsonb_build_object('kind','field','field',f.key,'required',
    (f.key in ('t','k','u','n','d','dl') and jsonb_array_length(f.value->'values')=0) or f.value->>'status' in ('conflict','needs_review')));
  else
   i=0;
   for v in select * from jsonb_array_elements(f.value->'values') loop
    if coalesce(v->>'condition','')<>'' then rules=rules||jsonb_build_object('c:'||f.key||':'||i,jsonb_build_object('kind','condition','field',f.key,'index',i,'required',true)); end if;
    i=i+1;
   end loop;
  end if;
 end loop;
 i=0;
 for v in select * from jsonb_array_elements(p_result->'requirements') loop
  if coalesce(v->>'condition','')<>'' then rules=rules||jsonb_build_object('c:requirement:'||i,jsonb_build_object('kind','condition','field','requirement','index',i,'required',true)); end if;
  i=i+1;
 end loop;
 return rules;
end $$;
create function public.studkab_intake_confirmation_state(p_student uuid,p_draft uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_intake_analysis_jobs; c public.studkab_intake_confirmations; latest integer; src jsonb; m text;
begin
 perform 1 from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open';
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select coalesce(max(revision),0) into latest from public.studkab_intake_confirmations where draft_id=p_draft;
 src=public.studkab_intake_analysis_source(p_draft);m=encode(sha256(convert_to(src::text,'UTF8')),'hex');
 select * into j from public.studkab_intake_analysis_jobs where draft_id=p_draft and manifest=m and state='done' and version='intake-analysis-1';
 if not found then return jsonb_build_object('state',case when latest>0 then 'stale' else 'unavailable' end,'revision',latest,'answers','{}'::jsonb); end if;
 select * into c from public.studkab_intake_confirmations where draft_id=p_draft and analysis_id=j.id order by revision desc limit 1;
 return jsonb_build_object('state',coalesce(c.state,'editing'),'analysisId',j.id,'manifest',m,'revision',latest,
  'answers',coalesce(c.answers,'{}'::jsonb),'savedAt',c.created_at,'rules',public.studkab_intake_confirmation_rules(j.result));
end $$;
create function public.studkab_intake_confirmation_save(p_student uuid,p_draft uuid,p_analysis uuid,p_revision integer,p_answers jsonb,p_confirm boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s jsonb; r jsonb; a record; rule jsonb; j public.studkab_intake_analysis_jobs; c public.studkab_intake_confirmations; typ text; idx integer; target text;
begin
 perform 1 from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open' for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 s=public.studkab_intake_confirmation_state(p_student,p_draft);
 if p_analysis is null or s->>'analysisId' is null or s->>'analysisId' is distinct from p_analysis::text then return jsonb_build_object('stale',true); end if;
 if p_confirm is null or p_revision is null or p_revision<0 or p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>262144 then return jsonb_build_object('invalid',true); end if;
 select * into j from public.studkab_intake_analysis_jobs where id=p_analysis;
 r=s->'rules';
 for a in select * from jsonb_each(p_answers) loop
  rule=r->a.key;typ=a.value->>'type';
  if rule is null or jsonb_typeof(a.value)<>'object' or typ is null then return jsonb_build_object('invalid',true); end if;
  if rule->>'kind'='condition' then
   if typ not in ('applies','not_applies','unknown') or a.value<>jsonb_build_object('type',typ) then return jsonb_build_object('invalid',true); end if;
  elsif typ='candidate' then
   if coalesce(a.value->>'index','') !~ '^[0-9]{1,6}$' or jsonb_typeof(a.value->'index')<>'number' then return jsonb_build_object('invalid',true); end if;
   idx=(a.value->>'index')::integer;
   if idx>=jsonb_array_length(j.result->'fields'->(rule->>'field')->'values') or a.value<>jsonb_build_object('type',typ,'index',idx) then return jsonb_build_object('invalid',true); end if;
  elsif typ='custom' then
   if jsonb_typeof(a.value->'value') is distinct from 'string' or length(btrim(a.value->>'value')) not between 1 and 2000 or a.value<>jsonb_build_object('type',typ,'value',a.value->>'value') then return jsonb_build_object('invalid',true); end if;
  elsif typ<>'unknown' or a.value<>jsonb_build_object('type',typ) then return jsonb_build_object('invalid',true);
  end if;
 end loop;
 if p_confirm and exists(select 1 from jsonb_each(r) q where (q.value->>'required')::boolean and not p_answers ? q.key) then return jsonb_build_object('incomplete',true); end if;
 target=case when p_confirm then 'confirmed' else 'editing' end;
 select * into c from public.studkab_intake_confirmations where draft_id=p_draft order by revision desc limit 1;
 -- A lost response is retried with the same expected revision and same answers.
 if c.analysis_id=p_analysis and c.answers=p_answers and c.state=target then return public.studkab_intake_confirmation_state(p_student,p_draft); end if;
 if (s->>'revision')::integer<>p_revision then return jsonb_build_object('conflict',true); end if;
 insert into public.studkab_intake_confirmations(draft_id,analysis_id,manifest,revision,answers,state)
 values(p_draft,p_analysis,s->>'manifest',p_revision+1,p_answers,target);
 return public.studkab_intake_confirmation_state(p_student,p_draft);
end $$;
revoke all on function public.studkab_intake_confirmation_rules(jsonb),public.studkab_intake_confirmation_state(uuid,uuid),public.studkab_intake_confirmation_save(uuid,uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.studkab_intake_confirmation_rules(jsonb),public.studkab_intake_confirmation_state(uuid,uuid),public.studkab_intake_confirmation_save(uuid,uuid,uuid,integer,jsonb,boolean) to service_role;
