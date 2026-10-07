-- «Передать Claude» (согласовано владельцем 06.10.2026: «Делай все и запускать по моему сообщению в чат»).
-- Исполнитель нажимает в реестре «Передать Claude»: сервер копирует материалы заявки в эти таблицы,
-- потому что у Claude есть доступ к базе, но нет доступа к хранилищу файлов. Claude по сообщению владелицы
-- в чате забирает материалы, готовит работу и кладёт файл в studkab_claude_results. При следующем
-- открытии заявки в реестре сервер прикрепляет этот файл как готовую работу; к студенту он уходит
-- только после «Передать студенту». Доступ — только service_role. Записи удаляются вместе с заявкой.

create table public.studkab_claude_jobs (
 request_id uuid primary key references public.studkab_requests(id) on delete cascade,
 queued_at timestamptz not null default now(),
 note text not null default '' check(length(note)<=2000),
 started_at timestamptz,
 result_ready_at timestamptz,
 attached_at timestamptz,
 error text check(error is null or length(error)<=500)
);
create table public.studkab_claude_files (
 request_id uuid not null references public.studkab_claude_jobs(request_id) on delete cascade,
 attachment_id uuid not null,
 name text not null check(length(name) between 1 and 300),
 type text not null check(length(type) between 1 and 200),
 size integer not null check(size between 1 and 5242880),
 hash text not null check(hash ~ '^[a-f0-9]{64}$'),
 content_b64 text,
 copied_at timestamptz not null default now(),
 primary key(request_id,attachment_id)
);
create table public.studkab_claude_results (
 request_id uuid primary key references public.studkab_claude_jobs(request_id) on delete cascade,
 name text not null check(length(name) between 1 and 180),
 type text not null,
 size integer not null check(size between 1 and 5242880),
 hash text not null check(hash ~ '^[a-f0-9]{64}$'),
 content_b64 text not null default '',
 created_at timestamptz not null default now()
);
alter table public.studkab_claude_jobs enable row level security;
alter table public.studkab_claude_files enable row level security;
alter table public.studkab_claude_results enable row level security;
revoke all on public.studkab_claude_jobs,public.studkab_claude_files,public.studkab_claude_results from public,anon,authenticated;
grant select,insert,update on public.studkab_claude_jobs,public.studkab_claude_files,public.studkab_claude_results to service_role;

-- Постановка в очередь: заявка по форме берётся в работу, прежние копии материалов очищаются.
create function public.studkab_claude_queue(p_request uuid,p_note text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.studkab_requests; j public.studkab_claude_jobs;
begin
 select * into r from public.studkab_requests where id=p_request and deleting_at is null and ready_at is not null and payload->>'route'='r3' for update;
 if not found then return jsonb_build_object('missing',true); end if;
 insert into public.studkab_r3_work(request_id,student_id,taken_at) values(r.id,r.student_id,now())
 on conflict(request_id) do update set taken_at=coalesce(public.studkab_r3_work.taken_at,excluded.taken_at);
 insert into public.studkab_claude_jobs(request_id,note) values(r.id,left(coalesce(btrim(p_note),''),2000))
 on conflict(request_id) do update set queued_at=now(),note=excluded.note,started_at=null,result_ready_at=null,attached_at=null,error=null
 returning * into j;
 update public.studkab_claude_files set content_b64=null where request_id=r.id;
 return jsonb_build_object('queued_at',j.queued_at);
end $$;

create function public.studkab_claude_file_put(p_request uuid,p_attachment uuid,p_name text,p_type text,p_size integer,p_hash text,p_b64 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.studkab_claude_jobs where request_id=p_request) then return jsonb_build_object('missing',true); end if;
 if p_b64 is null or length(p_b64)<>4*ceil(p_size/3.0) then return jsonb_build_object('invalid',true); end if;
 insert into public.studkab_claude_files(request_id,attachment_id,name,type,size,hash,content_b64)
 values(p_request,p_attachment,p_name,p_type,p_size,p_hash,p_b64)
 on conflict(request_id,attachment_id) do update set name=excluded.name,type=excluded.type,size=excluded.size,hash=excluded.hash,content_b64=excluded.content_b64,copied_at=now();
 return jsonb_build_object('ok',true);
end $$;

-- После прикрепления работы копии материалов и файла очищаются.
create function public.studkab_claude_attached(p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 update public.studkab_claude_jobs set attached_at=now(),error=null where request_id=p_request and result_ready_at is not null;
 update public.studkab_claude_files set content_b64=null where request_id=p_request;
 update public.studkab_claude_results set content_b64='' where request_id=p_request;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.studkab_claude_queue(uuid,text),
 public.studkab_claude_file_put(uuid,uuid,text,text,integer,text,text),
 public.studkab_claude_attached(uuid) from public,anon,authenticated;
grant execute on function public.studkab_claude_queue(uuid,text),
 public.studkab_claude_file_put(uuid,uuid,text,text,integer,text,text),
 public.studkab_claude_attached(uuid) to service_role;
