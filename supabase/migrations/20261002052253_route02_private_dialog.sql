-- ROUTE-02-D: private web/Telegram guidance and common decision history.
create table public.studkab_private_dialog (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.studkab_requests(id) on delete cascade,
 client_key text not null check(length(client_key) between 1 and 100),
 actor_id uuid references auth.users(id), kind text not null check(kind in ('executor','assistant')),
 channel text not null check(channel in ('web','telegram','analysis')),
 body text not null check(length(body) between 1 and 200000),
 analysis_id uuid references public.studkab_intake_analysis_jobs(id) on delete cascade,
 evidence jsonb, created_at timestamptz not null default clock_timestamp(),
 unique(request_id,client_key),
 check((kind='executor' and actor_id is not null and analysis_id is null and evidence is null and channel in ('web','telegram') and length(body)<=1000)
 or (kind='assistant' and actor_id is null and analysis_id is not null and evidence is not null and channel='analysis'))
);
create index studkab_private_dialog_request on public.studkab_private_dialog(request_id,created_at,id);
create table public.studkab_telegram_dialog_context (
 chat_id bigint not null, message_id bigint not null, request_id uuid not null references public.studkab_requests(id) on delete cascade,
 manifest text not null check(manifest ~ '^[a-f0-9]{64}$'),mode text not null check(mode in ('comment','edit','return')),
 proposal_id uuid references public.studkab_question_proposals(id) on delete cascade,
 expires_at timestamptz not null default (clock_timestamp()+interval '30 minutes'),
 primary key(chat_id,message_id),check((mode='comment' and proposal_id is null) or (mode in ('edit','return') and proposal_id is not null))
);
alter table public.studkab_private_dialog enable row level security;
alter table public.studkab_telegram_dialog_context enable row level security;
revoke all on public.studkab_private_dialog,public.studkab_telegram_dialog_context from public,anon,authenticated,service_role;
grant select,insert on public.studkab_private_dialog,public.studkab_telegram_dialog_context to service_role;

