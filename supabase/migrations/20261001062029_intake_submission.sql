-- R15 / INTAKE-01 step 6. No publication until all metadata commits together.
alter table public.studkab_intake_drafts add column submitted_request_id uuid,
 add column submitted_confirmation_id uuid references public.studkab_intake_confirmations(id),add column submitted_request_revision integer;
alter table public.studkab_request_attachments add column intake_file_id uuid references public.studkab_intake_files(id);
create unique index studkab_attachment_intake_file on public.studkab_request_attachments(intake_file_id) where intake_file_id is not null;
alter table public.studkab_request_attachments drop constraint studkab_request_attachments_content_type_check;
alter table public.studkab_request_attachments add constraint studkab_request_attachments_content_type_check
 check(content_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
update storage.buckets set allowed_mime_types=array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] where id='studkab-request-materials';

create function public.studkab_intake_submitted_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.state='submitted' and new is distinct from old then raise exception 'INTAKE_SUBMITTED_IMMUTABLE'; end if;
 return new;
end $$;
revoke all on function public.studkab_intake_submitted_guard() from public,anon,authenticated;
create trigger studkab_intake_submitted_guard before update on public.studkab_intake_drafts for each row execute function public.studkab_intake_submitted_guard();

create function public.studkab_intake_submission_snapshot(p_student uuid,p_draft uuid,p_contact text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.studkab_intake_drafts; c jsonb; a public.studkab_intake_analysis_jobs;
 payload jsonb; f jsonb; answer jsonb; key text; value text; files jsonb; dates text[];
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 if d.state='submitted' then
  if not exists(select 1 from public.studkab_requests where id=d.submitted_request_id and student_id=p_student and deleting_at is null) then return jsonb_build_object('gone',true); end if;
  return (select jsonb_build_object('submitted',true,'id',r.id,'number',r.number,'payload',r.payload,'duplicate',true) from public.studkab_requests r where r.id=d.submitted_request_id);
 end if;
 c:=public.studkab_intake_confirmation_state(p_student,p_draft);
 if c->>'state' is distinct from 'confirmed' then return jsonb_build_object('unconfirmed',true); end if;
 select * into a from public.studkab_intake_analysis_jobs where id=(c->>'analysisId')::uuid;
 payload:=jsonb_build_object('v',1,'id','intake_'||p_draft::text,'cn',coalesce(p_contact,''),'fm','{}'::jsonb);
 foreach key in array array['t','k','d','u','fc','kf','ct','n','g','pr','fo','co','s','dl','org','mn'] loop
  f:=a.result->'fields'->(case when key='s' then 'pr' when key='pr' then 'program' else key end);
  answer:=c->'answers'->('f:'||(case when key='s' then 'pr' when key='pr' then 'program' else key end));value:='';
  if answer->>'type'='custom' then value:=answer->>'value';
  elsif answer->>'type'='candidate' then value:=f->'values'->((answer->>'index')::integer)->>'value';
  elsif answer is null and jsonb_array_length(coalesce(f->'values','[]'))=1 and coalesce(f->>'status','') not in ('conflict','needs_review') then value:=f->'values'->0->>'value'; end if;
  if key='dl' then
   select array_agg(m[1]) into dates from regexp_matches(coalesce(value,''),'([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}\.[0-9]{2}\.[0-9]{4})','g') m;
   if cardinality(dates)=1 then value:=case when dates[1] like '%.%' then substr(dates[1],7,4)||'-'||substr(dates[1],4,2)||'-'||substr(dates[1],1,2) else dates[1] end; end if;
  end if;
  payload:=payload||jsonb_build_object(key,coalesce(value,''));
 end loop;
 payload:=payload||jsonb_build_object('rq',d.notes);
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'file_name',i.file_name,'content_type',i.content_type,
  'size_bytes',i.size_bytes,'file_hash',i.file_hash,'storage_path',i.storage_path,'extracted_text',i.extracted_text)
  order by i.created_at,i.id),'[]') into files from public.studkab_intake_files i where i.draft_id=p_draft and i.state='saved'
  and not exists(select 1 from public.studkab_intake_files s where s.supersedes=i.id);
 return jsonb_build_object('payload',payload,'files',files,'confirmation',c,'analysis',a.result);
