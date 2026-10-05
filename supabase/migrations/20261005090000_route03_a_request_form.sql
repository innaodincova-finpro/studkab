-- ROUTE-03, этап R3-A (05.10.2026): заявка без автоматического чтения.
-- 1) Студент прикладывает фото и снимки экрана (JPEG, PNG, WebP) наравне с Word, PDF, Excel.
-- 2) Предел действующих файлов заявки — 20 вместо 8 (страницы учебника присылают снимками).
-- 3) Новая регистрация заявки studkab_intake_receive_form: сведения для титульного листа
--    и ссылка на папку в облаке; можно отправить только ссылку без файлов.
-- 4) Фото не отправляются на автоматическое чтение документов.
-- Защита, доступ (только service_role), квота 100 МБ, размер файла 5 МБ — без изменений.

alter table public.studkab_intake_files drop constraint studkab_intake_files_content_type_check;
alter table public.studkab_intake_files add constraint studkab_intake_files_content_type_check
 check(content_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp'));
alter table public.studkab_request_attachments drop constraint studkab_request_attachments_content_type_check;
alter table public.studkab_request_attachments add constraint studkab_request_attachments_content_type_check
 check(content_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','text/plain'));
update storage.buckets set allowed_mime_types=array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp'] where id='studkab-intake-materials';
update storage.buckets set allowed_mime_types=array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','text/plain'] where id='studkab-request-materials';

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
 if new.supersedes is null and (select count(*) from public.studkab_request_attachments a where a.request_id=new.request_id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))>=20 then raise exception 'Attachment limit'; end if;
 update public.studkab_requests set revision=revision+1 where id=new.request_id;return new;
end $$;

create or replace function public.studkab_intake_reserve(p_student uuid,p_draft uuid,p_name text,p_type text,p_size integer,p_hash text,p_supersedes uuid default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare d public.studkab_intake_drafts; f public.studkab_intake_files; predecessor public.studkab_intake_files; fid uuid;
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student and state='open' for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select * into f from public.studkab_intake_files where draft_id=p_draft and file_hash=p_hash;
 if found then
  if f.content_type<>p_type or f.size_bytes<>p_size or (p_supersedes is not null and f.supersedes is distinct from p_supersedes) then return jsonb_build_object('conflict',true); end if;
  return jsonb_build_object('file',to_jsonb(f),'duplicate',f.state='saved');
 end if;
 if (select coalesce(sum(size_bytes),0) from public.studkab_intake_files where draft_id=p_draft)+p_size>104857600 then
  return jsonb_build_object('quota',true);
 end if;
 if p_supersedes is not null then
  select * into predecessor from public.studkab_intake_files where id=p_supersedes and draft_id=p_draft and state='saved';
  if not found or exists(select 1 from public.studkab_intake_files where supersedes=p_supersedes) then return jsonb_build_object('conflict',true); end if;
 else
  if (select count(*) from public.studkab_intake_files where draft_id=p_draft and supersedes is null)>=20 then
   return jsonb_build_object('limited',true);
  end if;
 end if;
 fid=gen_random_uuid();
 insert into public.studkab_intake_files(id,draft_id,file_name,content_type,size_bytes,file_hash,storage_path,supersedes)
 values(fid,p_draft,p_name,p_type,p_size,p_hash,p_student::text||'/'||p_draft::text||'/'||fid::text,p_supersedes) returning * into f;
 update public.studkab_intake_drafts set revision=revision+1,updated_at=now() where id=p_draft;
 return jsonb_build_object('file',to_jsonb(f),'duplicate',false);
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
 if p_type not in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp')
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
 if (select count(*) from public.studkab_request_attachments a where a.request_id=r.id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))>=20 then return jsonb_build_object('limit',true); end if;
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
 if (select count(*) from public.studkab_request_attachments o where o.request_id=r.id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=o.id))>=20 then return jsonb_build_object('limit',true); end if;
 select id into cycle from public.studkab_material_revisions where request_id=r.id and closed_at is null;
 if f.state='pending' then update public.studkab_intake_files set state='saved',saved_at=now() where id=f.id returning * into f; end if;
 perform set_config('studkab.registered_add',f.id::text,true);
 insert into public.studkab_request_attachments(id,request_id,student_id,intake_file_id,category,supersedes,material_revision_id,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text)
 values(f.id,r.id,p_student,f.id,'unclassified',null,cycle,f.file_name,f.content_type,f.size_bytes,f.file_hash,f.storage_path,null) returning * into a;
 perform set_config('studkab.registered_add','',true);
 return jsonb_build_object('attachment',jsonb_build_object('id',a.id,'file_name',a.file_name,'file_hash',a.file_hash,'supersedes',a.supersedes),'duplicate',false);
