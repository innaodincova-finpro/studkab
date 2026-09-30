-- C177-P7: preserve both model outputs; no single-pass positive upgrade.
begin;

alter table public.studkab_gen_parts drop constraint studkab_gen_parts_failure_reason_check;
alter table public.studkab_gen_parts add constraint studkab_gen_parts_failure_reason_check
 check (failure_reason in ('CONTEXT_TOO_BIG','PREPARATION_UNAVAILABLE','REVIEW_FIRST_INVALID'));

create or replace function public.studkab_gen_fail_preparation(
 p_job uuid,p_ordinal integer,p_claim uuid,p_reason text
) returns text language plpgsql security invoker set search_path='' as $$
declare p public.studkab_gen_parts;
begin
 if p_reason not in ('CONTEXT_TOO_BIG','PREPARATION_UNAVAILABLE','REVIEW_FIRST_INVALID') then
  raise exception 'INVALID_PREPARATION_REASON';
 end if;
 perform 1 from public.studkab_gen_jobs where id=p_job for update;
 if not found then raise exception 'JOB_NOT_FOUND'; end if;
 select * into p from public.studkab_gen_parts
  where job_id=p_job and ordinal=p_ordinal for update;
 if not found or p.state!='claimed' or p.claim is distinct from p_claim
    or p.lease_until<=clock_timestamp() then raise exception 'STALE_CLAIM'; end if;
 update public.studkab_gen_parts set state='unknown',failure_stage='preparation',
  failure_reason=p_reason,failure_count=failure_count+1,failure_at=clock_timestamp(),
  lease_until=null
  where job_id=p_job and ordinal=p_ordinal;
 update public.studkab_gen_jobs set status='unknown' where id=p_job;
 return p_reason;
end
$$;