end $$;

-- Keep the previous trigger intact for all old/new manual uploads. Imported
-- siblings may share a category, but only if their immutable intake row matches.
create or replace function public.studkab_attachment_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; active_cycle uuid; i public.studkab_intake_files;
begin
 select * into r from public.studkab_requests where id=new.request_id for update;
 if not found or r.deleting_at is not null or r.student_id<>new.student_id then raise exception 'Attachment request unavailable'; end if;
 select id into active_cycle from public.studkab_material_revisions where request_id=r.id and closed_at is null;
 if new.material_revision_id is distinct from active_cycle then raise exception 'Material revision changed'; end if;
 if exists(select 1 from public.studkab_gen_jobs where request_id=r.id::text)
 or exists(select 1 from public.studkab_result_versions where request_id=r.id)
 or exists(select 1 from public.studkab_results where request_id=r.id)
 or ((exists(select 1 from public.studkab_requirement_passports where request_id=r.id and status='approved')
 or exists(select 1 from public.studkab_material_revisions where request_id=r.id)
 or exists(select 1 from public.studkab_request_reassignments where request_id=r.id))
 and not exists(select 1 from public.studkab_material_revisions where request_id=r.id and closed_at is null)) then raise exception 'Preparation already started'; end if;
 if not exists(select 1 from public.studkab_members where user_id=new.student_id) then raise exception 'Attachment author unavailable'; end if;
 if (select count(*) from public.studkab_request_attachments where request_id=new.request_id)>=200 then raise exception 'Attachment history limit'; end if;
 if new.intake_file_id is not null then
  select * into i from public.studkab_intake_files where id=new.intake_file_id;
  if not found or not exists(select 1 from public.studkab_intake_drafts where id=i.draft_id and student_id=new.student_id and state='open')
  or i.state<>'saved' or i.read_status<>'ready' or new.supersedes is not null or r.ready_at is not null
  or r.client_id is distinct from 'intake_'||i.draft_id::text or exists(select 1 from public.studkab_intake_files s where s.supersedes=i.id)
  or row(new.id,new.file_name,new.file_hash,new.size_bytes,new.content_type,new.storage_path,new.extracted_text)
   is distinct from row(i.id,i.file_name,i.file_hash,i.size_bytes,i.content_type,i.storage_path,i.extracted_text)
  then raise exception 'Intake attachment mismatch'; end if;
 end if;
 if new.supersedes is not null then
  if not exists(select 1 from public.studkab_request_attachments a where a.id=new.supersedes and a.request_id=new.request_id and a.category=new.category
  and (a.student_id=new.student_id or exists(select 1 from public.studkab_request_reassignments x where x.request_id=new.request_id and x.from_student_id=a.student_id and x.to_student_id=new.student_id))
  and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) then raise exception 'Attachment version conflict'; end if;
 elsif new.intake_file_id is null and exists(select 1 from public.studkab_request_attachments a where a.request_id=new.request_id and a.category=new.category
  and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) then raise exception 'Explicit replacement required'; end if;
 if new.supersedes is null and (select count(*) from public.studkab_request_attachments a where a.request_id=new.request_id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))>=8 then raise exception 'Attachment limit'; end if;
 update public.studkab_requests set revision=revision+1 where id=new.request_id;return new;
end $$;