end $$;

create or replace function public.studkab_registered_replace_reserve(p_student uuid, p_request uuid, p_attachment uuid, p_name text, p_type text, p_size integer, p_hash text)
 returns jsonb language plpgsql set search_path to '' as $function$
declare r public.studkab_requests; d public.studkab_intake_drafts; a public.studkab_request_attachments; o public.studkab_intake_files; f public.studkab_intake_files; fid uuid;
begin
 select * into r from public.studkab_requests where id=p_request and student_id=p_student and deleting_at is null for update;
 if not found or not r.intake_received or r.ready_at is null or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 if not public.studkab_registered_materials_open(r.id) then return jsonb_build_object('locked',true,'reason','Изменения материалов закрыты: подготовка уже началась. Попросите исполнителя открыть дополнение материалов'); end if;
 select * into d from public.studkab_intake_drafts where submitted_request_id=r.id and student_id=p_student and state='submitted';
 if not found then return jsonb_build_object('missing',true); end if;
 select * into a from public.studkab_request_attachments where id=p_attachment and request_id=r.id and intake_file_id is not null;
 if not found then return jsonb_build_object('missing',true); end if;
 select * into o from public.studkab_intake_files where id=a.intake_file_id and draft_id=d.id;
 if not found then return jsonb_build_object('missing',true); end if;
 if p_type not in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp')
 or p_size is null or p_size<1 or p_size>5242880 or p_hash !~ '^[a-f0-9]{64}$' or coalesce(btrim(p_name),'')='' or length(p_name)>180 then return jsonb_build_object('invalid',true); end if;
 select * into f from public.studkab_intake_files where draft_id=d.id and file_hash=p_hash;
 if found then
  -- UX-01: выбран ровно тот файл, который уже стоит на этом месте, — замена не нужна.
  if f.id=o.id and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id) then return jsonb_build_object('same',true); end if;
  if f.supersedes is distinct from o.id or f.content_type<>p_type or f.size_bytes<>p_size then return jsonb_build_object('conflict',true,'kind',case when exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id) then 'replaced' else 'duplicate' end); end if;
  return jsonb_build_object('file',to_jsonb(f),'duplicate',exists(select 1 from public.studkab_request_attachments where id=f.id));
 end if;
 if exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id) then return jsonb_build_object('conflict',true,'kind','replaced'); end if;
 if (select coalesce(sum(size_bytes),0) from public.studkab_intake_files where draft_id=d.id)+p_size>104857600 then return jsonb_build_object('quota',true); end if;
 fid=gen_random_uuid();
 insert into public.studkab_intake_files(id,draft_id,file_name,content_type,size_bytes,file_hash,storage_path,supersedes)
 values(fid,d.id,btrim(p_name),p_type,p_size,p_hash,p_student::text||'/'||d.id::text||'/'||fid::text,o.id) returning * into f;
 return jsonb_build_object('file',to_jsonb(f),'duplicate',false);
end $function$;

create or replace function public.studkab_intake_work_pending() returns boolean
language sql security invoker set search_path='' as $$
 select exists(
  select 1 from public.studkab_requests q
  join public.studkab_request_attachments a on a.request_id=q.id and a.student_id=q.student_id
  join public.studkab_intake_files i on i.id=a.intake_file_id
  where q.intake_received and q.ready_at is not null and q.deleting_at is null
  and i.state='saved' and i.registered_read_attempts<3
  and i.content_type not like 'image/%'
  and i.read_status not in ('ready','blocked')
  and (i.read_status<>'reading' or i.read_until is null or i.read_until<=now())
  and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id))
 or (exists(select 1 from public.studkab_intake_analysis_policy where id and enabled and limit_microusd>0)
  and (exists(select 1 from public.studkab_intake_analysis_jobs where state in ('queued','claimed','budget'))
   or public.studkab_registered_analysis_next() is not null))
