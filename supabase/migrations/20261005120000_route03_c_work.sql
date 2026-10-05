-- ROUTE-03, этап R3-C (05.10.2026): работа исполнителя по заявке, поданной по форме.
-- «Взять в работу» → прикрепить готовый файл → «Передать студенту»; студент скачивает файл.
-- Переданный файл хранится отдельно от рабочего: замена рабочего файла не меняет то,
-- что уже получил студент, пока исполнитель не передаст новую версию.
-- Доступ к таблице и функциям — только service_role; права исполнителя проверяет сервер.

create table public.studkab_r3_work (
 request_id uuid primary key references public.studkab_requests(id) on delete cascade,
 student_id uuid not null,
 taken_at timestamptz,
 result_name text check(result_name is null or length(result_name) between 1 and 180),
 result_type text check(result_type is null or result_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
 result_size integer check(result_size is null or result_size between 1 and 5242880),
 result_hash text check(result_hash is null or result_hash ~ '^[a-f0-9]{64}$'),
 result_path text,
 result_at timestamptz,
 delivered_name text,
 delivered_type text,
 delivered_size integer,
 delivered_hash text,
 delivered_path text,
 delivered_at timestamptz,
 downloaded_at timestamptz,
 check((result_path is null)=(result_hash is null)),
 check((delivered_at is null)=(delivered_path is null))
);
alter table public.studkab_r3_work enable row level security;
revoke all on public.studkab_r3_work from public,anon,authenticated;
grant select,insert,update on public.studkab_r3_work to service_role;

create function public.studkab_r3_take(p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; w public.studkab_r3_work;
begin
 select * into r from public.studkab_requests where id=p_request and deleting_at is null and ready_at is not null and payload->>'route'='r3' for update;
 if not found then return jsonb_build_object('missing',true); end if;
 insert into public.studkab_r3_work(request_id,student_id,taken_at) values(r.id,r.student_id,now())
 on conflict(request_id) do update set taken_at=coalesce(public.studkab_r3_work.taken_at,excluded.taken_at)
 returning * into w;
 return jsonb_build_object('taken_at',w.taken_at);
end $$;

create function public.studkab_r3_result_set(p_request uuid,p_name text,p_type text,p_size integer,p_hash text,p_path text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; w public.studkab_r3_work;
begin
 select * into r from public.studkab_requests where id=p_request and deleting_at is null and ready_at is not null and payload->>'route'='r3' for update;
 if not found then return jsonb_build_object('missing',true); end if;
 select * into w from public.studkab_r3_work where request_id=r.id for update;
 if not found or w.taken_at is null then return jsonb_build_object('not_taken',true); end if;
 if p_path is null or p_path<>'r3-results/'||r.id::text||'/'||p_hash then return jsonb_build_object('invalid',true); end if;
 update public.studkab_r3_work set result_name=btrim(p_name),result_type=p_type,result_size=p_size,result_hash=p_hash,result_path=p_path,result_at=now()
 where request_id=r.id returning * into w;
 return jsonb_build_object('result',jsonb_build_object('name',w.result_name,'size',w.result_size,'at',w.result_at));
end $$;

create function public.studkab_r3_deliver(p_request uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; w public.studkab_r3_work;
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
  delivered_path=result_path,delivered_at=now(),downloaded_at=null where request_id=r.id returning * into w;
 return jsonb_build_object('delivered_at',w.delivered_at,'duplicate',false);
end $$;

create function public.studkab_r3_downloaded(p_request uuid,p_student uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.studkab_r3_work;
begin
 update public.studkab_r3_work set downloaded_at=coalesce(downloaded_at,now())
 where request_id=p_request and student_id=p_student and delivered_at is not null
 and exists(select 1 from public.studkab_requests q where q.id=p_request and q.student_id=p_student and q.deleting_at is null)
 returning * into w;
 if not found then return jsonb_build_object('missing',true); end if;
 return jsonb_build_object('downloaded_at',w.downloaded_at);
end $$;

revoke all on function public.studkab_r3_take(uuid),public.studkab_r3_result_set(uuid,text,text,integer,text,text),
 public.studkab_r3_deliver(uuid,text),public.studkab_r3_downloaded(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studkab_r3_take(uuid),public.studkab_r3_result_set(uuid,text,text,integer,text,text),
 public.studkab_r3_deliver(uuid,text),public.studkab_r3_downloaded(uuid,uuid) to service_role;
