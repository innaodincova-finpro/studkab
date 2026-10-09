-- UNIFIED stage 2 only. No provider calls, cron, budgets or legacy queue changes.
create table public.studkab_assistant_jobs (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.studkab_requests(id) on delete cascade,
 owner_id uuid not null references auth.users(id), operation_id uuid not null,
 provider text not null check(provider in ('claude','chatgpt','deepseek')),
 revision integer not null check(revision>0), fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 basis jsonb not null, snapshot jsonb not null, expected_sections jsonb not null,
 state text not null default 'prepared' check(state in ('prepared','queued','claimed','dispatched','completed','returning','returned','unknown','cancelled')),
 accepted_at timestamptz not null default now(), queued_at timestamptz, started_at timestamptz,
 claim uuid, lease_until timestamptz, response jsonb, return_claim uuid, return_lease_until timestamptz,
 returned_at timestamptz, result_hash text, result_path text, reviewed_at timestamptz,
 unique(owner_id,operation_id)
);
alter table public.studkab_r3_work add column assistant_job_id uuid references public.studkab_assistant_jobs(id) on delete set null;
create index studkab_assistant_request on public.studkab_assistant_jobs(request_id,accepted_at desc,id);
create unique index studkab_assistant_one_active on public.studkab_assistant_jobs(request_id)
 where state in ('prepared','queued','claimed','dispatched','completed','returning','unknown');
alter table public.studkab_assistant_jobs enable row level security;
revoke all on public.studkab_assistant_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.studkab_assistant_jobs to service_role;

create table public.studkab_assistant_operations (
 owner_id uuid not null references auth.users(id), operation_id uuid not null,
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 job_id uuid not null references public.studkab_assistant_jobs(id) on delete cascade,
 accepted_at timestamptz not null default now(), primary key(owner_id,operation_id)
);
alter table public.studkab_assistant_operations enable row level security;
revoke all on public.studkab_assistant_operations from public,anon,authenticated;
grant select,insert,delete on public.studkab_assistant_operations to service_role;
create function public.studkab_assistant_executor(p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) where u.id=p_actor)
$$;
create function public.studkab_assistant_snapshot(p_request uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; a jsonb; c jsonb; b jsonb;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into r from public.studkab_requests where id=p_request and ready_at is not null and deleting_at is null and payload->>'route'='r3';
 if not found then raise exception 'REQUEST_NOT_FOUND';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'request_id',x.request_id,'file_name',x.file_name,'content_type',x.content_type,'size_bytes',x.size_bytes,'file_hash',x.file_hash,'storage_path',x.storage_path,'supersedes',x.supersedes) order by x.id),'[]') into a from public.studkab_request_attachments x where x.request_id=r.id;
 c:=jsonb_build_object(
 'passports',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision,x.id) from public.studkab_requirement_passports x where x.request_id=r.id),'[]'),
 'materialRevisions',coalesce((select jsonb_agg(to_jsonb(x) order by x.opened_at,x.id) from public.studkab_material_revisions x where x.request_id=r.id),'[]'),
 'answers',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.studkab_clarifications x where x.request_id=r.id),'[]'),
 'returnAt',(select w.returned_at from public.studkab_r3_work w where w.request_id=r.id));
 b:=jsonb_build_object('payload',r.payload,'revision',r.revision,'attachments',a,'context',c);
 return jsonb_build_object('request',jsonb_build_object('id',r.id,'payload',r.payload,'revision',r.revision,'ready_at',r.ready_at,'deleting_at',r.deleting_at),'attachments',a,'attachmentsComplete',true,'context',c,'basis',b);
