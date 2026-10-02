-- ROUTE-02-C1: bounded unpaid original reading after immutable receipt.
alter table public.studkab_intake_files
 add column registered_read_attempts integer not null default 0 check(registered_read_attempts between 0 and 3),
 add column registered_read_request uuid references public.studkab_requests(id) on delete set null,
 add column registered_read_revision integer;

create function public.studkab_registered_read_claim(p_version text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; f public.studkab_intake_files;
begin
 if p_version is null or p_version !~ '^[a-z0-9-]{1,60}$' then return null; end if;
 -- Lock request before file, following existing material-change operations.
 for r in select q.* from public.studkab_requests q
 join public.studkab_intake_drafts d on d.submitted_request_id=q.id
 where q.intake_received and q.ready_at is not null and q.deleting_at is null
 and d.state='submitted' and d.student_id=q.student_id
 and d.submitted_request_revision=q.revision
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

create function public.studkab_registered_read_finish(p_request uuid,p_revision integer,p_file uuid,p_lease uuid,p_version text,p_result jsonb) returns jsonb
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
 and d.student_id=r.student_id and d.submitted_request_revision=r.revision
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
revoke all on function public.studkab_registered_read_claim(text),public.studkab_registered_read_finish(uuid,integer,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_registered_read_claim(text),public.studkab_registered_read_finish(uuid,integer,uuid,uuid,text,jsonb) to service_role;
