-- R2/R4/R9. Existing project public JWT is not a secret.
-- Private cron_token is read inside PostgreSQL, never embedded or returned.
-- Recovery of running jobs remains scheduled even when the budget is fully reserved.
select cron.schedule('studkab-generation-v1','* * * * *',$schedule$
select net.http_post(
 url:='https://dcpthwmuiodrjepifzsd.supabase.co/functions/v1/studkab-generation',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjcHRod211aW9kcmplcGlmenNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDQzMTQsImV4cCI6MjEwNDEyMDMxNH0.m2q95-t6bM36I_uhJE3HYOABfdhbYoCPF0U_OsWAprY',
 'X-Studkab-Runner',(select cron_token from public.studkab_request_config where id=true)),
 body:='{}'::jsonb,timeout_milliseconds:=120000)
where exists(select 1 from public.studkab_gen_jobs where status in ('queued','running'))
 and (exists(select 1 from public.studkab_gen_budget where id=true and limit_microusd>reserved_microusd)
 or exists(select 1 from public.studkab_gen_jobs where status='running'));
$schedule$);
-- Rollback: select cron.unschedule('studkab-generation-v1');