$$;

create or replace function public.studkab_registered_read_claim(p_version text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; f public.studkab_intake_files;
begin
 if p_version is null or p_version !~ '^[a-z0-9-]{1,60}$' then return null; end if;
 -- Lock request before file, following existing material-change operations.
 for r in select q.* from public.studkab_requests q
 join public.studkab_intake_drafts d on d.submitted_request_id=q.id
 where q.intake_received and q.ready_at is not null and q.deleting_at is null
 and d.state='submitted' and d.student_id=q.student_id
 and exists(select 1 from public.studkab_members m where m.user_id=q.student_id)
 and exists(select 1 from public.studkab_request_attachments a
 join public.studkab_intake_files i on i.id=a.intake_file_id
 where a.request_id=q.id and a.student_id=q.student_id and a.category='unclassified'
 and a.file_hash=i.file_hash and a.storage_path=i.storage_path and i.state='saved' and i.content_type not like 'image/%'
 and (i.registered_read_attempts<3 or (i.registered_read_attempts=3 and i.read_status='reading' and i.read_until<=now()))
 and not(coalesce(i.read_version=p_version,false) and i.read_status in ('ready','blocked'))
 and (i.read_status<>'reading' or i.read_until is null or i.read_until<=now())
 and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id))
 order by q.created_at,q.id for update of q skip locked loop
 -- A crash on the last permitted attempt must not leave a perpetual reading state.
 update public.studkab_intake_files set read_status='failed',read_until=null,
 read_result=jsonb_build_object('schema',1,'readerVersion',read_version,
 'fileId',id,'fileHash',file_hash,'status','failed','blocks','[]'::jsonb,
 'warnings',jsonb_build_array(jsonb_build_object('code','reading_retry_limit','source','{}'::jsonb)),
 'extracted_text',''),extracted_text=''
 where registered_read_request=r.id and registered_read_attempts=3
 and read_status='reading' and read_until<=now();
  select i.* into f from public.studkab_request_attachments a
  join public.studkab_intake_files i on i.id=a.intake_file_id
  join public.studkab_intake_drafts d on d.id=i.draft_id
  where a.request_id=r.id and a.student_id=r.student_id and a.category='unclassified'
  and d.submitted_request_id=r.id and d.student_id=r.student_id
  and a.file_hash=i.file_hash and a.storage_path=i.storage_path and i.state='saved' and i.content_type not like 'image/%'
  and i.registered_read_attempts<3
  and not(coalesce(i.read_version=p_version,false) and i.read_status in ('ready','blocked'))
  and (i.read_status<>'reading' or i.read_until is null or i.read_until<=now())
  and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id)
  order by i.created_at,i.id limit 1 for update of i skip locked;
  if found then
   update public.studkab_intake_files set read_status='reading',read_version=p_version,
    read_lease=gen_random_uuid(),read_until=now()+interval '90 seconds',
    read_result=null,extracted_text=null,registered_read_attempts=registered_read_attempts+1,
    registered_read_request=r.id,registered_read_revision=r.revision
    where id=f.id returning * into f;
   return jsonb_build_object('request_id',r.id,'revision',r.revision,'file',to_jsonb(f));
  end if;
 end loop;
 return null;
end $$;

