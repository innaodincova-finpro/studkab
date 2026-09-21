-- C-080: owner corrections before preparation; keep immutable input history.
alter table public.studkab_requests add column revision integer not null default 0;
alter table public.studkab_request_attachments add column supersedes uuid;
create unique index studkab_attachment_successor on public.studkab_request_attachments(supersedes) where supersedes is not null;
create table public.studkab_request_payload_history (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 payload jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.studkab_request_payload_history enable row level security;
revoke all on public.studkab_request_payload_history from public,anon,authenticated;
grant select,insert,delete on public.studkab_request_payload_history to service_role;
grant usage,select on sequence public.studkab_request_payload_history_id_seq to service_role;

create function public.update_studkab_request(p_request uuid,p_student uuid,p_expected jsonb,p_content jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests;
begin
 select * into r from public.studkab_requests where id=p_request and student_id=p_student for update;
 if not found or r.deleting_at is not null then return jsonb_build_object('missing',true); end if;
 if p_content->>'id' is distinct from r.client_id then return jsonb_build_object('conflict',true); end if;
 if r.payload=p_content then return jsonb_build_object('id',r.id,'number',r.number,'duplicate',true); end if;
 if r.payload is distinct from p_expected then return jsonb_build_object('conflict',true); end if;
 if exists(select 1 from public.studkab_requirement_passports where request_id=r.id)
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
 -- Same request row lock as passport save, payload update and deletion.
 select * into r from public.studkab_requests where id=new.request_id for update;
 if not found or r.deleting_at is not null or r.student_id<>new.student_id then raise exception 'Attachment request unavailable'; end if;
 if exists(select 1 from public.studkab_requirement_passports where request_id=r.id)
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

-- C-079 disables cascade triggers during graph deletion: remove new history explicitly.
create or replace function public.delete_studkab_request(
  p_request uuid,
  p_actor uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claims jsonb;
  v_jobs uuid[];
  v_versions uuid[];
  v_reviews uuid[];
  v_counts jsonb;
begin
  begin
    v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then
    v_claims:='{}'::jsonb;
  end;
  if coalesce(v_claims->>'role','')<>'service_role' then
    raise exception 'REQUEST_DELETE_FORBIDDEN';
  end if;
  if p_request is null or p_actor is null or p_reason is null
     or length(trim(p_reason)) not between 10 and 500 then
    raise exception 'REQUEST_DELETE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
  perform 1 from public.studkab_requests where id=p_request for update;
  if not found then
    return jsonb_build_object('deleted',true,'absent',true,'id',p_request);
  end if;
  if (select deleting_at is null from public.studkab_requests where id=p_request) then
    raise exception 'REQUEST_DELETE_NOT_PREPARED';
  end if;

  select coalesce(array_agg(id),'{}') into v_jobs
  from public.studkab_gen_jobs where request_id=p_request::text;
  if exists(
    select 1 from public.studkab_gen_attempts a
    where a.job_id=any(v_jobs)
      and not exists(
        select 1 from public.studkab_gen_reconciliations r
        where a.request_id=any(r.request_ids)
      )
  ) then
    raise exception 'REQUEST_DELETE_UNRECONCILED_COST';
  end if;

  select coalesce(array_agg(id),'{}') into v_versions
  from public.studkab_result_versions where request_id=p_request;
  select coalesce(array_agg(id),'{}') into v_reviews
  from public.studkab_result_reviews where version_id=any(v_versions);
  v_counts:=jsonb_build_object(
    'payload_history',(select count(*) from public.studkab_request_payload_history where request_id=p_request),
    'attachments',(select count(*) from public.studkab_request_attachments where request_id=p_request),
    'passports',(select count(*) from public.studkab_requirement_passports where request_id=p_request),
    'versions',cardinality(v_versions),
    'reviews',cardinality(v_reviews),
    'results',(select count(*) from public.studkab_results where request_id=p_request),
    'jobs',cardinality(v_jobs),
    'parts',(select count(*) from public.studkab_gen_parts where job_id=any(v_jobs)),
    'attempts',(select count(*) from public.studkab_gen_attempts where job_id=any(v_jobs)),
    'recoveries',(select count(*) from public.studkab_gen_recoveries where job_id=any(v_jobs))
  );

  -- The three immutable-history triggers and the generation-attempt trigger are
  -- intentionally bypassed only inside this revoked, service-role-only function.
  perform set_config('session_replication_role','replica',true);
  delete from public.studkab_results
    where request_id=p_request or version_id=any(v_versions) or review_id=any(v_reviews);
  delete from public.studkab_result_reviews where id=any(v_reviews);
  delete from public.studkab_result_versions where id=any(v_versions);
  delete from public.studkab_gen_recoveries where job_id=any(v_jobs);
  delete from public.studkab_gen_attempts where job_id=any(v_jobs);
  delete from public.studkab_gen_parts where job_id=any(v_jobs);
  delete from public.studkab_gen_jobs where id=any(v_jobs);
  delete from public.studkab_requirement_passports where request_id=p_request;
  delete from public.studkab_request_attachments where request_id=p_request;
  delete from public.studkab_request_payload_history where request_id=p_request;
  delete from public.studkab_requests where id=p_request;
  perform set_config('session_replication_role','origin',true);

  insert into public.studkab_request_deletion_audit(request_id,actor_id,reason,deleted_counts)
  values(p_request,p_actor,trim(p_reason),v_counts)
  on conflict(request_id) do nothing;
  return jsonb_build_object('deleted',true,'absent',false,'id',p_request,'counts',v_counts);
exception when others then
  perform set_config('session_replication_role','origin',true);
  raise;
end $$;
