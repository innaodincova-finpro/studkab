-- ROUTE-02-C, KIT-03. Замена файла в принятой заявке (план ROUTE-02, раздел 3:
-- «при замене материалов устаревшее предложение не публикуется»).
-- Прежде цепочка чтения и разбора была привязана к номеру редакции заявки на момент
-- отправки, и любое изменение после отправки навсегда останавливало чтение и разбор.
-- Теперь версия комплекта определяется её содержанием: текущими файлами и их прочтением,
-- сроком, заметками, ответами и замечаниями. Служебная смена номера редакции без изменения
-- содержания не вызывает повторного платного разбора; замена файла — вызывает.
create or replace function public.studkab_registered_analysis_original_source(p_request uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('requestId',r.id,'studentId',r.student_id,
 'deadline',r.payload->>'dl','notes',d.notes,'draftId',d.id,
 'reviewInstructions',coalesce((select jsonb_agg(jsonb_build_object('proposalId',q.id,'itemId',q.item_id,'comment',q.return_comment) order by q.decided_at,q.id)
 from public.studkab_question_proposals q where q.request_id=r.id and q.state='returned'),'[]'::jsonb),
 'studentAnswers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'question',c.question,'answer',c.answer,'source',c.answer_source,'author',c.answered_by) order by c.answered_at,c.id)
 from public.studkab_clarifications c where c.request_id=r.id and c.answered_at is not null),'[]'::jsonb),
 'files',coalesce((select jsonb_agg(jsonb_build_object(
 'id',f.id,'file_name',f.file_name,'file_hash',f.file_hash,'state',f.state,
 'read_status',f.read_status,'read_version',f.read_version,'read_result',f.read_result,
 'attachmentId',a.id,'storagePath',a.storage_path,
 'registeredReadRequest',f.registered_read_request,'registeredReadRevision',f.registered_read_revision) order by f.created_at,f.id)
 from public.studkab_request_attachments a join public.studkab_intake_files f on f.id=a.intake_file_id
 where a.request_id=r.id and a.student_id=r.student_id and f.draft_id=d.id
 and f.state='saved' and a.file_hash=f.file_hash and a.storage_path=f.storage_path
 and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id)), '[]'::jsonb))
 from public.studkab_requests r join public.studkab_intake_drafts d on d.submitted_request_id=r.id
 where r.id=p_request and r.intake_received and r.ready_at is not null and r.deleting_at is null
 and d.state='submitted' and d.student_id=r.student_id
 and exists(select 1 from public.studkab_members m where m.user_id=r.student_id)
 -- Every current attachment must be a matching original from this saved submission.
 and not exists(select 1 from public.studkab_request_attachments a
 left join public.studkab_intake_files f on f.id=a.intake_file_id
 where a.request_id=r.id and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id)
 and (a.student_id is distinct from r.student_id or f.draft_id is distinct from d.id
 or f.state is distinct from 'saved' or a.file_hash is distinct from f.file_hash
 or a.storage_path is distinct from f.storage_path or (f.read_status='ready' and (
 (f.registered_read_request is not null and f.registered_read_request is distinct from r.id)
 or f.read_result->>'fileId' is distinct from f.id::text or f.read_result->>'fileHash' is distinct from f.file_hash))))
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
 and a.file_hash=i.file_hash and a.storage_path=i.storage_path and i.state='saved'
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
  and a.file_hash=i.file_hash and a.storage_path=i.storage_path and i.state='saved'
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

