begin;
create function public.studkab_valid_review_notes(criteria jsonb) returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare code text; c jsonb; blocked boolean:=false;
begin
 if criteria is null or jsonb_typeof(criteria)<>'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(criteria)) not between 1 and 16 then return false; end if;
 for code,c in select * from jsonb_each(criteria) loop
  if not(code=any(array['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12','C13','S01','S02','S03'])) or jsonb_typeof(c)<>'object' then return false; end if;
  if coalesce(c->>'status','') not in ('pass','not_applicable','fail','manual') or jsonb_typeof(c->'evidence') is distinct from 'string' or length(trim(c->>'evidence')) not between 10 and 2000 or jsonb_typeof(c->'section') is distinct from 'string' or length(trim(c->>'section')) not between 1 and 300 then return false; end if;
  blocked:=blocked or c->>'status' in ('fail','manual');
 end loop;
 return blocked;
end $$;
create function public.record_studkab_review_notes(request uuid,version uuid,review uuid,reviewer uuid,recipient uuid,file_hash text,document_hash text,criteria jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where request_id=request order by revision desc limit 1;
 if v.id is null or v.id<>version or v.recipient_id is distinct from actual or actual is distinct from recipient or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
 if exists(select 1 from public.studkab_results where version_id=version) then return jsonb_build_object('error','stale'); end if;
 if not exists(select 1 from public.studkab_requirement_passports p where p.request_id=request and p.status='approved' and p.id::text=v.document#>>'{reviewContext,passportId}' and p.source_fingerprint=v.document#>>'{reviewContext,sourceFingerprint}' and p.revision=(select max(revision) from public.studkab_requirement_passports where request_id=request)) then return jsonb_build_object('error','stale'); end if;
 if not public.studkab_valid_review_notes(criteria) then return jsonb_build_object('error','criteria'); end if;
 select * into r from public.studkab_result_reviews where id=review;
 if found then
  if r.version_id<>version or r.reviewer_id<>reviewer or r.criteria<>criteria then return jsonb_build_object('error','conflict'); end if;
 else
  insert into public.studkab_result_reviews(id,version_id,reviewer_id,criteria) values(review,version,reviewer,criteria) returning * into r;
 end if;
 return jsonb_build_object('reviewId',r.id,'versionId',r.version_id,'reviewedAt',r.created_at);
end $$;


create function public.studkab_guard_latest_review() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,713));
 if new.review_id is distinct from (select id from public.studkab_result_reviews where version_id=new.version_id order by created_at desc,id desc limit 1) then raise exception 'Latest version review required'; end if;
 return new;
end $$;
create trigger results_latest_review_required before insert on public.studkab_results for each row execute function public.studkab_guard_latest_review();
revoke all on function public.studkab_valid_review_notes(jsonb),public.record_studkab_review_notes(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),public.studkab_guard_latest_review() from public,anon,authenticated;
grant execute on function public.studkab_valid_review_notes(jsonb),public.record_studkab_review_notes(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),public.studkab_guard_latest_review() to service_role;
commit;
