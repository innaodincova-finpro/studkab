-- C162: an extracted-text pass must never attest Word opening or page layout.
begin;

create or replace function public.studkab_ai_review_clear(p_result text,p_hash text)
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
    or not (coverage->'notChecked' @> '["C11","C12","S02"]'::jsonb)
 then return false; end if;
 -- Keep the existing fail-closed finding and exact-coverage rules.
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

commit;
