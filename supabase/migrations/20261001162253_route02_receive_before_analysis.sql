-- ROUTE-02-B: receipt is not semantic completeness or preparation approval.
alter table public.studkab_intake_drafts add column reception_version integer not null default 2 check(reception_version=2);
alter table public.studkab_requests add column intake_received boolean not null default false;
alter table public.studkab_request_attachments drop constraint studkab_request_attachments_category_check;
alter table public.studkab_request_attachments add constraint studkab_request_attachments_category_check check(category in ('assignment','methodology','data','sources','unclassified'));
alter table public.studkab_request_attachments alter column extracted_text drop not null;
alter table public.studkab_request_attachments drop constraint studkab_request_attachments_extracted_text_check;
alter table public.studkab_request_attachments add constraint studkab_request_attachments_extracted_text_check
 check((extracted_text is not null and length(extracted_text) between 1 and 500000)
 or (category='unclassified' and intake_file_id is not null and extracted_text is null));

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
  or i.state<>'saved' or (not r.intake_received and i.read_status<>'ready') or new.supersedes is not null or r.ready_at is not null
  or r.client_id is distinct from 'intake_'||i.draft_id::text or exists(select 1 from public.studkab_intake_files s where s.supersedes=i.id)
  or row(new.id,new.file_name,new.file_hash,new.size_bytes,new.content_type,new.storage_path)
   is distinct from row(i.id,i.file_name,i.file_hash,i.size_bytes,i.content_type,i.storage_path)
  or (r.intake_received and (new.category<>'unclassified' or new.extracted_text is not null))
  or (not r.intake_received and new.extracted_text is distinct from i.extracted_text)
  then raise exception 'Intake attachment mismatch'; end if;
 end if;
 if new.category='unclassified' and (not r.intake_received or new.intake_file_id is null) then raise exception 'Unclassified intake only'; end if;
 if new.supersedes is not null then
  if not exists(select 1 from public.studkab_request_attachments a where a.id=new.supersedes and a.request_id=new.request_id and a.category=new.category
  and (a.student_id=new.student_id or exists(select 1 from public.studkab_request_reassignments x where x.request_id=new.request_id and x.from_student_id=a.student_id and x.to_student_id=new.student_id))
  and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) then raise exception 'Attachment version conflict'; end if;
 elsif new.intake_file_id is null and exists(select 1 from public.studkab_request_attachments a where a.request_id=new.request_id and a.category=new.category
  and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) then raise exception 'Explicit replacement required'; end if;
 if new.supersedes is null and (select count(*) from public.studkab_request_attachments a where a.request_id=new.request_id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))>=8 then raise exception 'Attachment limit'; end if;
 update public.studkab_requests set revision=revision+1 where id=new.request_id;return new;
end $$;

create function public.studkab_intake_receive_snapshot(p_student uuid,p_draft uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.studkab_intake_drafts; files jsonb;
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 if d.state='submitted' then
  if not exists(select 1 from public.studkab_requests where id=d.submitted_request_id and student_id=p_student and deleting_at is null) then return jsonb_build_object('gone',true); end if;
  return (select jsonb_build_object('submitted',true,'ready',r.ready_at is not null,'id',r.id,'number',r.number,'payload',r.payload,'duplicate',true) from public.studkab_requests r where r.id=d.submitted_request_id);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'state',i.state,'file_name',i.file_name,'content_type',i.content_type,
 'size_bytes',i.size_bytes,'file_hash',i.file_hash,'storage_path',i.storage_path) order by i.created_at,i.id),'[]') into files
 from public.studkab_intake_files i where i.draft_id=p_draft and not exists(select 1 from public.studkab_intake_files s where s.supersedes=i.id);
 return jsonb_build_object('revision',d.revision,'files',files,'canReceive',jsonb_array_length(files)>0 and not exists(select 1 from jsonb_array_elements(files) f where f->>'state'<>'saved'));
end $$;

create function public.studkab_intake_receive(p_student uuid,p_draft uuid,p_revision integer,p_deadline text,p_description text,p_contact text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.studkab_intake_drafts; src jsonb; content jsonb; result jsonb; f jsonb;
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 src:=public.studkab_intake_receive_snapshot(p_student,p_draft);
 if src ? 'submitted' or src ? 'gone' then return src; end if;
 if p_revision is distinct from d.revision then return jsonb_build_object('conflict',true); end if;
 if src->>'canReceive' is distinct from 'true' then return jsonb_build_object('incomplete',true); end if;
 if p_deadline is null or p_deadline !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_description is null or length(p_description)>500
 or p_contact is null or length(btrim(p_contact))=0 or length(p_contact)>200 then return jsonb_build_object('invalid',true); end if;
 begin
  if to_char(p_deadline::date,'YYYY-MM-DD')<>p_deadline then return jsonb_build_object('invalid',true); end if;
 exception when others then return jsonb_build_object('invalid',true); end;
 -- Empty semantic fields are intentional. A UI label must never become a guessed topic.
 content:=jsonb_build_object('v',1,'route','received','id','intake_'||p_draft::text,'t','','k','','d','','u','','n','','g','','fc','','kf','','ct','','s','','pr','','fo','','co','','org','','mn','','dl',p_deadline,'rq',p_description,'cn',p_contact,'fm','{}'::jsonb);
 result:=public.submit_studkab_request(p_student,content);
 if result ? 'limited' or result ? 'conflict' then return result; end if;
 update public.studkab_requests set intake_received=true where id=(result->>'id')::uuid;
 for f in select value from jsonb_array_elements(src->'files') loop
  insert into public.studkab_request_attachments(id,request_id,student_id,intake_file_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text)
  values((f->>'id')::uuid,(result->>'id')::uuid,p_student,(f->>'id')::uuid,'unclassified',f->>'file_name',f->>'content_type',(f->>'size_bytes')::integer,f->>'file_hash',f->>'storage_path',null);
 end loop;
 -- Publish only after the complete saved snapshot has been attached in this transaction.
 update public.studkab_requests set ready_at=now(),retry_at=now() where id=(result->>'id')::uuid;
 update public.studkab_intake_drafts set state='submitted',submitted_request_id=(result->>'id')::uuid,
 submitted_request_revision=(select revision from public.studkab_requests where id=(result->>'id')::uuid),updated_at=now() where id=p_draft;
 return result||jsonb_build_object('submitted',true,'ready',true,'stage','received','payload',content);
end $$;
revoke all on function public.studkab_intake_receive_snapshot(uuid,uuid),public.studkab_intake_receive(uuid,uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.studkab_intake_receive_snapshot(uuid,uuid),public.studkab_intake_receive(uuid,uuid,integer,text,text,text) to service_role;

-- Defense in depth: a receipt cannot be converted into approval by an old client.
create function public.studkab_received_passport_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='approved' and exists(select 1 from public.studkab_requests where id=new.request_id and intake_received)
 and exists(select 1 from public.studkab_request_attachments a where a.request_id=new.request_id
 and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id)
 and (a.category='unclassified' or a.extracted_text is null)) then raise exception 'INTAKE_STUDY_REQUIRED'; end if;
 return new;
end $$;
revoke all on function public.studkab_received_passport_guard() from public,anon,authenticated;
create trigger studkab_received_passport_guard before insert or update on public.studkab_requirement_passports
 for each row execute function public.studkab_received_passport_guard();
