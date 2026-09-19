begin;
-- C-071: retain immutable result history; bind new reviews to the current passport.
-- The existing request FOR SHARE lock serializes this check with passport save/approve.
create or replace function public.studkab_guard_result_delivery()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews;
 p public.studkab_requirement_passports; actual uuid; context jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,713));
 select student_id into actual from public.studkab_requests where id=new.request_id for share;
 select * into v from public.studkab_result_versions where request_id=new.request_id order by revision desc limit 1;
 select * into r from public.studkab_result_reviews where id=new.review_id;
 if v.id is null or new.version_id is distinct from v.id or r.version_id is distinct from v.id or v.recipient_id is distinct from actual or new.document is distinct from v.document or not public.studkab_valid_review(r.criteria) then raise exception 'Versioned review required'; end if;
 context:=v.document->'reviewContext';
 if context is not null then
  select * into p from public.studkab_requirement_passports where request_id=new.request_id order by revision desc limit 1;
  if p.id is null or p.status<>'approved' or p.id::text is distinct from context->>'passportId'
     or p.source_fingerprint is distinct from context->>'sourceFingerprint'
     or coalesce(context->>'fingerprint','') !~ '^[a-f0-9]{64}$'
  then raise exception 'Review passport changed'; end if;
 end if;
 return new;
end $$;
revoke all on function public.studkab_guard_result_delivery() from public,anon,authenticated;
grant execute on function public.studkab_guard_result_delivery() to service_role;

-- Read-only capability marker: new clients stay blocked until the guard is installed.
create function public.studkab_result_context_version() returns integer
language sql stable security invoker set search_path=pg_catalog as $$ select 1 $$;
revoke all on function public.studkab_result_context_version() from public,anon,authenticated;
grant execute on function public.studkab_result_context_version() to service_role;
commit;
