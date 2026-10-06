-- Полное удаление заявки: записи о расходах сохраняются (06.10.2026).
-- При удалении учебной заявки №2 очистка черновика остановилась: записи автоматического изучения
-- (studkab_intake_analysis_jobs) хранят стоимость и связаны с учётом расходов. Финансовая история
-- при удалении заявки сохраняется, поэтому теперь стираются записи о файлах черновика и отметки об
-- оставшихся файлах, а сам черновик — только если у него нет записей изучения и подтверждений.
create or replace function public.studkab_request_delete_intake(p_drafts uuid[],p_student uuid,p_leftovers jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claims jsonb; v_drafts uuid[]; n_files integer; n_drafts integer; n_left integer;
begin
  begin
    v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then
    v_claims:='{}'::jsonb;
  end;
  if coalesce(v_claims->>'role','')<>'service_role' then raise exception 'REQUEST_DELETE_FORBIDDEN'; end if;
  -- Только черновики этого студента, на файлы которых больше не ссылается ни одна заявка.
  select coalesce(array_agg(d.id),'{}') into v_drafts from public.studkab_intake_drafts d
  where d.id=any(coalesce(p_drafts,'{}')) and d.student_id=p_student
    and not exists(select 1 from public.studkab_request_attachments a join public.studkab_intake_files f on f.id=a.intake_file_id where f.draft_id=d.id);
  delete from public.studkab_intake_files where draft_id=any(v_drafts);
  get diagnostics n_files=row_count;
  -- Черновик с записями изучения или подтверждениями остаётся: они хранят историю расходов.
  delete from public.studkab_intake_drafts d where d.id=any(v_drafts)
    and not exists(select 1 from public.studkab_intake_analysis_jobs j where j.draft_id=d.id)
    and not exists(select 1 from public.studkab_intake_confirmations c where c.draft_id=d.id);
  get diagnostics n_drafts=row_count;
  delete from public.studkab_storage_leftovers l where l.student_id=p_student
    and exists(select 1 from jsonb_array_elements(coalesce(p_leftovers,'[]'::jsonb)) e where e->>'bucket'=l.bucket and e->>'path'=l.path);
  get diagnostics n_left=row_count;
  return jsonb_build_object('drafts',n_drafts,'files',n_files,'leftovers',n_left,'kept',coalesce(array_length(v_drafts,1),0)-n_drafts);
end $$;
revoke all on function public.studkab_request_delete_intake(uuid[],uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_request_delete_intake(uuid[],uuid,jsonb) to service_role;
