begin;
select set_config('studkab.test_owner',(select id::text from auth.users order by created_at limit 1),true);
update public.studkab_gen_budget set limit_microusd=10 where id=true;
set local role service_role;
do $$
declare j uuid; c jsonb; r uuid;
begin
 j=public.studkab_gen_start(current_setting('studkab.test_owner')::uuid,'__service_role_test__','{}','[{"id":"one","prompt":"test","max_cost_microusd":10}]');
 c=public.studkab_gen_claim();
 r=public.studkab_gen_dispatch(j,0,(c->>'claim')::uuid);
 if r is null then raise exception 'DISPATCH_FAILED'; end if;
 if public.studkab_gen_settle(j,0,(c->>'claim')::uuid,r,'test response','{}')!='done' then raise exception 'SAVE_FAILED'; end if;
 begin update public.studkab_gen_budget set limit_microusd=100; raise exception 'HANDLER_CAN_RAISE_BUDGET'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: actual service_role can execute lifecycle but cannot increase budget' as result;
rollback;