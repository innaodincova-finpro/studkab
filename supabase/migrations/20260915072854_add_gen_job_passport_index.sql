-- C-045: cover the new passport foreign key used by generation checks.
create index if not exists studkab_gen_jobs_passport_id_idx
 on public.studkab_gen_jobs(passport_id);
