-- ROUTE-03, этап R3-D (05.10.2026): «Я сдал работу» и «Вернули на доработку».
-- Студент отмечает сдачу; если преподаватель вернул работу — пишет замечания и прикладывает файлы.
-- Заявка возвращается исполнителю на шаг «В работе» (доработка № N); каждая переданная версия
-- сохраняется в истории. Доступ к таблицам и функциям — только service_role.

alter table public.studkab_r3_work
 add column handed_at timestamptz,
 add column returns integer not null default 0 check(returns between 0 and 50),
 add column returned_at timestamptz;

-- Каждая переданная студенту версия работы.
create table public.studkab_r3_versions (
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 n integer not null check(n between 1 and 100),
 name text not null check(length(name) between 1 and 180),
 type text not null,
 size integer not null check(size between 1 and 5242880),
 hash text not null check(hash ~ '^[a-f0-9]{64}$'),
 path text not null,
 delivered_at timestamptz not null,
 primary key(request_id,n)
);

-- Возвраты на доработку: замечания преподавателя со слов студента.
create table public.studkab_r3_returns (
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 n integer not null check(n between 1 and 50),
 student_id uuid not null,
 comment text not null check(length(btrim(comment)) between 3 and 2000),
 created_at timestamptz not null default now(),
 primary key(request_id,n)
);

