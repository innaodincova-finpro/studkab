-- ROUTE-02-C, UX-02a. Окно вопросов студенту: к ответу можно приложить файл.
-- Файл добавляется в материалы принятой заявки как новый файл комплекта (не замена).
-- Условия прежние: только автор заявки, только пока материалы открыты (до начала
-- подготовки или при открытом дополнении), те же типы, размер, квота и предел 8 файлов.
-- Новый файл читается и комплект изучается заново тем же порядком, что и при замене.

create or replace function public.studkab_attachment_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; active_cycle uuid; i public.studkab_intake_files; replacing boolean:=false; adding boolean:=false;
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
  -- KIT-03: замена файла принятой заявки — новый файл того же отправленного черновика,
  -- заменяющий текущий файл этой же заявки.
  replacing:=found and r.intake_received and r.ready_at is not null and new.supersedes is not null
   and exists(select 1 from public.studkab_intake_drafts where id=i.draft_id and student_id=new.student_id and state='submitted' and submitted_request_id=r.id)
   and exists(select 1 from public.studkab_request_attachments o where o.id=new.supersedes and o.request_id=r.id and o.intake_file_id is not null and o.intake_file_id=i.supersedes);
  -- UX-02a: студент добавляет к принятой заявке новый файл (например, к ответу на вопрос):
  -- новый файл того же отправленного черновика, не заменяющий ни один прежний.
  adding:=found and not replacing and r.intake_received and r.ready_at is not null and new.supersedes is null and i.supersedes is null
   and exists(select 1 from public.studkab_intake_drafts where id=i.draft_id and student_id=new.student_id and state='submitted' and submitted_request_id=r.id)
   -- Только через studkab_registered_add_finish: она проверяет квоту и отмечает этот файл.
   and current_setting('studkab.registered_add',true) is not distinct from new.id::text;
  if not found or (not replacing and not adding and (not exists(select 1 from public.studkab_intake_drafts where id=i.draft_id and student_id=new.student_id and state='open')
  or new.supersedes is not null or r.ready_at is not null))
  or i.state<>'saved' or (not r.intake_received and i.read_status<>'ready')
  or r.client_id is distinct from 'intake_'||i.draft_id::text or exists(select 1 from public.studkab_intake_files s where s.supersedes=i.id)
  or row(new.id,new.file_name,new.file_hash,new.size_bytes,new.content_type,new.storage_path)
   is distinct from row(i.id,i.file_name,i.file_hash,i.size_bytes,i.content_type,i.storage_path)
  or (r.intake_received and (new.category<>'unclassified' or new.extracted_text is not null))
  or (not r.intake_received and new.extracted_text is distinct from i.extracted_text)
  then raise exception 'Intake attachment mismatch'; end if;
 end if;
 if new.category='unclassified' and (not r.intake_received or new.intake_file_id is null) then raise exception 'Unclassified intake only'; end if;
 if new.supersedes is not null then
  if not exists(select 1 from public.studkab_request_attachments a where a.id=new.supersedes and a.request_id=new.request_id and (a.category=new.category or (replacing and new.category='unclassified'))
  and (a.student_id=new.student_id or exists(select 1 from public.studkab_request_reassignments x where x.request_id=new.request_id and x.from_student_id=a.student_id and x.to_student_id=new.student_id))
  and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) then raise exception 'Attachment version conflict'; end if;
 elsif new.intake_file_id is null and exists(select 1 from public.studkab_request_attachments a where a.request_id=new.request_id and a.category=new.category
  and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) then raise exception 'Explicit replacement required'; end if;
 if new.supersedes is null and (select count(*) from public.studkab_request_attachments a where a.request_id=new.request_id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))>=8 then raise exception 'Attachment limit'; end if;
 update public.studkab_requests set revision=revision+1 where id=new.request_id;return new;
end $$;

