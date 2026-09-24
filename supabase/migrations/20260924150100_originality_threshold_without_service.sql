-- C106: a sourced numeric requirement can be recorded before its checking system is known.
-- The missing system blocks positive quality evidence and ordinary delivery.

create or replace function public.studkab_originality_rule(item jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare o jsonb; mode text; svc text; threshold numeric; expected text;
begin
 if item is null or item->>'verified' is distinct from 'true' or length(trim(coalesce(item->>'source','')))=0
 then raise exception 'QUALITY_PASSPORT'; end if;
 o:=item->'originality';mode:=o->>'mode';svc:=trim(coalesce(o->>'service',''));
 if mode is null or mode not in ('university_threshold','university_threshold_no_service','university_no_threshold','service_only') or jsonb_typeof(o) is distinct from 'object'
 then raise exception 'QUALITY_PASSPORT'; end if;
 if mode='university_threshold' then
  if length(svc) not between 1 and 200 or jsonb_typeof(o->'thresholdPercent') is distinct from 'number'
   or (o->>'thresholdPercent')::numeric not between 0 and 100 then raise exception 'QUALITY_PASSPORT'; end if;
  threshold:=(o->>'thresholdPercent')::numeric;
  expected:=format('Оригинальность: не менее %s%% в системе %s.',threshold,svc);
 elsif mode='university_threshold_no_service' then
  if length(svc)<>0 or jsonb_typeof(o->'thresholdPercent') is distinct from 'number'
   or (o->>'thresholdPercent')::numeric not between 0 and 100 then raise exception 'QUALITY_PASSPORT'; end if;
  threshold:=(o->>'thresholdPercent')::numeric;
  expected:=format('Оригинальность: не менее %s%%; система проверки в задании не указана.',threshold);
 elsif mode='university_no_threshold' then
  if length(svc) not between 1 and 200 or o->'thresholdPercent' is distinct from 'null'::jsonb then raise exception 'QUALITY_PASSPORT'; end if;
  expected:=format('Оригинальность: проверка в системе %s; числовое условие вуза отсутствует.',svc);
 else
  if length(svc)<>0 or o->'thresholdPercent' is distinct from 'null'::jsonb or item->>'source' !~* 'STUDKAB'
  then raise exception 'QUALITY_PASSPORT'; end if;
  expected:='Внешний отчёт по стандарту STUDKAB; в предоставленных материалах числовое условие вуза не обнаружено.';
 end if;
 if item->>'text' is distinct from expected then raise exception 'QUALITY_PASSPORT'; end if;
 return jsonb_build_object('itemId','ANTIPLAGIARISM','text',expected,'mode',mode,'service',svc,'thresholdPercent',o->'thresholdPercent');
end $$;

create or replace function public.studkab_requirement_passport_approve(
 p_request uuid,p_passport uuid,p_actor uuid,p_expected_items jsonb,p_expected_fingerprint text,p_expected_revision integer default null,p_expected_manifest jsonb default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare selected public.studkab_requirement_passports; i jsonb; q public.studkab_clarifications;
 required_ids text[]:=array['WORK_TYPE','DISCIPLINE','STRUCTURE','VOLUME','METHODOLOGY','FORMATTING','SOURCES','CALCULATIONS','ANTIPLAGIARISM','TEACHER'];
 key text; answer_id text;
begin
 if not exists(select 1 from auth.users u join public.studkab_request_config c on lower(u.email)=lower(c.executor_email) where u.id=p_actor)
 then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.studkab_requests where id=p_request and deleting_at is null for update;
 if not found then raise exception 'request_not_found'; end if;
 if exists(select 1 from public.studkab_material_revisions where request_id=p_request and closed_at is null)
 then return jsonb_build_object('error','Завершите дополнение материалов перед изменением паспорта'); end if;
 if (p_expected_revision is not null or exists(select 1 from public.studkab_material_revisions where request_id=p_request) or exists(select 1 from public.studkab_request_reassignments where request_id=p_request))
 and p_expected_revision is distinct from (select revision from public.studkab_requests where id=p_request)
 then return jsonb_build_object('error','Материалы изменились. Откройте паспорт заново'); end if;
 select * into selected from public.studkab_requirement_passports where id=p_passport and request_id=p_request for update;
 if not found then raise exception 'passport_not_found'; end if;
 if selected.material_manifest is distinct from p_expected_manifest then raise exception 'MATERIAL_MANIFEST_CHANGED'; end if;
 if selected.status<>'draft' or selected.items is distinct from p_expected_items
 or coalesce(selected.source_fingerprint,'')='' or selected.source_fingerprint is distinct from p_expected_fingerprint
 or exists(select 1 from public.studkab_requirement_passports where request_id=p_request and revision>selected.revision)
 then raise exception 'passport_changed'; end if;
 foreach key in array required_ids loop
  if (select count(*) from jsonb_array_elements(selected.items) j where j->>'id'=key)<>1 then raise exception 'PASSPORT_REQUIRED_ITEMS'; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(selected.items))<>(select count(distinct j->>'id') from jsonb_array_elements(selected.items) j)
 then raise exception 'PASSPORT_DUPLICATE_ITEMS'; end if;
 for i in select * from jsonb_array_elements(selected.items) loop
  if i->>'id'=any(required_ids) or i->>'required' is distinct from 'false' then
   if i->>'verified' is distinct from 'true' or length(trim(coalesce(i->>'source','')))=0
   or length(trim(coalesce(i->>'text','')))=0 or (i->>'text' ~* 'не указано|требуется уточнить|порог не задан|ожидается ответ'
    and not (i->>'id'='ANTIPLAGIARISM' and i#>>'{originality,mode}'='university_threshold_no_service'))
   then raise exception 'PASSPORT_UNVERIFIED'; end if;
  end if;
  if i->>'id'='ANTIPLAGIARISM' then perform public.studkab_originality_rule(i); end if;
  if i ? 'answer_ids' then
   if jsonb_typeof(i->'answer_ids')<>'array' then raise exception 'PASSPORT_EVIDENCE'; end if;
   for answer_id in select jsonb_array_elements_text(i->'answer_ids') loop
    if not exists(select 1 from public.studkab_clarifications c where c.id::text=answer_id and c.request_id=p_request and c.item_id=i->>'id' and c.answer is not null)
    then raise exception 'PASSPORT_EVIDENCE'; end if;
   end loop;
  end if;
 end loop;
 for q in select * from public.studkab_clarifications where request_id=p_request loop
  if q.answer is null or selected.created_at<q.answered_at or not exists(select 1 from jsonb_array_elements(selected.items) j
    where j->>'id'=q.item_id and j->>'verified'='true' and length(trim(coalesce(j->>'source','')))>0
    and coalesce(j->'answer_ids','[]'::jsonb) ? q.id::text)
  then raise exception 'CLARIFICATION_UNREVIEWED'; end if;
 end loop;
 update public.studkab_requirement_passports set status='stale' where request_id=p_request and status='approved';
 update public.studkab_requirement_passports set status='approved',approved_by=p_actor,approved_at=now() where id=p_passport returning * into selected;
 return to_jsonb(selected);
end $$;

create or replace function public.studkab_quality_insert_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare c jsonb; x jsonb; f jsonb; bytes bytea; ids text[]; source_count integer;
begin
 c:=public.studkab_quality_context(new.request_id,new.version_id);
 if new.actor_id is null or not exists(select 1 from auth.users u join public.studkab_request_config cfg on lower(u.email)=lower(cfg.executor_email) where u.id=new.actor_id) then raise exception 'QUALITY_FORBIDDEN'; end if;
 if new.recipient_id::text is distinct from c->>'recipientId' or new.passport_id::text is distinct from c->>'passportId'
 or new.file_hash is distinct from c->>'fileHash' or new.document_hash is distinct from c->>'documentHash' or new.source_fingerprint is distinct from c->>'sourceFingerprint' then raise exception 'QUALITY_STALE'; end if;
 x:=new.payload;
 if jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'disposition','') not in ('pass','fail','manual') or length(trim(coalesce(x->>'notes',''))) not between 10 and 4000 then raise exception 'QUALITY_INVALID'; end if;
 if new.kind='external_originality' then
  if length(trim(coalesce(x->>'service',''))) not between 1 and 200 or length(trim(coalesce(x->>'checkId',''))) not between 1 and 300
  or x->>'thresholdItemId' is distinct from 'ANTIPLAGIARISM' or x->>'thresholdBasis' is distinct from c#>>'{thresholdRequirement,text}'
  or x->>'thresholdMode' is distinct from c#>>'{thresholdRequirement,mode}'
  or x->'requirementConfirmed' is distinct from 'true'::jsonb or x->'wordBindingConfirmed' is distinct from 'true'::jsonb
  or jsonb_typeof(x->'actualPercent') is distinct from 'number'
  then raise exception 'QUALITY_REPORT_INVALID'; end if;
  if (x->>'actualPercent')::numeric not between 0 and 100
   or (x->>'checkedAt') is null or (x->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' then raise exception 'QUALITY_REPORT_INVALID'; end if;
  if c#>>'{thresholdRequirement,mode}' in ('university_threshold','university_threshold_no_service') then
   if (c#>>'{thresholdRequirement,mode}'='university_threshold' and x->>'service' is distinct from c#>>'{thresholdRequirement,service}')
    or jsonb_typeof(x->'thresholdPercent') is distinct from 'number'
    or x->'thresholdPercent' is distinct from c#>'{thresholdRequirement,thresholdPercent}'
   then raise exception 'QUALITY_REPORT_INVALID'; end if;
  elsif x->'thresholdPercent' is distinct from 'null'::jsonb
   or (c#>>'{thresholdRequirement,mode}'='university_no_threshold' and x->>'service' is distinct from c#>>'{thresholdRequirement,service}')
   then raise exception 'QUALITY_REPORT_INVALID'; end if;
  if new.report_base64 is null or length(new.report_base64)>6990508 or new.report_base64!~'^[A-Za-z0-9+/]*={0,2}$' then raise exception 'QUALITY_REPORT_INVALID'; end if;
  bytes:=decode(new.report_base64,'base64');
  if octet_length(bytes)<5 or octet_length(bytes)>5242880 or convert_from(substring(bytes from 1 for 9),'UTF8')!~E'^%PDF-(1\\.[0-7]|2\\.0)[\r\n]' or encode(substring(bytes from greatest(1,octet_length(bytes)-1023)),'escape')!~'%%EOF[[:space:]]*$' then raise exception 'QUALITY_REPORT_INVALID'; end if;
  new.report_hash:=encode(sha256(bytes),'hex');
  if x->>'disposition'='pass' and c#>>'{thresholdRequirement,mode}'='university_threshold_no_service' then raise exception 'QUALITY_SYSTEM_UNCONFIRMED'; end if;
  if x->>'disposition'='pass' and c#>>'{thresholdRequirement,mode}'='university_threshold' and (x->>'actualPercent')::numeric<(x->>'thresholdPercent')::numeric then raise exception 'QUALITY_BELOW_THRESHOLD'; end if;
 else
  if new.report_base64 is not null or new.report_hash is not null or jsonb_typeof(x->'scan') is distinct from 'object'
  or x#>>'{scan,fileHash}' is distinct from new.file_hash or coalesce(x->>'scanHash','')!~'^[a-f0-9]{64}$'
  then raise exception 'QUALITY_SCAN_INVALID'; end if;
  -- Trusted Edge computes the bounded scan from stored DOCX bytes. Database rechecks corpus identity.
  if jsonb_typeof(x->'sourceBindings') is distinct from 'array' then raise exception 'QUALITY_SCAN_INVALID'; end if;
  select count(*) into source_count from public.studkab_request_attachments a where a.request_id=new.request_id and a.category='sources' and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id);
  if jsonb_array_length(x->'sourceBindings')<>source_count then raise exception 'QUALITY_SCAN_STALE'; end if;
  ids:=array[]::text[];
  for f in select value from jsonb_array_elements(x->'sourceBindings') loop
   if f->>'id'=any(ids) or not exists(select 1 from public.studkab_request_attachments a where a.id::text=f->>'id' and a.request_id=new.request_id and a.category='sources' and a.file_hash=f->>'fileHash' and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) then raise exception 'QUALITY_SCAN_STALE'; end if;
   ids:=array_append(ids,f->>'id');
  end loop;
  if x->>'disposition'='pass' then
   if source_count=0 or exists(select 1 from public.studkab_request_attachments a where a.request_id=new.request_id and a.category='sources' and length(trim(coalesce(a.extracted_text,'')))=0 and not exists(select 1 from public.studkab_request_attachments b where b.supersedes=a.id)) or x->'scanComplete' is distinct from 'true'::jsonb or jsonb_typeof(x->'findingDecisions') is distinct from 'array' or jsonb_typeof(x->'findingIds') is distinct from 'array'
   or jsonb_array_length(x->'findingIds')<>jsonb_array_length(x->'findingDecisions') then raise exception 'QUALITY_SCAN_INCOMPLETE'; end if;
   ids:=array[]::text[];
   for f in select value from jsonb_array_elements(x->'findingDecisions') loop
    if coalesce(f->>'findingId','')='' or f->>'findingId'=any(ids) or not (x->'findingIds' ? (f->>'findingId')) or f->>'disposition' is distinct from 'explained' or length(trim(coalesce(f->>'notes',''))) not between 10 and 2000 then raise exception 'QUALITY_FINDING_UNREVIEWED'; end if;
    ids:=array_append(ids,f->>'findingId');
   end loop;
  end if;
 end if;
 return new;
end $$;
