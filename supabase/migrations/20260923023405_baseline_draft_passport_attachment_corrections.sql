-- A draft requirements passport is part of intake review, not preparation.
-- Keep student corrections open until the passport is approved or a generation
-- job exists. Existing history and request-row locking remain unchanged.
create or replace function public.update_studkab_request(
  p_request uuid,p_student uuid,p_expected jsonb,p_content jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests;
begin
 select * into r from public.studkab_requests where id=p_request and student_id=p_student for update;
 if not found or r.deleting_at is not null then return jsonb_build_object('missing',true); end if;
 if p_content->>'id' is distinct from r.client_id then return jsonb_build_object('conflict',true); end if;
 if r.payload=p_content then return jsonb_build_object('id',r.id,'number',r.number,'duplicate',true); end if;
 if r.payload is distinct from p_expected then return jsonb_build_object('conflict',true); end if;
 if exists(select 1 from public.studkab_requirement_passports where request_id=r.id and status='approved')
 or exists(select 1 from public.studkab_gen_jobs where request_id=r.id::text)
 then return jsonb_build_object('locked',true); end if;
 insert into public.studkab_request_payload_history(request_id,payload) values(r.id,r.payload);
 update public.studkab_requests set payload=p_content,revision=revision+1 where id=r.id;
 return jsonb_build_object('id',r.id,'number',r.number,'duplicate',false);
end $$;
revoke all on function public.update_studkab_request(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.update_studkab_request(uuid,uuid,jsonb,jsonb) to service_role;

create or replace function public.studkab_attachment_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests;
begin
 select * into r from public.studkab_requests where id=new.request_id for update;
 if not found or r.deleting_at is not null or r.student_id<>new.student_id then raise exception 'Attachment request unavailable'; end if;
 if exists(select 1 from public.studkab_requirement_passports where request_id=r.id and status='approved')
 or exists(select 1 from public.studkab_gen_jobs where request_id=r.id::text)
 then raise exception 'Preparation already started'; end if;
 if (select count(*) from public.studkab_request_attachments where request_id=new.request_id)>=200
 then raise exception 'Attachment history limit'; end if;
 if new.supersedes is not null then
  if not exists(select 1 from public.studkab_request_attachments a where a.id=new.supersedes
    and a.request_id=new.request_id and a.category=new.category and a.student_id=new.student_id
    and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))
  then raise exception 'Attachment version conflict'; end if;
 elsif exists(select 1 from public.studkab_request_attachments a where a.request_id=new.request_id
    and a.category=new.category and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))
 then raise exception 'Explicit replacement required';
 end if;
 if new.supersedes is null and (select count(*) from public.studkab_request_attachments a
   where a.request_id=new.request_id and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id))>=8
 then raise exception 'Attachment limit'; end if;
 update public.studkab_requests set revision=revision+1 where id=new.request_id;
 return new;
end $$;
