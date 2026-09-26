-- C121: publish a request for executor review when it has an actual assignment
-- attachment or a written description. Passport approval still checks the
-- materials required by this particular assignment.
begin;
create or replace function public.studkab_request_publish(p_request uuid,p_student uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.studkab_requests;
begin
 select * into r from public.studkab_requests where id=p_request and student_id=p_student and deleting_at is null for update;
 if not found then return jsonb_build_object('missing',true); end if;
 if r.ready_at is not null then return jsonb_build_object('ready',true,'number',r.number,'duplicate',true); end if;
 if not exists (
   select 1 from public.studkab_request_attachments a
   where a.request_id=p_request and a.category='assignment'
     and not exists (select 1 from public.studkab_request_attachments successor where successor.supersedes=a.id)
 ) and length(btrim(coalesce(r.payload->>'rq',''))) < 15 then
   return jsonb_build_object('incomplete',true,'required','assignment_or_description');
 end if;
 update public.studkab_requests set ready_at=now(),retry_at=now() where id=p_request;
 return jsonb_build_object('ready',true,'number',r.number,'duplicate',false);
end $$;
revoke all on function public.studkab_request_publish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studkab_request_publish(uuid,uuid) to service_role;
commit;