end $$;
create function public.studkab_assistant_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.request_id,new.owner_id,new.operation_id,new.provider,new.revision,new.fingerprint,new.basis,new.snapshot,new.expected_sections,new.accepted_at)
 is distinct from (old.id,old.request_id,old.owner_id,old.operation_id,old.provider,old.revision,old.fingerprint,old.basis,old.snapshot,old.expected_sections,old.accepted_at) then raise exception 'IMMUTABLE_ASSISTANT_SNAPSHOT';end if;
 if old.response is not null and new.response is distinct from old.response then raise exception 'IMMUTABLE_ASSISTANT_RESPONSE';end if;
 if old.returned_at is not null and (new.returned_at,new.result_hash,new.result_path) is distinct from (old.returned_at,old.result_hash,old.result_path) then raise exception 'IMMUTABLE_ASSISTANT_RECEIPT';end if;
 return new;
end $$;
create trigger assistant_snapshot_immutable before update on public.studkab_assistant_jobs for each row execute function public.studkab_assistant_immutable();
create function public.studkab_assistant_accept(p_request uuid,p_actor uuid,p_provider text,p_operation uuid,p_revision integer,p_fingerprint text,p_basis jsonb,p_snapshot jsonb,p_sections jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests;j public.studkab_assistant_jobs;s jsonb;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into r from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then raise exception 'REQUEST_NOT_FOUND';end if;
 select z.* into j from public.studkab_assistant_jobs z join public.studkab_assistant_operations o on o.job_id=z.id where o.owner_id=p_actor and o.operation_id=p_operation;
 if found then
  if (j.request_id,j.provider,j.revision,j.fingerprint,j.basis,j.snapshot,j.expected_sections) is distinct from (p_request,p_provider,p_revision,p_fingerprint,p_basis,p_snapshot,p_sections) then raise exception 'OPERATION_CONFLICT';end if;
  return jsonb_build_object('jobId',j.id,'duplicate',true,'state',j.state,'acceptedAt',j.accepted_at);
 end if;
 if p_provider not in ('claude','chatgpt','deepseek') or p_operation is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_revision is distinct from r.revision or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>36000000 or jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections) not between 0 and 96 then raise exception 'INVALID_JOB';end if;
 if exists(select 1 from jsonb_array_elements(p_sections) x where jsonb_typeof(x)!='string' or (x#>>'{}') !~ '^[a-zA-Z0-9_-]{1,80}$') or (select count(distinct x) from jsonb_array_elements(p_sections) x)<>jsonb_array_length(p_sections) then raise exception 'INVALID_PLAN';end if;
 s:=public.studkab_assistant_snapshot(p_request,p_actor);
 if p_basis is distinct from s->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 select * into j from public.studkab_assistant_jobs where request_id=p_request and provider=p_provider and basis=p_basis and state!='cancelled' order by accepted_at desc,id desc limit 1;
 if found then
  if j.fingerprint is distinct from p_fingerprint or j.expected_sections is distinct from p_sections or j.snapshot is distinct from p_snapshot then raise exception 'OPERATION_CONFLICT';end if;
  insert into public.studkab_assistant_operations(owner_id,operation_id,request_id,job_id) values(p_actor,p_operation,p_request,j.id);
  return jsonb_build_object('jobId',j.id,'duplicate',true,'state',j.state,'acceptedAt',j.accepted_at);
 end if;
 if exists(select 1 from public.studkab_assistant_jobs where request_id=p_request and state in ('prepared','queued','claimed','dispatched','completed','returning','unknown')) then raise exception 'ACTIVE_JOB_EXISTS';end if;
 insert into public.studkab_assistant_jobs(request_id,owner_id,operation_id,provider,revision,fingerprint,basis,snapshot,expected_sections)
 values(p_request,p_actor,p_operation,p_provider,p_revision,p_fingerprint,p_basis,p_snapshot,p_sections) returning * into j;
 insert into public.studkab_assistant_operations(owner_id,operation_id,request_id,job_id) values(p_actor,p_operation,p_request,j.id);
 return jsonb_build_object('jobId',j.id,'duplicate',false,'state',j.state,'acceptedAt',j.accepted_at);
end $$;
-- The trusted server must separately verify an available consumer before queueing.
create function public.studkab_assistant_queue(p_job uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found then raise exception 'JOB_NOT_FOUND';end if;
 if j.state='queued' then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if jsonb_array_length(j.expected_sections)=0 then raise exception 'PLAN_REQUIRED';end if;
 if j.state!='prepared' or j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'JOB_NOT_READY';end if;
 update public.studkab_assistant_jobs set state='queued',queued_at=now() where id=j.id;
 return jsonb_build_object('ok',true);
end $$;
create function public.studkab_assistant_claim(p_job uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found then raise exception 'JOB_NOT_FOUND';end if;
 if j.state='dispatched' and j.lease_until<=now() then
  update public.studkab_assistant_jobs set state='unknown' where id=j.id;return jsonb_build_object('unknown',true);
 end if;
 if j.state not in ('queued','claimed') or (j.state='claimed' and j.lease_until>now()) then return jsonb_build_object('allowed',false);end if;
 if j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 update public.studkab_assistant_jobs set state='claimed',claim=gen_random_uuid(),lease_until=now()+interval '4 minutes' where id=j.id returning * into j;
 return jsonb_build_object('allowed',true,'claim',j.claim,'snapshot',j.snapshot,'expectedSections',j.expected_sections);
end $$;
create function public.studkab_assistant_dispatch(p_job uuid,p_actor uuid,p_claim uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found or j.state!='claimed' or j.claim is distinct from p_claim or j.lease_until<=now() then raise exception 'STALE_CLAIM';end if;
 if j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 update public.studkab_assistant_jobs set state='dispatched',started_at=now(),lease_until=now()+interval '4 minutes' where id=j.id;
 return jsonb_build_object('ok',true,'dispatchId',j.claim);
end $$;
create function public.studkab_assistant_complete(p_job uuid,p_actor uuid,p_claim uuid,p_response jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if not found then raise exception 'JOB_NOT_FOUND';end if;
 if j.response is not null and j.response=p_response then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if j.state!='dispatched' or j.claim is distinct from p_claim or j.lease_until<=now() or jsonb_typeof(p_response) is distinct from 'object' or octet_length(p_response::text)>5000000 then raise exception 'UNCONFIRMED_RESULT';end if;
 if j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 if p_response->>'status' is distinct from 'completed' or p_response->>'jobId' is distinct from j.id::text or p_response->>'requestId' is distinct from j.request_id::text or p_response->>'provider' is distinct from j.provider or p_response->>'revision' is distinct from j.revision::text or p_response->>'fingerprint' is distinct from j.fingerprint or jsonb_typeof(p_response->'sections') is distinct from 'array' then raise exception 'RESULT_BINDING_CHANGED';end if;
 if jsonb_array_length(j.expected_sections)=0 or jsonb_array_length(p_response->'sections')<>jsonb_array_length(j.expected_sections) then raise exception 'INCOMPLETE_DOCUMENT';end if;
 if exists(select 1 from jsonb_array_elements(p_response->'sections') with ordinality as s(value,n)
 where s.value->>'id' is distinct from j.expected_sections->>(s.n::integer-1) or jsonb_typeof(s.value->'text') is distinct from 'string' or length(btrim(s.value->>'text'))=0) then raise exception 'INCOMPLETE_DOCUMENT';end if;
 update public.studkab_assistant_jobs set state='completed',response=p_response,claim=null,lease_until=null where id=j.id;
 return jsonb_build_object('ok',true);
end $$;
create function public.studkab_assistant_begin_return(p_job uuid,p_actor uuid,p_revision integer,p_fingerprint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select request_id into j.request_id from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor;
 if not found then raise exception 'JOB_NOT_FOUND';end if;
 perform 1 from public.studkab_requests where id=j.request_id for update;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if j.revision is distinct from p_revision or j.fingerprint is distinct from p_fingerprint then raise exception 'RESULT_BINDING_CHANGED';end if;
 if j.returned_at is not null then return jsonb_build_object('duplicate',true);end if;
 if jsonb_array_length(j.expected_sections)=0 then raise exception 'PLAN_REQUIRED';end if;
 if j.state not in ('completed','returning') or (j.state='returning' and j.return_lease_until>now()) then return jsonb_build_object('allowed',false);end if;
 if j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 update public.studkab_assistant_jobs set state='returning',return_claim=gen_random_uuid(),return_lease_until=now()+interval '4 minutes' where id=j.id returning * into j;
 return jsonb_build_object('allowed',true,'claim',j.return_claim,'expectedSections',j.expected_sections);
end $$;
create function public.studkab_assistant_commit_return(p_job uuid,p_actor uuid,p_claim uuid,p_revision integer,p_fingerprint text,p_name text,p_type text,p_size integer,p_hash text,p_path text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;v jsonb;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select request_id into j.request_id from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor;
 if not found then raise exception 'JOB_NOT_FOUND';end if;
 perform 1 from public.studkab_requests where id=j.request_id for update;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if j.revision is distinct from p_revision or j.fingerprint is distinct from p_fingerprint then raise exception 'RESULT_BINDING_CHANGED';end if;
 if j.returned_at is not null then
  if (j.result_hash,j.result_path) is distinct from (p_hash,p_path) then raise exception 'RECEIPT_CONFLICT';end if;
  return jsonb_build_object('ok',true,'duplicate',true);
 end if;
 if j.state!='returning' or j.return_claim is distinct from p_claim or j.return_lease_until<=now() then raise exception 'STALE_RETURN_CLAIM';end if;
 if j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' then raise exception 'MATERIALS_CHANGED';end if;
 if p_name is null or length(p_name) not between 1 and 180 or p_type is distinct from 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or p_size is null or p_size not between 1 and 5242880 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_path is distinct from 'r3-results/'||j.request_id::text||'/'||p_hash then raise exception 'INVALID_RESULT';end if;
 insert into public.studkab_r3_work(request_id,student_id,taken_at) select id,student_id,now() from public.studkab_requests where id=j.request_id on conflict(request_id) do nothing;
 v:=public.studkab_r3_result_set(j.request_id,p_name,p_type,p_size,p_hash,p_path);
 if v ? 'missing' or v ? 'invalid' or v ? 'not_taken' then raise exception 'RESULT_ATTACH_FAILED';end if;
 update public.studkab_r3_work set assistant_job_id=j.id where request_id=j.request_id;
 update public.studkab_assistant_jobs set state='returned',returned_at=now(),result_hash=p_hash,result_path=p_path,return_claim=null,return_lease_until=null,reviewed_at=null where id=j.id;
 return jsonb_build_object('ok',true,'duplicate',false);
end $$;
create function public.studkab_assistant_fail_return(p_job uuid,p_actor uuid,p_claim uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 update public.studkab_assistant_jobs set state='completed',return_claim=null,return_lease_until=null where id=p_job and owner_id=p_actor and state='returning' and return_claim=p_claim and returned_at is null;
 return jsonb_build_object('ok',true);
end $$;
create function public.studkab_assistant_review(p_job uuid,p_actor uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select request_id into j.request_id from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor;
 if not found then raise exception 'JOB_NOT_FOUND';end if;
 perform 1 from public.studkab_requests where id=j.request_id for update;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor for update;
 if j.state!='returned' or j.result_hash is distinct from p_hash or j.basis is distinct from public.studkab_assistant_snapshot(j.request_id,p_actor)->'basis' or not exists(select 1 from public.studkab_r3_work where request_id=j.request_id and result_hash=p_hash and assistant_job_id=j.id) then raise exception 'REVIEW_BINDING_CHANGED';end if;
 update public.studkab_assistant_jobs set reviewed_at=coalesce(reviewed_at,now()) where id=j.id returning * into j;
 return jsonb_build_object('ok',true,'reviewedAt',j.reviewed_at,'resultHash',j.result_hash);
end $$;
create function public.studkab_assistant_state(p_request uuid,p_actor uuid,p_operation uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests;j public.studkab_assistant_jobs;w public.studkab_r3_work;executor boolean;fresh boolean:=false;
begin
 executor:=public.studkab_assistant_executor(p_actor);
 select * into r from public.studkab_requests where id=p_request and deleting_at is null and ready_at is not null;
 if not found or (not executor and r.student_id is distinct from p_actor) then raise exception 'FORBIDDEN';end if;
 select * into w from public.studkab_r3_work where request_id=r.id;
 if p_operation is null then
 select * into j from public.studkab_assistant_jobs where request_id=r.id order by accepted_at desc,id desc limit 1;
 else
 select z.* into j from public.studkab_assistant_jobs z join public.studkab_assistant_operations o on o.job_id=z.id where o.request_id=r.id and o.owner_id=p_actor and o.operation_id=p_operation;
 end if;
 if j.id is not null and public.studkab_assistant_executor(j.owner_id) then fresh:=j.basis=public.studkab_assistant_snapshot(r.id,j.owner_id)->'basis';end if;
 return jsonb_build_object('accepted',j.id is not null,'job',case when j.id is null then null else jsonb_build_object('id',j.id,'requestId',r.id,'operationId',case when executor then coalesce(p_operation,j.operation_id) end,'bindingCurrent',fresh,'provider',case when executor then j.provider end,'state',j.state,'planReady',jsonb_array_length(j.expected_sections)>0,'revision',j.revision,'fingerprint',case when executor then j.fingerprint end,'acceptedAt',j.accepted_at,'queuedAt',j.queued_at,'startedAt',j.started_at,'returnedAt',j.returned_at,'reviewedAt',case when executor then j.reviewed_at end,'resultHash',case when executor then j.result_hash end) end,
 'work',jsonb_build_object('takenAt',w.taken_at,'returnedAt',w.returned_at,'downloadedAt',w.downloaded_at,'handedAt',w.handed_at,
 'result',case when executor and w.result_path is not null then jsonb_build_object('name',w.result_name,'size',w.result_size,'at',w.result_at,'hash',w.result_hash) end,
 'delivered',case when w.delivered_path is not null and (w.returned_at is null or w.delivered_at>w.returned_at) then jsonb_build_object('name',w.delivered_name,'size',w.delivered_size,'at',w.delivered_at) end));
end $$;
create function public.studkab_assistant_return_snapshot(p_job uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.studkab_assistant_jobs;
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 select * into j from public.studkab_assistant_jobs where id=p_job and owner_id=p_actor;
 if not found then raise exception 'JOB_NOT_FOUND';end if;
 return jsonb_build_object('snapshot',j.snapshot,'response',j.response,'revision',j.revision,'fingerprint',j.fingerprint,'provider',j.provider,'requestId',j.request_id);
end $$;
create or replace function public.studkab_r3_result_set(p_request uuid,p_name text,p_type text,p_size integer,p_hash text,p_path text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; w public.studkab_r3_work;
begin
 select * into r from public.studkab_requests where id=p_request and deleting_at is null and ready_at is not null and payload->>'route'='r3' for update;
 if not found then return jsonb_build_object('missing',true); end if;
 select * into w from public.studkab_r3_work where request_id=r.id for update;
 if not found or w.taken_at is null then return jsonb_build_object('not_taken',true); end if;
 if p_path is null or p_path<>'r3-results/'||r.id::text||'/'||p_hash then return jsonb_build_object('invalid',true); end if;
 update public.studkab_r3_work set assistant_job_id=null,result_name=btrim(p_name),result_type=p_type,result_size=p_size,result_hash=p_hash,result_path=p_path,result_at=now()
 where request_id=r.id returning * into w;
 return jsonb_build_object('result',jsonb_build_object('name',w.result_name,'size',w.result_size,'at',w.result_at));
end $$;

-- Preserve legacy manual delivery, but bind assistant-backed files to a current review.
create or replace function public.studkab_r3_deliver(p_request uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; w public.studkab_r3_work; j public.studkab_assistant_jobs;v integer;
begin
 select * into r from public.studkab_requests where id=p_request and deleting_at is null and ready_at is not null and payload->>'route'='r3' for update;
 if not found then return jsonb_build_object('missing',true);end if;
 select * into j from public.studkab_assistant_jobs where id=(select assistant_job_id from public.studkab_r3_work where request_id=r.id) for update;
 select * into w from public.studkab_r3_work where request_id=r.id for update;
 if w.taken_at is null then return jsonb_build_object('not_taken',true);end if;
 if w.result_path is null then return jsonb_build_object('no_result',true);end if;
 if p_hash is distinct from w.result_hash then return jsonb_build_object('changed',true);end if;
 if w.delivered_hash is not distinct from w.result_hash then return jsonb_build_object('delivered_at',w.delivered_at,'duplicate',true);end if;
 if j.id is not null and (j.reviewed_at is null or j.basis is distinct from public.studkab_assistant_snapshot(r.id,j.owner_id)->'basis') then raise exception 'ASSISTANT_REVIEW_REQUIRED';end if;
 update public.studkab_r3_work set delivered_name=result_name,delivered_type=result_type,delivered_size=result_size,delivered_hash=result_hash,
 delivered_path=result_path,delivered_at=now(),downloaded_at=null,handed_at=null,returned_at=null where request_id=r.id returning * into w;
 select coalesce(max(n),0)+1 into v from public.studkab_r3_versions where request_id=r.id;
 insert into public.studkab_r3_versions(request_id,n,name,type,size,hash,path,delivered_at) values(r.id,v,w.delivered_name,w.delivered_type,w.delivered_size,w.delivered_hash,w.delivered_path,w.delivered_at);
 return jsonb_build_object('delivered_at',w.delivered_at,'duplicate',false,'version',v);
end $$;
create function public.studkab_assistant_cancel(p_job uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not public.studkab_assistant_executor(p_actor) then raise exception 'FORBIDDEN';end if;
 update public.studkab_assistant_jobs set state='cancelled',claim=null,lease_until=null where id=p_job and owner_id=p_actor and state in ('prepared','queued','claimed');
 return jsonb_build_object('ok',found);
end $$;
create table public.studkab_assistant_events (
 job_id uuid not null references public.studkab_assistant_jobs(id) on delete cascade,
 kind text not null, event_key text not null unique, occurred_at timestamptz not null default now(),
 primary key(job_id,kind)
);
alter table public.studkab_assistant_events enable row level security;
revoke all on public.studkab_assistant_events from public,anon,authenticated;
grant select,insert,delete on public.studkab_assistant_events to service_role;
create function public.studkab_assistant_event_record() returns trigger
language plpgsql security invoker set search_path='' as $$
declare k text;
begin
 k:=case when tg_op='INSERT' then 'accepted'
 when new.reviewed_at is not null and old.reviewed_at is null then 'reviewed'
 when new.returned_at is not null and old.returned_at is null then 'returned'
 when new.started_at is not null and old.started_at is null then 'started'
 else null end;
 if k is not null then insert into public.studkab_assistant_events(job_id,kind,event_key)
 values(new.id,k,new.id::text||':'||k||':'||new.revision::text) on conflict do nothing;end if;
 return new;
end $$;
create trigger assistant_process_events after insert or update on public.studkab_assistant_jobs for each row execute function public.studkab_assistant_event_record();
-- Private RPC surface. Anonymous/authenticated cannot call even read projections.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'studkab_assistant_%' loop
  execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
  execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end $$;
