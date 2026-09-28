-- R8/R13: a reported unresolved issue for this exact Word and passport
-- cannot be hidden by a positive manual review or a direct delivery RPC.
begin;

create function public.studkab_ai_review_clear(p_result text,p_hash text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare report jsonb; coverage jsonb;
begin
 report:=p_result::jsonb;
 coverage:=report->'coverage';
 if report->>'wordHash' is distinct from p_hash
    or jsonb_typeof(report->'findings') is distinct from 'array'
    or jsonb_typeof(coverage->'checked') is distinct from 'array'
    or jsonb_typeof(coverage->'notChecked') is distinct from 'array'
    or jsonb_array_length(coverage->'checked')+jsonb_array_length(coverage->'notChecked')<>16
 then return false; end if;
 -- A lack of proof (for example, visual opening in Word) stays visible for the
 -- human 16-criterion check. A concrete model finding marked fail blocks.
 if exists(select 1 from jsonb_array_elements(report->'findings') f
   where jsonb_typeof(f) is distinct from 'object'
      or f->>'status' is distinct from 'needs_evidence'
      or not (coalesce(f->>'code','') = any(array['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12','C13','S01','S02','S03']))
      or length(trim(coalesce(f->>'location','')))=0
      or length(trim(coalesce(f->>'requirement','')))=0
      or length(trim(coalesce(f->>'observation','')))=0
 ) then return false; end if;
 if (select count(distinct code) from (
      select jsonb_array_elements_text(coverage->'checked') code
      union all select jsonb_array_elements_text(coverage->'notChecked') code
     ) codes where code=any(array['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12','C13','S01','S02','S03']))<>16
 then return false; end if;
 return true;
exception when others then return false;
end $$;

create or replace function public.studkab_quality_check(p_request uuid,p_version uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare c jsonb; e public.studkab_quality_evidence; k text; ids jsonb:='{}'; missing jsonb:='[]';
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
 if exists(
  select 1 from public.studkab_gen_jobs j
  left join public.studkab_gen_parts part on part.job_id=j.id and part.spec->>'id'='quality_review'
  where j.request_id=p_request::text
   and j.snapshot#>>'{input,review_target,versionId}'=p_version::text
   and j.snapshot#>>'{input,review_target,fileHash}'=c->>'fileHash'
   and j.snapshot#>>'{input,review_target,passportId}'=c->>'passportId'
   and (j.status in ('queued','running')
        or (part.state='done' and not public.studkab_ai_review_clear(part.result,c->>'fileHash')))
 ) then missing:=missing||jsonb_build_array('ai_review_open'); end if;
 return jsonb_build_object('eligible',jsonb_array_length(missing)=0,
  'blockingCodes',missing,'evidenceIds',ids,'bindings',c);
end $$;

revoke all on function public.studkab_ai_review_clear(text,text) from public,anon,authenticated;
grant execute on function public.studkab_ai_review_clear(text,text) to service_role;
commit;
