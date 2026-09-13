begin;
create table public.studkab_result_versions (
 id uuid primary key,
 revision bigint generated always as identity unique,
 request_id uuid not null references public.studkab_requests(id),
 recipient_id uuid not null references auth.users(id),
 document jsonb not null check(octet_length(document::text)<=4000000),
 docx_base64 text not null check(length(docx_base64)<=4194304),
 document_hash text not null,
 file_hash text not null,
 created_at timestamptz not null default clock_timestamp()
);
create index studkab_result_versions_request on public.studkab_result_versions(request_id,revision desc);
create table public.studkab_result_reviews (
 id uuid primary key,
 version_id uuid not null references public.studkab_result_versions(id),
 reviewer_id uuid not null references auth.users(id),
 criteria jsonb not null check(octet_length(criteria::text)<=40000),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.studkab_results add column version_id uuid references public.studkab_result_versions(id), add column review_id uuid references public.studkab_result_reviews(id);
alter table public.studkab_result_versions enable row level security;
alter table public.studkab_result_reviews enable row level security;
revoke all on public.studkab_result_versions,public.studkab_result_reviews from public,anon,authenticated;
revoke all on sequence public.studkab_result_versions_revision_seq from public,anon,authenticated;
grant select,insert on public.studkab_result_versions,public.studkab_result_reviews to service_role;
grant usage,select on sequence public.studkab_result_versions_revision_seq to service_role;

create function public.studkab_valid_review(criteria jsonb) returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare code text;
begin
 if criteria is null or jsonb_typeof(criteria)<>'object' or (select count(*) from jsonb_object_keys(criteria))<>16 then return false; end if;
 foreach code in array array['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12','C13','S01','S02','S03'] loop
  if coalesce(criteria->code->>'status','')<>'pass' or jsonb_typeof(criteria->code->'evidence') is distinct from 'string' or length(trim(coalesce(criteria->code->>'evidence',''))) not between 10 and 2000 then return false; end if;
 end loop;
 return true;
end $$;
create function public.studkab_result_immutable() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$ begin raise exception 'Immutable result history'; end $$;
create trigger result_versions_immutable before update or delete on public.studkab_result_versions for each row execute function public.studkab_result_immutable();
create trigger result_reviews_immutable before update or delete on public.studkab_result_reviews for each row execute function public.studkab_result_immutable();
create trigger results_immutable before update or delete on public.studkab_results for each row execute function public.studkab_result_immutable();

create function public.prepare_studkab_result(request uuid,version uuid,recipient uuid,content jsonb,file_base64 text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; actual uuid; bytes bytea;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 select student_id into actual from public.studkab_requests where id=request for share;
 if actual is null or actual<>recipient then return jsonb_build_object('error','recipient'); end if;
 if file_base64 is null or length(file_base64)>4194304 or file_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' then return jsonb_build_object('error','file'); end if;
 bytes:=decode(file_base64,'base64');
 if octet_length(bytes)<4 or substring(bytes from 1 for 4)<>decode('504b0304','hex') then return jsonb_build_object('error','file'); end if;
 select * into v from public.studkab_result_versions where id=version;
 if found then
  if v.request_id<>request or v.recipient_id<>recipient or v.document<>content or v.docx_base64<>file_base64 then return jsonb_build_object('error','conflict'); end if;
 else
  insert into public.studkab_result_versions(id,request_id,recipient_id,document,docx_base64,document_hash,file_hash)
  values(version,request,recipient,content,file_base64,encode(sha256(convert_to(content::text,'UTF8')),'hex'),encode(sha256(bytes),'hex')) returning * into v;
 end if;
 return jsonb_build_object('versionId',v.id,'recipientId',v.recipient_id,'documentHash',v.document_hash,'fileHash',v.file_hash,'revision',v.revision);
end $$;

create function public.review_studkab_result(request uuid,version uuid,review uuid,reviewer uuid,recipient uuid,file_hash text,document_hash text,criteria jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where request_id=request order by revision desc limit 1;
 if v.id is null or v.id<>version or v.recipient_id is distinct from actual or actual is distinct from recipient or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
 if not public.studkab_valid_review(criteria) then return jsonb_build_object('error','criteria'); end if;
 select * into r from public.studkab_result_reviews where id=review;
 if found then
  if r.version_id<>version or r.reviewer_id<>reviewer or r.criteria<>criteria then return jsonb_build_object('error','conflict'); end if;
 else
  insert into public.studkab_result_reviews(id,version_id,reviewer_id,criteria) values(review,version,reviewer,criteria) returning * into r;
 end if;
 return jsonb_build_object('reviewId',r.id,'versionId',r.version_id,'reviewedAt',r.created_at);
end $$;

-- Enforce on the actual result table too: no legacy RPC/direct insert bypass.
create function public.studkab_guard_result_delivery() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,713));
 select student_id into actual from public.studkab_requests where id=new.request_id for share;
 select * into v from public.studkab_result_versions where request_id=new.request_id order by revision desc limit 1;
 select * into r from public.studkab_result_reviews where id=new.review_id;
 if v.id is null or new.version_id is distinct from v.id or r.version_id is distinct from v.id or v.recipient_id is distinct from actual or new.document is distinct from v.document or not public.studkab_valid_review(r.criteria) then raise exception 'Versioned review required'; end if;
 return new;
end $$;
create trigger results_review_required before insert on public.studkab_results for each row execute function public.studkab_guard_result_delivery();
create or replace function public.deliver_studkab_result(request uuid,delivery uuid,content jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$ begin return jsonb_build_object('error','review_required'); end $$;
create function public.deliver_reviewed_studkab_result(request uuid,delivery uuid,version uuid,review uuid,recipient uuid,file_hash text,document_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.studkab_result_versions; r public.studkab_result_reviews; old public.studkab_results; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(request::text,713));
 select student_id into actual from public.studkab_requests where id=request for share;
 select * into v from public.studkab_result_versions where id=version and request_id=request;
 if v.id is null or actual is distinct from recipient or v.recipient_id is distinct from actual or v.file_hash is distinct from file_hash or v.document_hash is distinct from document_hash then return jsonb_build_object('error','stale'); end if;
 select * into old from public.studkab_results where request_id=request and delivery_id=delivery;
 if found then
  if old.version_id is distinct from version or old.review_id is distinct from review then return jsonb_build_object('error','conflict'); end if;
  return jsonb_build_object('deliveryId',old.delivery_id,'createdAt',old.created_at,'duplicate',true);
 end if;
 if version is distinct from (select id from public.studkab_result_versions where request_id=request order by revision desc limit 1) then return jsonb_build_object('error','stale'); end if;
 select * into r from public.studkab_result_reviews where id=review and version_id=version;
 if r.id is null or not public.studkab_valid_review(r.criteria) then return jsonb_build_object('error','review_required'); end if;
 insert into public.studkab_results(request_id,delivery_id,document,version_id,review_id) values(request,delivery,v.document,version,review) returning * into old;
 return jsonb_build_object('deliveryId',old.delivery_id,'createdAt',old.created_at,'duplicate',false);
end $$;
revoke all on function public.studkab_valid_review(jsonb),public.studkab_result_immutable(),public.studkab_guard_result_delivery(),public.prepare_studkab_result(uuid,uuid,uuid,jsonb,text),public.review_studkab_result(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),public.deliver_reviewed_studkab_result(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.studkab_valid_review(jsonb),public.studkab_result_immutable(),public.studkab_guard_result_delivery(),public.prepare_studkab_result(uuid,uuid,uuid,jsonb,text),public.review_studkab_result(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),public.deliver_reviewed_studkab_result(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;
commit;