create function public.studkab_two_pass_consistent(p_first text,p_final text,p_hash text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare a jsonb; b jsonb; r jsonb; previous jsonb;
begin
 a:=p_first::jsonb; b:=p_final::jsonb;
 if a->>'wordHash' is distinct from p_hash or b->>'wordHash' is distinct from p_hash
  or jsonb_typeof(a->'requirements') is distinct from 'array'
  or jsonb_typeof(b->'requirements') is distinct from 'array'
  or jsonb_typeof(a->'findings') is distinct from 'array'
  or jsonb_typeof(b->'findings') is distinct from 'array'
  or jsonb_array_length(a->'requirements')=0
  or jsonb_array_length(a->'requirements')<>jsonb_array_length(b->'requirements')
 then return false; end if;
 for r in select value from jsonb_array_elements(b->'requirements') loop
  if length(coalesce(r->>'id',''))=0 or coalesce(r->>'status','') not in ('pass','fail','not_checked')
   or (select count(*) from jsonb_array_elements(b->'requirements') x where x->>'id'=r->>'id')<>1
   or (select count(*) from jsonb_array_elements(a->'requirements') x where x->>'id'=r->>'id')<>1
  then return false; end if;
  select value into previous from jsonb_array_elements(a->'requirements') x where x->>'id'=r->>'id';
  if coalesce(previous->>'status','') not in ('pass','fail','not_checked') then return false; end if;
  if r->>'status'='pass' and (
    previous->>'status' is distinct from 'pass'
    or previous->>'sourceId' is distinct from r->>'sourceId'
    or length(trim(coalesce(previous->>'sourceQuote','')))<12
    or length(trim(coalesce(previous->>'wordQuote','')))<12
    or length(trim(coalesce(previous->>'wordLocator','')))<3
    or length(trim(coalesce(previous->>'explanation','')))<10
    or exists(select 1 from jsonb_array_elements(a->'findings') x where x->>'requirementId'=r->>'id')
    or exists(select 1 from jsonb_array_elements(b->'findings') x where x->>'requirementId'=r->>'id')
  ) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function public.studkab_two_pass_job_clear(p_job uuid,p_hash text)
returns boolean language plpgsql stable security invoker set search_path='' as $$
begin
 return exists(
  select 1 from public.studkab_gen_jobs j
  join public.studkab_gen_parts a on a.job_id=j.id and a.ordinal=0 and a.spec->>'id'='quality_evidence' and a.state='done'
  join public.studkab_gen_parts b on b.job_id=j.id and b.ordinal=1 and b.spec->>'id'='quality_review' and b.state='done'
  where j.id=p_job and j.status='complete'
   and j.snapshot#>'{input,review_protocol}'='2'::jsonb
   and j.snapshot#>>'{input,review_target,fileHash}'=p_hash
   and (select count(*) from public.studkab_gen_parts x where x.job_id=j.id)=2
   and public.studkab_two_pass_consistent(a.result,b.result,p_hash)
   and not exists(select 1 from jsonb_array_elements(a.result::jsonb->'requirements') x where x->>'status'='fail')
   and not exists(select 1 from jsonb_array_elements(b.result::jsonb->'requirements') x where x->>'status'='fail')
   and public.studkab_ai_review_clear(a.result,p_hash)
   and public.studkab_ai_review_clear(b.result,p_hash)
 );
exception when others then return false;
end $$;

create or replace function public.studkab_requirement_review_ingest(p_request uuid,p_version uuid,p_job uuid,p_actor uuid,p_requirements jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b uuid; s public.studkab_result_requirement_snapshots; j public.studkab_gen_jobs;
 first_part public.studkab_gen_parts; part public.studkab_gen_parts; item jsonb; row jsonb; n integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
 if not exists(select 1 from auth.users u join public.studkab_request_config c
  on lower(u.email)=lower(c.executor_email) where u.id=p_actor) then raise exception 'FORBIDDEN'; end if;
 b:=public.studkab_current_result_binding(p_request,p_version);
 select * into s from public.studkab_result_requirement_snapshots where binding_id=b;
 select * into j from public.studkab_gen_jobs where id=p_job and request_id=p_request::text and status='complete';
 select * into part from public.studkab_gen_parts where job_id=p_job and spec->>'id'='quality_review' and state='done';
 select * into first_part from public.studkab_gen_parts where job_id=p_job and spec->>'id'='quality_evidence' and ordinal=0 and state='done';
 if j.snapshot#>'{input,review_protocol}' is distinct from '2'::jsonb or first_part.job_id is null
  or part.ordinal is distinct from 1
  or (select count(*) from public.studkab_gen_parts x where x.job_id=p_job)<>2
  or not public.studkab_two_pass_consistent(first_part.result,part.result,s.file_hash)
 then raise exception 'REQUIREMENT_REVIEW_TWO_PASS_REQUIRED'; end if;
 if s.binding_id is null or j.id is null or part.job_id is null
 or j.snapshot#>>'{input,review_target,versionId}' is distinct from p_version::text
 or j.snapshot#>>'{input,review_target,fileHash}' is distinct from s.file_hash
 or j.snapshot#>>'{input,review_target,passportId}' is distinct from s.passport_id::text
 or jsonb_typeof(p_requirements) is distinct from 'array'
 or (part.result::jsonb)->'requirements' is distinct from p_requirements
 or jsonb_array_length(p_requirements)<>jsonb_array_length(s.items)
 then raise exception 'REQUIREMENT_REVIEW_STALE'; end if;
 for item in select value from jsonb_array_elements(s.items) loop
  select value into row from jsonb_array_elements(p_requirements)
   where value->>'id'=item->>'id';
  if row is null or (select count(*) from jsonb_array_elements(p_requirements)
    where value->>'id'=item->>'id')<>1
   or row->>'status' not in ('pass','fail','not_checked')
   or length(coalesce(row->>'sourceId',''))>80
   or length(coalesce(row->>'sourceQuote',''))>2000
   or length(coalesce(row->>'wordQuote',''))>2000
   or length(coalesce(row->>'wordLocator',''))>500
   or length(coalesce(row->>'explanation',''))>2000
   or (row->>'status'='pass' and (row->>'sourceId' is distinct from item->>'source_attachment_id'
     or length(trim(coalesce(row->>'sourceQuote','')))<12
     or length(trim(coalesce(row->>'wordQuote','')))<12
     or length(trim(coalesce(row->>'wordLocator','')))<3))
  then raise exception 'REQUIREMENT_REVIEW_INVALID'; end if;
  insert into public.studkab_result_requirement_evidence(binding_id,item_id,disposition,source_locator,word_locator,
   source_quote,word_quote,explanation,actor_id,review_job_id)
  values(b,item->>'id',row->>'status',coalesce(nullif(row->>'sourceId',''),'не подтверждено'),
   coalesce(row->>'wordLocator',''),coalesce(row->>'sourceQuote',''),coalesce(row->>'wordQuote',''),
   coalesce(row->>'explanation',''),p_actor,p_job)
  on conflict(review_job_id,item_id) where review_job_id is not null do nothing;
  n:=n+1;
 end loop;
 return jsonb_build_object('bindingId',b,'items',n,'jobId',p_job);
end $$;

create or replace function public.studkab_quality_check(p_request uuid,p_version uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare c jsonb; e public.studkab_quality_evidence; k text; ids jsonb:='{}'; missing jsonb:='[]'; coverage jsonb;
begin
 c:=public.studkab_quality_context(p_request,p_version);
 foreach k in array array['internal_borrowing','external_originality'] loop
  select * into e from public.studkab_quality_evidence e1
   join public.studkab_quality_evidence_bindings eb on eb.evidence_id=e1.id
   where e1.version_id=p_version and e1.kind=k
    and eb.binding_id=public.studkab_current_result_binding(p_request,p_version)
   order by e1.sequence desc limit 1;
  if e.id is null or e.payload->>'disposition' is distinct from 'pass'
     or e.passport_id::text is distinct from c->>'passportId'
  then missing:=missing||jsonb_build_array(k);
  else ids:=ids||jsonb_build_object(k,e.id); end if;
 end loop;
 -- A positive manual review is never sufficient without a completed model
 -- report bound to the current immutable Word and approved passport.
 if not exists(
  select 1 from public.studkab_gen_jobs j
  join public.studkab_gen_parts part on part.job_id=j.id and part.spec->>'id'='quality_review'
  where j.request_id=p_request::text
   and j.snapshot#>>'{input,review_target,versionId}'=p_version::text
   and j.snapshot#>>'{input,review_target,fileHash}'=c->>'fileHash'
   and j.snapshot#>>'{input,review_target,passportId}'=c->>'passportId'
   and j.status='complete' and part.state='done'
   and public.studkab_two_pass_job_clear(j.id,c->>'fileHash')
 ) then missing:=missing||jsonb_build_array('ai_review_required'); end if;
 if exists(
  select 1 from public.studkab_gen_jobs j
  left join public.studkab_gen_parts part on part.job_id=j.id and part.spec->>'id'='quality_review'
  left join public.studkab_gen_parts first_part on first_part.job_id=j.id and first_part.spec->>'id'='quality_evidence'
  where j.request_id=p_request::text
   and j.snapshot#>>'{input,review_target,fileHash}'=c->>'fileHash'
   and ((j.snapshot#>>'{input,review_target,versionId}'=p_version::text
         and j.snapshot#>>'{input,review_target,passportId}'=c->>'passportId'
         and j.status in ('queued','running'))
        or j.status='unknown' or part.state='unknown' or first_part.state='unknown'
        or (part.state='done' and not public.studkab_ai_review_clear(part.result,c->>'fileHash'))
        or (first_part.state='done' and not public.studkab_ai_review_clear(first_part.result,c->>'fileHash'))
        or (j.snapshot#>'{input,review_protocol}'='2'::jsonb and j.status='complete'
            and not public.studkab_two_pass_job_clear(j.id,c->>'fileHash')))
 ) then missing:=missing||jsonb_build_array('ai_review_open'); end if;
 coverage:=public.studkab_requirement_coverage_check(p_request,p_version);
 if coverage->>'eligible' is distinct from 'true' then missing:=missing||jsonb_build_array('requirement_coverage'); end if;
 return jsonb_build_object('eligible',jsonb_array_length(missing)=0,
  'blockingCodes',missing,'evidenceIds',ids,'bindings',c,'requirementCoverage',coverage);
end $$;

revoke all on function public.studkab_two_pass_consistent(text,text,text),
 public.studkab_two_pass_job_clear(uuid,text) from public,anon,authenticated;
grant execute on function public.studkab_two_pass_consistent(text,text,text),
 public.studkab_two_pass_job_clear(uuid,text) to service_role;
-- Two-pass paid unknowns stay retained for explicit reconciliation; the
-- existing recovery policy for other generation jobs remains unchanged.
create or replace function public.studkab_gen_recover_unknown()
returns integer language plpgsql security invoker set search_path='' as $$
declare p record; n integer=0; tries integer;
begin
 for p in
  select x.* from public.studkab_gen_parts x
  join public.studkab_gen_jobs j on j.id=x.job_id
  where x.state='unknown' and x.failure_stage is null
    and j.snapshot#>'{input,review_protocol}' is distinct from '2'::jsonb
    and j.status not in ('cancelled','stale')
  order by x.job_id,x.ordinal limit 200
 loop
  select count(*) into tries from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal;
  if tries>=2 then continue; end if;
  if exists(select 1 from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal and t.state='sent') then continue; end if;
  if exists(select 1 from public.studkab_gen_attempts t
   where t.job_id=p.job_id and t.ordinal=p.ordinal and t.detail->>'finish_reason'='length') then continue; end if;
  update public.studkab_gen_parts
   set state='queued',claim=null,lease_until=null,request_id=null
   where job_id=p.job_id and ordinal=p.ordinal and state='unknown' and failure_stage is null;
  if found then
   insert into public.studkab_gen_recoveries(job_id,ordinal,attempts_before)
    values(p.job_id,p.ordinal,tries);
   n=n+1;
  end if;
 end loop;
 update public.studkab_gen_jobs j set status='queued'
 where j.status='unknown'
 and j.snapshot#>'{input,review_protocol}' is distinct from '2'::jsonb
 and not exists(select 1 from public.studkab_gen_parts x
  where x.job_id=j.id and x.state='unknown');
 return n;
end
$$;
commit;
