-- ROUTE-02-C: executor-reviewed role; original bytes/hash/history remain immutable.
create table public.studkab_intake_classifications (
 attachment_id uuid primary key references public.studkab_request_attachments(id) on delete cascade,
 analysis_id uuid not null references public.studkab_intake_analysis_jobs(id),
 category text not null check(category in ('assignment','methodology','data','sources')),
 approved_by uuid not null references auth.users(id),
 approved_at timestamptz not null default now()
);
alter table public.studkab_intake_classifications enable row level security;
revoke all on public.studkab_intake_classifications from public,anon,authenticated,service_role;
grant select,insert on public.studkab_intake_classifications to service_role;
grant update(category,extracted_text) on public.studkab_request_attachments to service_role;
create or replace function public.studkab_attachment_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
declare src jsonb;j public.studkab_intake_analysis_jobs;f public.studkab_intake_files;c public.studkab_intake_classifications;
begin
 -- Permit exactly one reviewed classification; all other existing updates still fail.
 if old.category<>'unclassified' or old.extracted_text is not null
 or new.category not in ('assignment','methodology','data','sources')
 or (to_jsonb(new)-'category'-'extracted_text') is distinct from (to_jsonb(old)-'category'-'extracted_text') then raise exception 'Immutable attachment';end if;
 select * into c from public.studkab_intake_classifications where attachment_id=old.id and category=new.category;
 select * into j from public.studkab_intake_analysis_jobs where id=c.analysis_id and state='done';
 select * into f from public.studkab_intake_files where id=old.intake_file_id;
 src=public.studkab_registered_analysis_source(old.request_id);
 if src is null or j.id is null or j.manifest is distinct from encode(sha256(convert_to(src::text,'UTF8')),'hex')
 or f.read_status is distinct from 'ready' or new.extracted_text is distinct from f.extracted_text
 or coalesce(btrim(new.extracted_text),'')='' then raise exception 'CLASSIFICATION_STALE';end if;
 return new;
end $$;
create function public.studkab_registered_material_classify(p_request uuid,p_actor uuid,p_analysis uuid,p_file uuid,p_category text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb;j public.studkab_intake_analysis_jobs;a public.studkab_request_attachments;f public.studkab_intake_files;c public.studkab_intake_classifications;
begin
 if not exists(select 1 from auth.users u join public.studkab_request_config config on lower(u.email)=lower(config.executor_email) where u.id=p_actor) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then return jsonb_build_object('stale',true);end if;
 src=public.studkab_registered_analysis_source(p_request);
 select * into j from public.studkab_intake_analysis_jobs where id=p_analysis and state='done';
 if src is null or j.id is null or j.manifest is distinct from encode(sha256(convert_to(src::text,'UTF8')),'hex') then return jsonb_build_object('stale',true);end if;
 if p_category is null or p_category not in ('assignment','methodology','data','sources') then return jsonb_build_object('invalid',true);end if;
 if not exists(select 1 from jsonb_array_elements(j.result->'roles') role_value,
 jsonb_array_elements(role_value->'refs') ref where ref->>'fileId'=p_file::text
 and (role_value->>'role'=p_category or (p_category='methodology' and role_value->>'role'='requirements'))) then return jsonb_build_object('unsupported',true);end if;
 select * into a from public.studkab_request_attachments where request_id=p_request and intake_file_id=p_file
 and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=studkab_request_attachments.id) for update;
 if not found then return jsonb_build_object('stale',true);end if;
 select * into c from public.studkab_intake_classifications where attachment_id=a.id;
 if found then
  if c.analysis_id=p_analysis and c.category=p_category and c.approved_by=p_actor then return jsonb_build_object('saved',true,'duplicate',true);end if;
  return jsonb_build_object('conflict',true);
 end if;
 select * into f from public.studkab_intake_files where id=p_file for update;
 if a.category<>'unclassified' or f.read_status is distinct from 'ready' or coalesce(btrim(f.extracted_text),'')='' then return jsonb_build_object('invalid',true);end if;
 insert into public.studkab_intake_classifications(attachment_id,analysis_id,category,approved_by) values(a.id,p_analysis,p_category,p_actor);
 update public.studkab_request_attachments set category=p_category,extracted_text=f.extracted_text where id=a.id;
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.studkab_registered_material_classify(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studkab_registered_material_classify(uuid,uuid,uuid,uuid,text) to service_role;

-- A classified file alone does not clear unresolved private questions or stale study.
create function public.studkab_registered_passport_gate() returns trigger
language plpgsql security invoker set search_path='' as $$
declare src jsonb;j public.studkab_intake_analysis_jobs;
begin
 if new.status<>'approved' or not exists(select 1 from public.studkab_requests where id=new.request_id and intake_received) then return new;end if;
 src=public.studkab_registered_analysis_source(new.request_id);
 if src is null then raise exception 'INTAKE_STUDY_REQUIRED';end if;
 select * into j from public.studkab_intake_analysis_jobs where draft_id=(src->>'draftId')::uuid and manifest=encode(sha256(convert_to(src::text,'UTF8')),'hex') and version='intake-analysis-2' and state='done';
 if not found then raise exception 'INTAKE_STUDY_REQUIRED';end if;
 if exists(select 1 from public.studkab_question_proposals where request_id=new.request_id and analysis_id=j.id and state='pending')
 or exists(select 1 from jsonb_each(j.result->'fields') field_value where field_value.value->>'status' in ('conflict','needs_review')
 and not exists(select 1 from public.studkab_question_proposals p where p.request_id=new.request_id and p.analysis_id=j.id and p.item_id='FIELD_'||field_value.key and p.state='published')
 and not exists(select 1 from public.studkab_clarifications c where c.request_id=new.request_id and c.item_id='FIELD_'||field_value.key and c.answered_at is not null))
 then raise exception 'INTAKE_QUESTIONS_REVIEW_REQUIRED';end if;
 return new;
end $$;
create trigger registered_study_passport_gate before insert or update of status on public.studkab_requirement_passports for each row execute function public.studkab_registered_passport_gate();
revoke all on function public.studkab_registered_passport_gate() from public,anon,authenticated;
