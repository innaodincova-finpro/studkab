-- C-066: a completed review may explicitly mark a criterion as not applicable,
-- but failed or unfinished manual checks must never authorize delivery.
create or replace function public.studkab_valid_review(criteria jsonb)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare code text; status text;
begin
 if criteria is null or jsonb_typeof(criteria)<>'object'
    or (select count(*) from jsonb_object_keys(criteria))<>16 then return false; end if;
 foreach code in array array['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12','C13','S01','S02','S03'] loop
  status:=coalesce(criteria->code->>'status','');
  if status not in ('pass','not_applicable')
     or jsonb_typeof(criteria->code->'evidence') is distinct from 'string'
     or length(trim(coalesce(criteria->code->>'evidence',''))) not between 10 and 2000
  then return false; end if;
 end loop;
 return true;
end $$;

revoke all on function public.studkab_valid_review(jsonb) from public,anon,authenticated;
grant execute on function public.studkab_valid_review(jsonb) to service_role;