alter function public.studkab_registered_analysis_source(uuid) rename to studkab_registered_analysis_kit_source;
create function public.studkab_registered_analysis_source(p_request uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select src || jsonb_build_object('reviewInstructions',coalesce(src->'reviewInstructions','[]'::jsonb)||
 coalesce((select jsonb_agg(jsonb_build_object('messageId',m.id,'author',m.actor_id,'comment',m.body) order by m.created_at,m.id)
 from public.studkab_private_dialog m where m.request_id=p_request and m.kind='executor'),'[]'::jsonb))
 from (select public.studkab_registered_analysis_kit_source(p_request) src) s where src is not null
$$;
create function public.studkab_private_dialog_send(p_request uuid,p_actor uuid,p_key text,p_body text,p_manifest text,p_channel text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src jsonb;m public.studkab_private_dialog;
begin
 perform public.studkab_registered_analysis_state(p_request,p_actor);
 perform 1 from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then return jsonb_build_object('stale',true);end if;
 if p_key is null or length(p_key) not between 1 and 100 or p_body is null or p_body<>btrim(p_body) or length(p_body) not between 1 and 1000 or p_channel not in ('web','telegram') or p_channel is null then return jsonb_build_object('invalid',true);end if;
 select * into m from public.studkab_private_dialog where request_id=p_request and client_key=p_key;
 if found then
  if m.actor_id=p_actor and m.body=p_body and m.channel=p_channel then return to_jsonb(m)||jsonb_build_object('ok',true,'mode','comment','duplicate',true);end if;
  return jsonb_build_object('conflict',true);
 end if;
 src=public.studkab_registered_analysis_source(p_request);
 if src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex') is distinct from p_manifest then return jsonb_build_object('stale',true);end if;
 if jsonb_array_length(src->'reviewInstructions')>=20 then return jsonb_build_object('limited',true);end if;
 insert into public.studkab_private_dialog(request_id,client_key,actor_id,kind,channel,body)
 values(p_request,p_key,p_actor,'executor',p_channel,p_body) returning * into m;
 return to_jsonb(m)||jsonb_build_object('ok',true,'mode','comment');
end $$;
create function public.studkab_private_dialog_read(p_request uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s jsonb;review jsonb;body text;
begin
 perform 1 from public.studkab_requests where id=p_request for update;
 s=public.studkab_registered_analysis_state(p_request,p_actor);
 if s ? 'missing' then return s;end if;
 if s->>'state'='stale' then return s||jsonb_build_object('stale',true);end if;
 if s->>'state'='done' then perform public.studkab_registered_questions_refresh(p_request);end if;
 if s->>'state'='done' and s->'result'->'kitReview'->>'version'='registered-kit-review-1' and exists(select 1 from public.studkab_private_dialog where request_id=p_request and kind='executor') then
  perform public.studkab_registered_questions_refresh(p_request);
  review=s->'result'->'kitReview';
  body='Повторное изучение завершено. Существенных нерешённых вопросов: '||jsonb_array_length(review->'gaps')||'.'||
   coalesce((select string_agg(E'\n'||(g->>'reason'),'' order by ord) from jsonb_array_elements(review->'gaps') with ordinality x(g,ord)),'')||
   coalesce((select string_agg(E'\n'||(a->>'status')||': '||(a->>'reason'),'' order by ord) from jsonb_array_elements(review->'answerReviews') with ordinality x(a,ord)),'')||
   coalesce((select string_agg(E'\n'||(a->>'status')||': '||(a->>'reason'),'' order by ord) from jsonb_array_elements(review->'returnedReviews') with ordinality x(a,ord)),'')||
   E'\nЭто заключение не утверждает паспорт и не разрешает подготовку автоматически.';
  insert into public.studkab_private_dialog(request_id,client_key,kind,channel,body,analysis_id,evidence)
  values(p_request,'analysis:'||(s->>'analysisId'),'assistant','analysis',body,(s->>'analysisId')::uuid,review)
  on conflict(request_id,client_key) do nothing;
 end if;
 return s||jsonb_build_object('requestId',p_request,'number',(select number from public.studkab_requests where id=p_request),'manifest',encode(sha256(convert_to(public.studkab_registered_analysis_source(p_request)::text,'UTF8')),'hex'),
 'dialog',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from public.studkab_private_dialog m where m.request_id=p_request),'[]'::jsonb),
 'proposals',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at,q.id) from public.studkab_question_proposals q where q.request_id=p_request),'[]'::jsonb));
end $$;