-- Файлы с замечаниями. Пока возврат не отправлен, return_n пустой (файл ждёт в форме).
create table public.studkab_r3_return_files (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.studkab_requests(id) on delete cascade,
 student_id uuid not null,
 return_n integer,
 name text not null check(length(name) between 1 and 180),
 type text not null check(type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp')),
 size integer not null check(size between 1 and 5242880),
 hash text not null check(hash ~ '^[a-f0-9]{64}$'),
 path text not null,
 created_at timestamptz not null default now(),
 foreign key(request_id,return_n) references public.studkab_r3_returns(request_id,n) on delete cascade
);
create unique index studkab_r3_return_files_once on public.studkab_r3_return_files(request_id,coalesce(return_n,0),hash);

alter table public.studkab_r3_versions enable row level security;
alter table public.studkab_r3_returns enable row level security;
alter table public.studkab_r3_return_files enable row level security;
revoke all on public.studkab_r3_versions,public.studkab_r3_returns,public.studkab_r3_return_files from public,anon,authenticated;
grant select,insert on public.studkab_r3_versions,public.studkab_r3_returns to service_role;
grant select,insert,update,delete on public.studkab_r3_return_files to service_role;

-- Передача: та же проверка, что в R3-C, плюс запись версии в историю и сброс отметок о сдаче и возврате
-- (returned_at заполнен, пока после возврата не передана новая версия).
create or replace function public.studkab_r3_deliver(p_request uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; w public.studkab_r3_work; v integer;
begin
 select * into r from public.studkab_requests where id=p_request and deleting_at is null and ready_at is not null and payload->>'route'='r3' for update;
 if not found then return jsonb_build_object('missing',true); end if;
 select * into w from public.studkab_r3_work where request_id=r.id for update;
 if not found or w.taken_at is null then return jsonb_build_object('not_taken',true); end if;
 if w.result_path is null then return jsonb_build_object('no_result',true); end if;
 -- Передаётся ровно тот файл, который исполнитель видел на экране.
 if p_hash is distinct from w.result_hash then return jsonb_build_object('changed',true); end if;
 if w.delivered_hash is not distinct from w.result_hash then return jsonb_build_object('delivered_at',w.delivered_at,'duplicate',true); end if;
 update public.studkab_r3_work set delivered_name=result_name,delivered_type=result_type,delivered_size=result_size,delivered_hash=result_hash,
  delivered_path=result_path,delivered_at=now(),downloaded_at=null,handed_at=null,returned_at=null where request_id=r.id returning * into w;
 select coalesce(max(n),0)+1 into v from public.studkab_r3_versions where request_id=r.id;
 insert into public.studkab_r3_versions(request_id,n,name,type,size,hash,path,delivered_at)
 values(r.id,v,w.delivered_name,w.delivered_type,w.delivered_size,w.delivered_hash,w.delivered_path,w.delivered_at);
 return jsonb_build_object('delivered_at',w.delivered_at,'duplicate',false,'version',v);
end $$;

-- «Я сдал работу»: только своя заявка, только после передачи текущей версии.
create function public.studkab_r3_hand(p_request uuid,p_student uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.studkab_r3_work;
begin
 select * into w from public.studkab_r3_work where request_id=p_request and student_id=p_student
  and exists(select 1 from public.studkab_requests q where q.id=p_request and q.student_id=p_student and q.deleting_at is null) for update;
 if not found or w.delivered_at is null then return jsonb_build_object('missing',true); end if;
 if w.returned_at is not null then return jsonb_build_object('returned',true); end if;
 update public.studkab_r3_work set handed_at=coalesce(handed_at,now()) where request_id=p_request returning * into w;
 return jsonb_build_object('handed_at',w.handed_at);
end $$;

-- Файл с замечаниями: принимается только после «Я сдал работу», не больше 10 в одной форме.
create function public.studkab_r3_return_file_add(p_request uuid,p_student uuid,p_name text,p_type text,p_size integer,p_hash text,p_path text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.studkab_r3_work; f public.studkab_r3_return_files;
begin
 select * into w from public.studkab_r3_work where request_id=p_request and student_id=p_student
  and exists(select 1 from public.studkab_requests q where q.id=p_request and q.student_id=p_student and q.deleting_at is null) for update;
 if not found or w.handed_at is null then return jsonb_build_object('not_handed',true); end if;
 if p_path is null or p_path<>'r3-returns/'||p_request::text||'/'||p_hash then return jsonb_build_object('invalid',true); end if;
 select * into f from public.studkab_r3_return_files where request_id=p_request and return_n is null and hash=p_hash;
 if found then return jsonb_build_object('id',f.id,'duplicate',true); end if;
 if (select count(*) from public.studkab_r3_return_files where request_id=p_request and return_n is null)>=10 then return jsonb_build_object('too_many',true); end if;
 insert into public.studkab_r3_return_files(request_id,student_id,name,type,size,hash,path)
 values(p_request,p_student,btrim(p_name),p_type,p_size,p_hash,p_path) returning * into f;
 return jsonb_build_object('id',f.id,'duplicate',false);
end $$;

-- Убрать файл из формы до отправки. Возвращает путь, если файл больше нигде не используется.
create function public.studkab_r3_return_file_remove(p_request uuid,p_student uuid,p_file uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f public.studkab_r3_return_files;
begin
 delete from public.studkab_r3_return_files where id=p_file and request_id=p_request and student_id=p_student and return_n is null returning * into f;
 if not found then return jsonb_build_object('missing',true); end if;
 return jsonb_build_object('path',case when exists(select 1 from public.studkab_r3_return_files where path=f.path) then null else f.path end);
end $$;

-- «Вернули на доработку»: записывает замечания, прикрепляет файлы из формы, возвращает заявку в работу.
create function public.studkab_r3_return(p_request uuid,p_student uuid,p_comment text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.studkab_r3_work; v integer;
begin
 select * into w from public.studkab_r3_work where request_id=p_request and student_id=p_student
  and exists(select 1 from public.studkab_requests q where q.id=p_request and q.student_id=p_student and q.deleting_at is null) for update;
 if not found or w.handed_at is null then return jsonb_build_object('not_handed',true); end if;
 if p_comment is null or length(btrim(p_comment)) not between 3 and 2000 then return jsonb_build_object('invalid',true); end if;
 v:=w.returns+1;
 if v>50 then return jsonb_build_object('too_many',true); end if;
 insert into public.studkab_r3_returns(request_id,n,student_id,comment) values(p_request,v,p_student,btrim(p_comment));
 update public.studkab_r3_return_files set return_n=v where request_id=p_request and return_n is null;
 update public.studkab_r3_work set returns=v,returned_at=now(),handed_at=null where request_id=p_request returning * into w;
 return jsonb_build_object('n',v,'returned_at',w.returned_at);
end $$;

revoke all on function public.studkab_r3_hand(uuid,uuid),
 public.studkab_r3_return_file_add(uuid,uuid,text,text,integer,text,text),
 public.studkab_r3_return_file_remove(uuid,uuid,uuid),
 public.studkab_r3_return(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studkab_r3_hand(uuid,uuid),
 public.studkab_r3_return_file_add(uuid,uuid,text,text,integer,text,text),
 public.studkab_r3_return_file_remove(uuid,uuid,uuid),
 public.studkab_r3_return(uuid,uuid,text) to service_role;

-- Удаление заявки: вместе с материалами удаляются файлы работы, версий и замечаний (R3-C, R3-D).
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
begin
  begin
    v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then
    v_claims:='{}'::jsonb;
  end;
  if coalesce(v_claims->>'role','')<>'service_role' then raise exception 'REQUEST_DELETE_FORBIDDEN'; end if;
  if p_request is null then raise exception 'REQUEST_DELETE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,713));
  perform 1 from public.studkab_requests where id=p_request for update;
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
  return jsonb_build_object('absent',false,'paths',v_paths);
end $$;
revoke all on function public.prepare_studkab_request_delete(uuid)
  from public,anon,authenticated;
grant execute on function public.prepare_studkab_request_delete(uuid)
  to service_role;

-- Переданные в R3-C версии (до этой миграции) — в историю как версия 1.
insert into public.studkab_r3_versions(request_id,n,name,type,size,hash,path,delivered_at)
select request_id,1,delivered_name,delivered_type,delivered_size,delivered_hash,delivered_path,delivered_at
from public.studkab_r3_work where delivered_at is not null
on conflict do nothing;