create or replace function public.studkab_registered_read_finish(p_request uuid,p_revision integer,p_file uuid,p_lease uuid,p_version text,p_result jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; f public.studkab_intake_files;
begin
 select * into r from public.studkab_requests where id=p_request for update;
 if not found or r.deleting_at is not null or not r.intake_received
 or r.revision is distinct from p_revision
 or not exists(select 1 from public.studkab_members m where m.user_id=r.student_id)
 then return jsonb_build_object('stale',true); end if;
 select i.* into f from public.studkab_intake_files i
 join public.studkab_intake_drafts d on d.id=i.draft_id
 join public.studkab_request_attachments a on a.intake_file_id=i.id
 where i.id=p_file and d.state='submitted' and d.submitted_request_id=r.id
 and d.student_id=r.student_id
 and a.request_id=r.id and a.student_id=r.student_id and a.category='unclassified'
 and a.file_hash=i.file_hash and a.storage_path=i.storage_path
 and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id)
 for update of i;
 if not found or f.registered_read_request is distinct from p_request
 or f.registered_read_revision is distinct from p_revision
 or f.read_lease is distinct from p_lease or f.read_version is distinct from p_version
 then return jsonb_build_object('stale',true); end if;
 -- Recover a lost finish response without parsing/charging again.
 if f.read_status in ('ready','blocked','failed') and f.read_result=p_result then
  return jsonb_build_object('saved',true,'status',f.read_status,'duplicate',true);
 end if;
 if f.read_status<>'reading' then return jsonb_build_object('stale',true); end if;
 if p_result is null or jsonb_typeof(p_result)<>'object'
 or p_result->>'readerVersion' is distinct from p_version
 or p_result->>'fileId' is distinct from p_file::text
 or p_result->>'fileHash' is distinct from f.file_hash
 or coalesce(p_result->>'status','') not in ('ready','blocked','failed')
 or jsonb_typeof(p_result->'blocks') is distinct from 'array'
 or jsonb_typeof(p_result->'warnings') is distinct from 'array'
 or jsonb_typeof(p_result->'extracted_text') is distinct from 'string'
 or length(p_result->>'extracted_text')>500000 or octet_length(p_result::text)>6000000
 then return jsonb_build_object('invalid',true); end if;
 update public.studkab_intake_files set read_status=p_result->>'status',read_result=p_result,
 extracted_text=p_result->>'extracted_text',read_until=null where id=p_file;
 -- Classification/approval belongs to the next semantic step; no attachment change.
 return jsonb_build_object('saved',true,'status',p_result->>'status');
end $$;