create function public.studkab_intake_submit(p_student uuid,p_draft uuid,p_analysis uuid,p_revision integer,p_contact text,p_content jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.studkab_intake_drafts; src jsonb; c jsonb; result jsonb; published jsonb; f jsonb; category text; key text; cid uuid;
 limits jsonb:='{"id":100,"t":300,"k":100,"d":200,"u":300,"fc":300,"kf":300,"ct":100,"n":200,"g":100,"pr":200,"fo":100,"co":50,"s":200,"dl":10,"rq":500,"org":1500,"mn":1500,"cn":200}';
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 src:=public.studkab_intake_submission_snapshot(p_student,p_draft,p_contact);
 if src ? 'submitted' or src ? 'gone' then return src; end if;
 if src ? 'unconfirmed' then return src; end if;
 c:=src->'confirmation';
 if p_analysis is distinct from (c->>'analysisId')::uuid or p_revision is distinct from (c->>'revision')::integer then return jsonb_build_object('conflict',true); end if;
 if p_content is distinct from src->'payload' then return jsonb_build_object('invalid',true); end if;
 foreach key in array array['t','k','n','u','d','dl','cn'] loop
  if length(btrim(coalesce(p_content->>key,'')))=0 then return jsonb_build_object('incomplete',true); end if;
 end loop;
 if length(p_content::text)>16000 or p_content->>'dl' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return jsonb_build_object('invalid',true); end if;
 for key in select jsonb_object_keys(limits) loop
  if length(p_content->>key)>(limits->>key)::integer then return jsonb_build_object('invalid',true); end if;
 end loop;
 begin perform (p_content->>'dl')::date;exception when others then return jsonb_build_object('invalid',true);end;
 if jsonb_array_length(src->'files')=0 then return jsonb_build_object('incomplete',true); end if;
 -- Use the same daily limit/idempotency function as the old route.
 result:=public.submit_studkab_request(p_student,p_content);
 if result ? 'limited' or result ? 'conflict' then return result; end if;
 for f in select value from jsonb_array_elements(src->'files') loop
  select case role->>'role' when 'requirements' then 'methodology' else role->>'role' end into category
   from jsonb_array_elements(src->'analysis'->'roles') role where exists(select 1 from jsonb_array_elements(role->'refs') ref where ref->>'fileId'=f->>'id')
   order by case role->>'role' when 'assignment' then 0 when 'methodology' then 1 when 'requirements' then 1 when 'data' then 2 else 3 end limit 1;
  insert into public.studkab_request_attachments(id,request_id,student_id,intake_file_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text)
  values((f->>'id')::uuid,(result->>'id')::uuid,p_student,(f->>'id')::uuid,coalesce(category,'data'),f->>'file_name',f->>'content_type',(f->>'size_bytes')::integer,f->>'file_hash',f->>'storage_path',f->>'extracted_text');
 end loop;
 published:=public.studkab_request_publish((result->>'id')::uuid,p_student);
 if published->>'ready' is distinct from 'true' then raise exception 'INTAKE_ASSIGNMENT_REQUIRED'; end if;
 select id into cid from public.studkab_intake_confirmations where draft_id=p_draft and analysis_id=p_analysis and revision=p_revision;
 update public.studkab_intake_drafts set state='submitted',submitted_request_id=(result->>'id')::uuid,submitted_confirmation_id=cid,
 submitted_request_revision=(select revision from public.studkab_requests where id=(result->>'id')::uuid),updated_at=now() where id=p_draft;
 return result||jsonb_build_object('submitted',true,'ready',true,'payload',p_content);
end $$;
create function public.studkab_intake_request_context(p_request uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('draftId',d.id,'analysisId',a.id,'manifest',a.manifest,'analysis',a.result,
 'answers',c.answers,'confirmationRevision',c.revision,'stale',r.revision<>d.submitted_request_revision)
 from public.studkab_intake_drafts d join public.studkab_requests r on r.id=d.submitted_request_id
 join public.studkab_intake_confirmations c on c.id=d.submitted_confirmation_id
 join public.studkab_intake_analysis_jobs a on a.id=c.analysis_id where r.id=p_request and r.deleting_at is null;
$$;
revoke all on function public.studkab_intake_submission_snapshot(uuid,uuid,text),public.studkab_intake_submit(uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_intake_submission_snapshot(uuid,uuid,text),public.studkab_intake_submit(uuid,uuid,uuid,integer,text,jsonb) to service_role;
revoke all on function public.studkab_intake_request_context(uuid) from public,anon,authenticated;
grant execute on function public.studkab_intake_request_context(uuid) to service_role;
