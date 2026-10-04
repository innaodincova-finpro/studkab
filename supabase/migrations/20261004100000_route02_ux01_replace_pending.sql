-- ROUTE-02-C, UX-01. Замена файла различает три случая отказа, чтобы кабинет показал
-- студенту понятную причину: выбран тот же файл, что уже стоит в заявке (same); такой файл
-- уже есть в заявке на другом месте (conflict/duplicate); заменяемая редакция уже заменена
-- (conflict/replaced). Проверки, права и порядок блокировок прежние.
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
 if p_type not in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
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
revoke all on function public.studkab_registered_replace_reserve(uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.studkab_registered_replace_reserve(uuid,uuid,uuid,text,text,integer,text) to service_role;

-- UX-01: есть ли бесплатное чтение или разрешённое изучение, которое ждёт обработчика.
-- Плановый запуск генерации раньше срабатывал только при заданиях генерации, поэтому
-- после замены файла чтение и изучение не начинались без ручного вызова.
-- Условия повторяют выборку studkab_registered_read_claim и studkab_registered_analysis_next;
-- платный разбор по-прежнему ограничен политикой и резервом при отправке.
create or replace function public.studkab_intake_work_pending() returns boolean
language sql security invoker set search_path='' as $$
 select exists(
  select 1 from public.studkab_requests q
  join public.studkab_request_attachments a on a.request_id=q.id and a.student_id=q.student_id
  join public.studkab_intake_files i on i.id=a.intake_file_id
  where q.intake_received and q.ready_at is not null and q.deleting_at is null
  and i.state='saved' and i.registered_read_attempts<3
  and i.read_status not in ('ready','blocked')
  and (i.read_status<>'reading' or i.read_until is null or i.read_until<=now())
  and not exists(select 1 from public.studkab_request_attachments s where s.supersedes=a.id))
 or (exists(select 1 from public.studkab_intake_analysis_policy where id and enabled and limit_microusd>0)
  and (exists(select 1 from public.studkab_intake_analysis_jobs where state in ('queued','claimed','budget'))
   or public.studkab_registered_analysis_next() is not null))
$$;
revoke all on function public.studkab_intake_work_pending() from public,anon,authenticated;
grant execute on function public.studkab_intake_work_pending() to service_role;