create or replace function public.studkab_attachment_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; active_cycle uuid; i public.studkab_intake_files; replacing boolean:=false;
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
  if not found or (not replacing and (not exists(select 1 from public.studkab_intake_drafts where id=i.draft_id and student_id=new.student_id and state='open')
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

-- Те же условия, что проверяет запись вложения (studkab_attachment_limit): менять файлы
-- можно, пока подготовка не началась, либо при открытом дополнении материалов.
create or replace function public.studkab_registered_materials_open(p_request uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select not(exists(select 1 from public.studkab_gen_jobs where request_id=p_request::text)
 or exists(select 1 from public.studkab_result_versions where request_id=p_request)
 or exists(select 1 from public.studkab_results where request_id=p_request)
 or ((exists(select 1 from public.studkab_requirement_passports where request_id=p_request and status='approved')
 or exists(select 1 from public.studkab_material_revisions where request_id=p_request)
 or exists(select 1 from public.studkab_request_reassignments where request_id=p_request))
 and not exists(select 1 from public.studkab_material_revisions where request_id=p_request and closed_at is null)))
$$;
revoke all on function public.studkab_registered_materials_open(uuid) from public,anon,authenticated;
grant execute on function public.studkab_registered_materials_open(uuid) to service_role;

-- Резерв места для нового файла, заменяющего текущий файл принятой заявки.
-- Замена разрешена только тогда, когда кабинет разрешает автору менять материалы.
create or replace function public.studkab_registered_replace_reserve(p_student uuid,p_request uuid,p_attachment uuid,p_name text,p_type text,p_size integer,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
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
 if p_type not in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 or p_size is null or p_size<1 or p_size>5242880 or p_hash !~ '^[a-f0-9]{64}$' or coalesce(btrim(p_name),'')='' or length(p_name)>180 then return jsonb_build_object('invalid',true); end if;
 select * into f from public.studkab_intake_files where draft_id=d.id and file_hash=p_hash;
 if found then
  if f.supersedes is distinct from o.id or f.content_type<>p_type or f.size_bytes<>p_size then return jsonb_build_object('conflict',true); end if;
  return jsonb_build_object('file',to_jsonb(f),'duplicate',exists(select 1 from public.studkab_request_attachments where id=f.id));
 end if;
 if exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id) then return jsonb_build_object('conflict',true); end if;
 if (select coalesce(sum(size_bytes),0) from public.studkab_intake_files where draft_id=d.id)+p_size>104857600 then return jsonb_build_object('quota',true); end if;
 fid=gen_random_uuid();
 insert into public.studkab_intake_files(id,draft_id,file_name,content_type,size_bytes,file_hash,storage_path,supersedes)
 values(fid,d.id,btrim(p_name),p_type,p_size,p_hash,p_student::text||'/'||d.id::text||'/'||fid::text,o.id) returning * into f;
 return jsonb_build_object('file',to_jsonb(f),'duplicate',false);
end $$;

-- После сохранения байтов: файл отмечается сохранённым и встаёт в заявку вместо прежнего.
-- Прежний файл остаётся в истории. Номер редакции заявки растёт, поэтому прежний разбор
-- и прежние предложенные вопросы становятся устаревшими, а новый файл читается заново.
create or replace function public.studkab_registered_replace_finish(p_student uuid,p_request uuid,p_file uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; d public.studkab_intake_drafts; f public.studkab_intake_files; a public.studkab_request_attachments; cycle uuid;
begin
 select * into r from public.studkab_requests where id=p_request and student_id=p_student and deleting_at is null for update;
 if not found or not r.intake_received or r.ready_at is null or not exists(select 1 from public.studkab_members where user_id=p_student) then return jsonb_build_object('missing',true); end if;
 select * into d from public.studkab_intake_drafts where submitted_request_id=r.id and student_id=p_student and state='submitted';
 if not found then return jsonb_build_object('missing',true); end if;
 select * into f from public.studkab_intake_files where id=p_file and draft_id=d.id and file_hash=p_hash and supersedes is not null for update;
 if not found then return jsonb_build_object('missing',true); end if;
 select * into a from public.studkab_request_attachments where id=f.id and request_id=r.id;
 if found then return jsonb_build_object('attachment',jsonb_build_object('id',a.id,'file_name',a.file_name,'file_hash',a.file_hash,'supersedes',a.supersedes),'duplicate',true); end if;
 if not public.studkab_registered_materials_open(r.id) then return jsonb_build_object('locked',true,'reason','Изменения материалов закрыты: подготовка уже началась. Попросите исполнителя открыть дополнение материалов'); end if;
 select * into a from public.studkab_request_attachments o where o.request_id=r.id and o.intake_file_id=f.supersedes
  and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=o.id);
 if not found then return jsonb_build_object('conflict',true); end if;
 select id into cycle from public.studkab_material_revisions where request_id=r.id and closed_at is null;
 if f.state='pending' then update public.studkab_intake_files set state='saved',saved_at=now() where id=f.id returning * into f; end if;
 insert into public.studkab_request_attachments(id,request_id,student_id,intake_file_id,category,supersedes,material_revision_id,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text)
 values(f.id,r.id,p_student,f.id,'unclassified',a.id,cycle,f.file_name,f.content_type,f.size_bytes,f.file_hash,f.storage_path,null) returning * into a;
 return jsonb_build_object('attachment',jsonb_build_object('id',a.id,'file_name',a.file_name,'file_hash',a.file_hash,'supersedes',a.supersedes),'duplicate',false);
end $$;
revoke all on function public.studkab_registered_replace_reserve(uuid,uuid,uuid,text,text,integer,text),public.studkab_registered_replace_finish(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studkab_registered_replace_reserve(uuid,uuid,uuid,text,text,integer,text),public.studkab_registered_replace_finish(uuid,uuid,uuid,text) to service_role;