alter function public.studkab_registered_question_decide(uuid,uuid,uuid,text,text) rename to studkab_registered_question_base_decide;
create function public.studkab_registered_question_decide(p_request uuid,p_actor uuid,p_proposal uuid,p_decision text,p_text text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform public.studkab_registered_analysis_state(p_request,p_actor);
 perform 1 from public.studkab_requests where id=p_request for update;
 if p_decision='return' and exists(select 1 from public.studkab_question_proposals where id=p_proposal and request_id=p_request and state='pending')
 and jsonb_array_length(public.studkab_registered_analysis_source(p_request)->'reviewInstructions')>=20 then return jsonb_build_object('limited',true);end if;
 return public.studkab_registered_question_base_decide(p_request,p_actor,p_proposal,p_decision,p_text);
end $$;

create function public.studkab_telegram_executor(p_chat bigint) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;
begin
 if not exists(select 1 from public.studkab_telegram_setup where id and installed and owner_chat_id=p_chat) then raise exception 'FORBIDDEN';end if;
 select u.id into strict actor from auth.users u join public.studkab_request_config c on lower(c.executor_email)=lower(u.email);
 if actor is null then raise exception 'FORBIDDEN';end if;return actor;
end $$;
create function public.studkab_telegram_dialog_context_save(p_chat bigint,p_message bigint,p_request uuid,p_manifest text,p_mode text,p_proposal uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;src jsonb;old public.studkab_telegram_dialog_context;
begin
 actor=public.studkab_telegram_executor(p_chat);perform public.studkab_registered_analysis_state(p_request,actor);
 perform 1 from public.studkab_requests where id=p_request and deleting_at is null for update;
 src=public.studkab_registered_analysis_source(p_request);
 if src is null or encode(sha256(convert_to(src::text,'UTF8')),'hex') is distinct from p_manifest or p_message<=0 then return jsonb_build_object('stale',true);end if;
 if p_mode in ('edit','return') and not exists(select 1 from public.studkab_question_proposals where id=p_proposal and request_id=p_request and state='pending') then return jsonb_build_object('stale',true);end if;
 insert into public.studkab_telegram_dialog_context(chat_id,message_id,request_id,manifest,mode,proposal_id)
 values(p_chat,p_message,p_request,p_manifest,p_mode,p_proposal) on conflict do nothing;
 select * into old from public.studkab_telegram_dialog_context where chat_id=p_chat and message_id=p_message;
 return jsonb_build_object('saved',(old.request_id,old.manifest,old.mode,old.proposal_id) is not distinct from (p_request,p_manifest,p_mode,p_proposal));
end $$;
create function public.studkab_telegram_registered_action(p_chat bigint,p_action text,p_request uuid,p_proposal uuid,p_text text,p_key text,p_reply bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;r uuid;q public.studkab_question_proposals;ctx public.studkab_telegram_dialog_context;s jsonb;decision jsonb;
begin
 actor=public.studkab_telegram_executor(p_chat);
 if p_action='study' then return public.studkab_private_dialog_read(p_request,actor);end if;
 if p_action='reply' then
  select * into ctx from public.studkab_telegram_dialog_context where chat_id=p_chat and message_id=p_reply;
  if not found or ctx.expires_at<=clock_timestamp() then return jsonb_build_object('stale',true);end if;
  if ctx.mode='comment' then return public.studkab_private_dialog_send(ctx.request_id,actor,p_key,p_text,ctx.manifest,'telegram');end if;
  decision=public.studkab_registered_question_decide(ctx.request_id,actor,ctx.proposal_id,case when ctx.mode='edit' then 'publish' else 'return' end,p_text);
  return decision||jsonb_build_object('ok',decision ? 'id','mode',ctx.mode);
 end if;
 select * into q from public.studkab_question_proposals where id=p_proposal;
 if not found then return jsonb_build_object('stale',true);end if;r=q.request_id;
 if p_action in ('edit','return') then
  s=public.studkab_private_dialog_read(r,actor);
  if q.state<>'pending' or q.analysis_id::text is distinct from s->>'analysisId' or s->>'state'<>'done' then return jsonb_build_object('stale',true);end if;return s;
 end if;
 if p_action='publish' then
  decision=public.studkab_registered_question_decide(r,actor,q.id,'publish',q.question);
  return decision||jsonb_build_object('ok',decision ? 'id','mode','publish');
 end if;
 return jsonb_build_object('invalid',true);
end $$;

-- All helpers are private; web/Telegram resolve actors independently before RPC.
revoke all on function public.studkab_registered_analysis_kit_source(uuid),public.studkab_registered_analysis_source(uuid),
 public.studkab_private_dialog_send(uuid,uuid,text,text,text,text),public.studkab_private_dialog_read(uuid,uuid),
 public.studkab_registered_question_base_decide(uuid,uuid,uuid,text,text),public.studkab_registered_question_decide(uuid,uuid,uuid,text,text),
 public.studkab_telegram_executor(bigint),public.studkab_telegram_dialog_context_save(bigint,bigint,uuid,text,text,uuid),
 public.studkab_telegram_registered_action(bigint,text,uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.studkab_registered_analysis_kit_source(uuid),public.studkab_registered_analysis_source(uuid),
 public.studkab_private_dialog_send(uuid,uuid,text,text,text,text),public.studkab_private_dialog_read(uuid,uuid),
 public.studkab_registered_question_base_decide(uuid,uuid,uuid,text,text),public.studkab_registered_question_decide(uuid,uuid,uuid,text,text),
 public.studkab_telegram_executor(bigint),public.studkab_telegram_dialog_context_save(bigint,bigint,uuid,text,text,uuid),
 public.studkab_telegram_registered_action(bigint,text,uuid,uuid,text,text,bigint) to service_role;