create or replace function public.studkab_registered_add_reserve(p_student uuid,p_request uuid,p_name text,p_type text,p_size integer,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; d public.studkab_intake_drafts; f public.studkab_intake_files; fid uuid;
begin
 select * into r from public.studkab_requests where id=p_request and student_id=p_student and deleting_at is null for update;
 if not found or not r.intake_received or r.ready_at is null or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 if not public.studkab_registered_materials_open(r.id) then return jsonb_build_object('locked',true,'reason','Изменения материалов закрыты: подготовка уже началась. Попросите исполнителя открыть дополнение материалов'); end if;
 select * into d from public.studkab_intake_drafts where submitted_request_id=r.id and student_id=p_student and state='submitted';
 if not found then return jsonb_build_object('missing',true); end if;
 if p_type not in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 or p_size is null or p_size<1 or p_size>5242880 or p_hash !~ '^[a-f0-9]{64}$' or coalesce(btrim(p_name),'')='' or length(p_name)>180 then return jsonb_build_object('invalid',true); end if;
 select * into f from public.studkab_intake_files where draft_id=d.id and file_hash=p_hash;
 if found then
  -- Повтор после потерянного ответа: тот же новый файл, ещё не вставший в заявку.
  if f.supersedes is null and f.content_type=p_type and f.size_bytes=p_size and not exists(select 1 from public.studkab_request_attachments where id=f.id)
  then return jsonb_build_object('file',to_jsonb(f),'duplicate',false); end if;
  if f.supersedes is null and exists(select 1 from public.studkab_request_attachments where id=f.id and request_id=r.id and student_id=p_student)
  and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=f.id)
  then return jsonb_build_object('file',to_jsonb(f),'duplicate',true); end if;
  return jsonb_build_object('conflict',true,'kind',case when exists(select 1 from public.studkab_request_attachments s where s.supersedes=f.id) then 'replaced' else 'duplicate' end);
 end if;
 if (select count(*) from public.studkab_request_attachments a where a.request_id=r.id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))>=8 then return jsonb_build_object('limit',true); end if;
 if (select coalesce(sum(size_bytes),0) from public.studkab_intake_files where draft_id=d.id)+p_size>104857600 then return jsonb_build_object('quota',true); end if;
 fid=gen_random_uuid();
 insert into public.studkab_intake_files(id,draft_id,file_name,content_type,size_bytes,file_hash,storage_path,supersedes)
 values(fid,d.id,btrim(p_name),p_type,p_size,p_hash,p_student::text||'/'||d.id::text||'/'||fid::text,null) returning * into f;
 return jsonb_build_object('file',to_jsonb(f),'duplicate',false);
end $$;

create or replace function public.studkab_registered_add_finish(p_student uuid,p_request uuid,p_file uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; d public.studkab_intake_drafts; f public.studkab_intake_files; a public.studkab_request_attachments; cycle uuid;
begin
 select * into r from public.studkab_requests where id=p_request and student_id=p_student and deleting_at is null for update;
 if not found or not r.intake_received or r.ready_at is null or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select * into d from public.studkab_intake_drafts where submitted_request_id=r.id and student_id=p_student and state='submitted';
 if not found then return jsonb_build_object('missing',true); end if;
 select * into f from public.studkab_intake_files where id=p_file and draft_id=d.id and file_hash=p_hash and supersedes is null for update;
 if not found then return jsonb_build_object('missing',true); end if;
 select * into a from public.studkab_request_attachments where id=f.id and request_id=r.id;
 if found then return jsonb_build_object('attachment',jsonb_build_object('id',a.id,'file_name',a.file_name,'file_hash',a.file_hash,'supersedes',a.supersedes),'duplicate',true); end if;
 if not public.studkab_registered_materials_open(r.id) then return jsonb_build_object('locked',true,'reason','Изменения материалов закрыты: подготовка уже началась. Попросите исполнителя открыть дополнение материалов'); end if;
 if (select count(*) from public.studkab_request_attachments o where o.request_id=r.id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=o.id))>=8 then return jsonb_build_object('limit',true); end if;
 select id into cycle from public.studkab_material_revisions where request_id=r.id and closed_at is null;
 if f.state='pending' then update public.studkab_intake_files set state='saved',saved_at=now() where id=f.id returning * into f; end if;
 perform set_config('studkab.registered_add',f.id::text,true);
 insert into public.studkab_request_attachments(id,request_id,student_id,intake_file_id,category,supersedes,material_revision_id,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text)
 values(f.id,r.id,p_student,f.id,'unclassified',null,cycle,f.file_name,f.content_type,f.size_bytes,f.file_hash,f.storage_path,null) returning * into a;
 perform set_config('studkab.registered_add','',true);
 return jsonb_build_object('attachment',jsonb_build_object('id',a.id,'file_name',a.file_name,'file_hash',a.file_hash,'supersedes',a.supersedes),'duplicate',false);
end $$;
revoke all on function public.studkab_registered_add_reserve(uuid,uuid,text,text,integer,text),public.studkab_registered_add_finish(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studkab_registered_add_reserve(uuid,uuid,text,text,integer,text),public.studkab_registered_add_finish(uuid,uuid,uuid,text) to service_role;