-- R3-A: регистрация заявки по форме. Программа файлы не читает и не толкует:
-- сведения для титульного листа берутся только из формы студента.
create function public.studkab_intake_receive_form(p_student uuid,p_draft uuid,p_revision integer,p_deadline text,p_description text,p_contact text,p_details jsonb,p_link text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.studkab_intake_drafts; src jsonb; content jsonb; result jsonb; f jsonb; k text; v text;
 lim constant jsonb:='{"k":100,"d":200,"u":300,"kf":300,"pr":200,"fo":100,"g":100,"n":200,"s":200}';
begin
 select * into d from public.studkab_intake_drafts where id=p_draft and student_id=p_student for update;
 if not found or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 src:=public.studkab_intake_receive_snapshot(p_student,p_draft);
 if src ? 'submitted' or src ? 'gone' then return src; end if;
 if p_revision is distinct from d.revision then return jsonb_build_object('conflict',true); end if;
 -- Все выбранные файлы должны быть сохранены; без файлов — только при ссылке на облако.
 if exists(select 1 from jsonb_array_elements(src->'files') x where x->>'state'<>'saved') then return jsonb_build_object('incomplete',true); end if;
 if p_link is null or length(p_link)>500 or (p_link<>'' and p_link !~ '^https://(disk\.yandex\.(ru|com|by|kz)|yadi\.sk|disk\.360\.yandex\.ru|drive\.google\.com|docs\.google\.com|cloud\.mail\.ru)/[^[:space:]<>"]+$')
 then return jsonb_build_object('invalid',true); end if;
 if jsonb_array_length(src->'files')=0 and p_link='' then return jsonb_build_object('incomplete',true); end if;
 if p_deadline is null or p_deadline !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_description is null or length(p_description)>500
 or p_contact is null or length(btrim(p_contact))=0 or length(p_contact)>200 then return jsonb_build_object('invalid',true); end if;
 begin
  if to_char(p_deadline::date,'YYYY-MM-DD')<>p_deadline then return jsonb_build_object('invalid',true); end if;
 exception when others then return jsonb_build_object('invalid',true); end;
 if p_details is null or jsonb_typeof(p_details)<>'object' then return jsonb_build_object('invalid',true); end if;
 for k in select jsonb_object_keys(p_details) loop
  if not lim ? k or jsonb_typeof(p_details->k)<>'string' or length(p_details->>k)>(lim->>k)::integer then return jsonb_build_object('invalid',true); end if;
 end loop;
 foreach v in array array['k','d','u','fo','g','n'] loop
  if length(btrim(coalesce(p_details->>v,'')))=0 then return jsonb_build_object('invalid',true); end if;
 end loop;
 content:=jsonb_build_object('v',1,'route','r3','id','intake_'||p_draft::text,'t','',
  'k',btrim(p_details->>'k'),'d',btrim(p_details->>'d'),'u',btrim(p_details->>'u'),'n',btrim(p_details->>'n'),'g',btrim(p_details->>'g'),
  'fc','','kf',btrim(coalesce(p_details->>'kf','')),'ct','','s',btrim(coalesce(p_details->>'s','')),'pr',btrim(coalesce(p_details->>'pr','')),
  'fo',btrim(p_details->>'fo'),'co','','org','','mn','','dl',p_deadline,'rq',p_description,'cn',p_contact,'lk',p_link,'fm','{}'::jsonb);
 result:=public.submit_studkab_request(p_student,content);
 if result ? 'limited' or result ? 'conflict' then return result; end if;
 update public.studkab_requests set intake_received=true where id=(result->>'id')::uuid;
 for f in select value from jsonb_array_elements(src->'files') loop
  insert into public.studkab_request_attachments(id,request_id,student_id,intake_file_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text)
  values((f->>'id')::uuid,(result->>'id')::uuid,p_student,(f->>'id')::uuid,'unclassified',f->>'file_name',f->>'content_type',(f->>'size_bytes')::integer,f->>'file_hash',f->>'storage_path',null);
 end loop;
 -- Публикация только после того, как весь сохранённый комплект прикреплён в этой же транзакции.
 update public.studkab_requests set ready_at=now(),retry_at=now() where id=(result->>'id')::uuid;
 update public.studkab_intake_drafts set state='submitted',submitted_request_id=(result->>'id')::uuid,
 submitted_request_revision=(select revision from public.studkab_requests where id=(result->>'id')::uuid),updated_at=now() where id=p_draft;
 return result||jsonb_build_object('submitted',true,'ready',true,'stage','received','payload',content);
end $$;
revoke all on function public.studkab_intake_receive_form(uuid,uuid,integer,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studkab_intake_receive_form(uuid,uuid,integer,text,text,text,jsonb,text) to service_role;
