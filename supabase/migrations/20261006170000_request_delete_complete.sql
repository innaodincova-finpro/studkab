-- Полное удаление заявки (05.10.2026, по поручению владельца удалить учебную заявку №2 «отовсюду»).
-- Раньше удаление стирало заявку и копии файлов в материалах заявки, но оставляло исходные файлы,
-- загруженные студентом (хранилище studkab-intake-materials), и записи черновика. Теперь план удаления
-- возвращает и их, а после удаления заявки черновик и его файлы стираются.
-- Отдельно: перечень оставшихся без записей файлов (studkab_storage_leftovers) — исполнитель вносит их
-- вручную после сверки; они удаляются вместе с ближайшей заявкой того же студента.

create table public.studkab_storage_leftovers (
 bucket text not null check(bucket in ('studkab-request-materials','studkab-intake-materials')),
 path text not null check(length(path) between 3 and 400),
 student_id uuid not null,
 note text not null default '',
 created_at timestamptz not null default now(),
 primary key(bucket,path)
);
alter table public.studkab_storage_leftovers enable row level security;
revoke all on public.studkab_storage_leftovers from public,anon,authenticated;
grant select,delete on public.studkab_storage_leftovers to service_role;

create or replace function public.prepare_studkab_request_delete(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claims jsonb;
  v_jobs uuid[];
  v_paths jsonb;
  v_student uuid;
  v_drafts jsonb;
  v_intake jsonb;
  v_left jsonb;
begin
  begin
    v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then
    v_claims:='{}'::jsonb;
  end;
  if coalesce(v_claims->>'role','')<>'service_role' then raise exception 'REQUEST_DELETE_FORBIDDEN'; end if;
  if p_request is null then raise exception 'REQUEST_DELETE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
  select student_id into v_student from public.studkab_requests where id=p_request for update;
  if not found then return jsonb_build_object('absent',true,'paths','[]'::jsonb); end if;
  select coalesce(array_agg(id),'{}') into v_jobs from public.studkab_gen_jobs where request_id=p_request::text;
  if exists(
    select 1 from public.studkab_gen_attempts a where a.job_id=any(v_jobs)
      and not exists(select 1 from public.studkab_gen_reconciliations r where a.request_id=any(r.request_ids))
  ) then raise exception 'REQUEST_DELETE_UNRECONCILED_COST'; end if;
  update public.studkab_requests set deleting_at=coalesce(deleting_at,clock_timestamp()) where id=p_request;
  select coalesce(jsonb_agg(p order by p),'[]'::jsonb) into v_paths from (
    select storage_path p from public.studkab_request_attachments where request_id=p_request
    union select result_path from public.studkab_r3_work where request_id=p_request and result_path is not null
    union select delivered_path from public.studkab_r3_work where request_id=p_request and delivered_path is not null
    union select path from public.studkab_r3_versions where request_id=p_request
    union select path from public.studkab_r3_return_files where request_id=p_request
  ) s;
  -- Черновики, из которых собрана заявка, и их исходные файлы — только если других заявок на них нет.
  select coalesce(jsonb_agg(distinct f.draft_id),'[]'::jsonb) into v_drafts
  from public.studkab_request_attachments a join public.studkab_intake_files f on f.id=a.intake_file_id
  where a.request_id=p_request
    and not exists(select 1 from public.studkab_request_attachments o join public.studkab_intake_files g on g.id=o.intake_file_id
                   where g.draft_id=f.draft_id and o.request_id<>p_request);
  select coalesce(jsonb_agg(distinct f.storage_path),'[]'::jsonb) into v_intake
  from public.studkab_intake_files f where f.draft_id in (select (jsonb_array_elements_text(v_drafts))::uuid) and f.storage_path is not null;
  select coalesce(jsonb_agg(jsonb_build_object('bucket',l.bucket,'path',l.path)),'[]'::jsonb) into v_left
  from public.studkab_storage_leftovers l where l.student_id=v_student;
  return jsonb_build_object('absent',false,'paths',v_paths,'drafts',v_drafts,'intakePaths',v_intake,'leftovers',v_left,'student',v_student);
end $$;
revoke all on function public.prepare_studkab_request_delete(uuid)
  from public,anon,authenticated;
grant execute on function public.prepare_studkab_request_delete(uuid)
  to service_role;

-- После удаления заявки: стереть черновики и записи их файлов (файлы в хранилище уже удалены),
-- и снять отметки об удалённых оставшихся файлах студента.
create function public.studkab_request_delete_intake(p_drafts uuid[],p_student uuid,p_leftovers jsonb)
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
  delete from public.studkab_intake_analysis_jobs where draft_id=any(v_drafts);
  delete from public.studkab_intake_confirmations where draft_id=any(v_drafts);
  delete from public.studkab_intake_files where draft_id=any(v_drafts);
  get diagnostics n_files=row_count;
  delete from public.studkab_intake_drafts where id=any(v_drafts);
  get diagnostics n_drafts=row_count;
  delete from public.studkab_storage_leftovers l where l.student_id=p_student
    and exists(select 1 from jsonb_array_elements(coalesce(p_leftovers,'[]'::jsonb)) e where e->>'bucket'=l.bucket and e->>'path'=l.path);
  get diagnostics n_left=row_count;
  return jsonb_build_object('drafts',n_drafts,'files',n_files,'leftovers',n_left);
end $$;
revoke all on function public.studkab_request_delete_intake(uuid[],uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studkab_request_delete_intake(uuid[],uuid,jsonb) to service_role;
