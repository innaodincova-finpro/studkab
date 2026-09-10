"""Destructive setup: use only an empty disposable PostgreSQL database."""
import subprocess, concurrent.futures, pathlib, json, tempfile, os
root=pathlib.Path(__file__).resolve().parents[1]
def sql(text):
 return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',text],text=True).strip()
uid='11111111-1111-1111-1111-111111111111'
other='22222222-2222-2222-2222-222222222222'
sql("create schema auth; create role anon; create role authenticated; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;")
# Recreate the actual captured empty schema before testing its upgrade.
snapshot=json.loads((root/'tests/predeploy-schema.json').read_text())
columns=[c['column_name']+' '+c['data_type']+(' not null' if c['is_nullable']=='NO' else '')+(' default '+c['column_default'] if c['column_default'] else '') for c in snapshot['columns']]
sql('create table public.app_data ('+', '.join(columns+snapshot['constraints'])+');')
sql(snapshot['function_definition'])
sql((root/'baza.sql').read_text())
sql(f"insert into auth.users values ('{uid}'), ('{other}'); grant usage on schema public,auth to authenticated; grant select,insert,update,delete on public.app_data to authenticated;")
def call(rev,app='reestr',who=uid,payload='{}',legacy=False):
 fn='save_app_data' if legacy else 'save_app_data_v2'
 return sql(f"set role authenticated; set request.jwt.claim.sub='{who}'; select ok,rev,conflict from public.{fn}('{app}','{payload}',{rev});")
assert call(0)=='t|1|f'
assert call(0)=='f|1|t'  # zero never overwrites
with concurrent.futures.ThreadPoolExecutor(2) as pool:
 results=list(pool.map(lambda _:call(1),range(2)))
assert sorted(results)==['f|2|t','t|2|f'],results
with concurrent.futures.ThreadPoolExecutor(2) as pool:
 results=list(pool.map(lambda _:call(0,app='kabinet'),range(2)))
assert sorted(results)==['f|1|t','t|1|f'],results
assert call(0,who=other)=='t|1|f'
assert sql(f"set role authenticated; set request.jwt.claim.sub='{uid}'; select count(*) from public.app_data where user_id='{other}';")=='0'
assert call(2,payload='{"settings":{"proxyToken":"secret","name":"kept"}}')=='t|3|f'
assert sql(f"select data->'settings'->>'name' from app_data where user_id='{uid}' and app='reestr';")=='kept'
assert sql(f"select data->'settings' ? 'proxyToken' from app_data where user_id='{uid}' and app='reestr';")=='f'
try: call(3,legacy=True)
except subprocess.CalledProcessError: pass
else: raise AssertionError('Legacy client must be blocked')
print('PASS: create, revision zero, concurrent update/create, RLS, secret removal, old-client block')

# Exercise a real pg_dump -> restore cycle on synthetic data in the disposable CI DB.
with tempfile.TemporaryDirectory() as tmp:
 dump=pathlib.Path(tmp)/'backup.sql'
 with dump.open('w') as out: subprocess.run(['pg_dump','--no-owner','--no-privileges'],stdout=out,check=True)
 subprocess.run(['createdb','safety_restore'],check=True)
 subprocess.run(['psql','-X','-q','-v','ON_ERROR_STOP=1','-d','safety_restore','-f',str(dump)],check=True,stdout=subprocess.DEVNULL)
 expected=sql("select md5(string_agg(row_to_json(d)::text, '' order by user_id, app)) from app_data d;")
 actual=subprocess.check_output(['psql','-X','-qAt','-d','safety_restore','-c',"select md5(string_agg(row_to_json(d)::text, '' order by user_id, app)) from app_data d;"],text=True).strip()
 assert actual==expected
print('PASS: captured schema upgrade and pg_dump restoration preserve all synthetic records')

sql('create role service_role bypassrls;')
migration=(root/'supabase/migrations/202609070001_studkab_push.sql').read_text().split('-- Runs as the job owner.')[0]
sql(migration)
sub=sql(f"insert into studkab_push_subscriptions(user_id,endpoint,subscription,timezone) values('{uid}','https://fcm.googleapis.com/test','{{}}','UTC') returning id;")
assert sql(f"set role service_role; select claim_studkab_push_delivery('test-key','{sub}');")=='t'
assert sql(f"set role service_role; select claim_studkab_push_delivery('test-key','{sub}');")=='f'
sql("update studkab_push_deliveries set claimed_at=now()-interval '3 minutes';")
assert sql(f"set role service_role; select claim_studkab_push_delivery('test-key','{sub}');")=='t'
sql("update studkab_push_deliveries set sent_at=now(),claimed_at=now()-interval '3 minutes';")
assert sql(f"set role service_role; select claim_studkab_push_delivery('test-key','{sub}');")=='f'
for role in ['anon','authenticated']:
 for query in ['select * from studkab_push_configuration',f"select claim_studkab_push_delivery('unauthorized','{sub}')"]:
  try:sql(f'set role {role}; '+query)
  except subprocess.CalledProcessError:pass
  else:raise AssertionError('Push secrets or dispatch available to '+role)
print('PASS: push secrets restricted, claims deduplicate and retry, sent deliveries never reclaimed')

sql((root/'telegram-setup.sql').read_text())
sql((root/'request-delivery.sql').read_text())
sql('grant usage on schema public to service_role;')
payload=json.dumps({'id':'request-1','t':'Test','cn':'test'})
def submit(who=uid,body=payload):
 return json.loads(sql(f"set role service_role; select submit_studkab_request('{who}','{body}');"))
with concurrent.futures.ThreadPoolExecutor(2) as pool:
 pair=list(pool.map(lambda _:submit(),range(2)))
assert pair[0]['id']==pair[1]['id']
assert sorted(x['duplicate'] for x in pair)==[False,True]
assert submit(other)['id']!=pair[0]['id']
assert submit(body=json.dumps({'id':'request-1','t':'Changed','cn':'test'}))['conflict']
for role in ['anon','authenticated']:
 for query in ['select * from studkab_requests','select * from studkab_request_config','select * from studkab_telegram_setup',f"select submit_studkab_request('{uid}','{payload}')",'select claim_studkab_requests()']:
  try:sql(f'set role {role}; '+query)
  except subprocess.CalledProcessError:pass
  else:raise AssertionError('Request privileges leaked to '+role)
first=json.loads(sql("set role service_role; select coalesce(json_agg(id),'[]') from claim_studkab_requests();"))
second=json.loads(sql("set role service_role; select coalesce(json_agg(id),'[]') from claim_studkab_requests();"))
assert len(first)==2 and second==[]
sql("update studkab_requests set lease_until=now()-interval '1 minute';")
assert sql('set role service_role; select count(*) from claim_studkab_requests();')=='2'
sql('update studkab_requests set telegram_sent_at=now();')
assert sql('set role service_role; select count(*) from claim_studkab_requests();')=='0'
print('PASS: requests deduplicate concurrently, separate students, reject changed retries, restrict access and lease delivery')

sql((root/'result-delivery.sql').read_text())
request_id=pair[0]['id']
delivery_id='33333333-3333-4333-8333-333333333333'
def deliver(body='{"topic":"Test","text":"Version 1"}'):
 return json.loads(sql(f"set role service_role; select deliver_studkab_result('{request_id}','{delivery_id}','{body}');"))
with concurrent.futures.ThreadPoolExecutor(2) as pool:
 results=list(pool.map(lambda _:deliver(),range(2)))
assert sorted(x['duplicate'] for x in results)==[False,True]
assert deliver('{"topic":"Different"}')['conflict']
assert sql('select count(*) from studkab_results;')=='1'
for role in ['anon','authenticated']:
 for query in ['select * from studkab_results',f"select deliver_studkab_result('{request_id}','{delivery_id}','{{}}')"]:
  try:sql(f'set role {role}; '+query)
  except subprocess.CalledProcessError:pass
  else:raise AssertionError('Result privileges leaked to '+role)
print('PASS: immutable result versions, concurrent retries, denied direct access')

# Supabase Storage compatibility surface for the disposable PostgreSQL test.
sql("create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;")
sql((root/'supabase/migrations/202609100001_quality_workflow.sql').read_text())
sql("update studkab_workflow_config set enabled=true where id=true;")
process=json.loads(sql(f"set role service_role; select row_to_json(x) from studkab_initialize_request('{request_id}','{uid}') x;"))
assert process['status']=='submitted' and process['revision']==1
again=json.loads(sql(f"set role service_role; select row_to_json(x) from studkab_initialize_request('{request_id}','{uid}') x;"))
assert again['request_id']==process['request_id']
assert sql(f"set role service_role; select status||'|'||revision from studkab_transition_request('{request_id}',1,'completeness_review','{uid}','executor','review_started')")=='completeness_review|2'
try: sql(f"set role service_role; select studkab_transition_request('{request_id}',1,'passport_draft','{uid}','executor','stale')")
except subprocess.CalledProcessError: pass
else: raise AssertionError('Stale workflow revision must fail')
try: sql(f"set role service_role; select studkab_transition_request('{request_id}',2,'delivered','{uid}','executor','skip_review')")
except subprocess.CalledProcessError: pass
else: raise AssertionError('Invalid workflow transition must fail')
assert sql(f"select from_status||'|'||to_status from studkab_status_events where request_id='{request_id}' order by id desc limit 1")=='submitted|completeness_review'

file_id='44444444-4444-4444-8444-444444444444'
path=f'{request_id}/{file_id}/1'
sql(f"insert into studkab_request_files(id,request_id,student_id,purpose,version,storage_path,original_name,declared_mime,size_bytes) values('{file_id}','{request_id}','{uid}','assignment',1,'{path}','task.pdf','application/pdf',1000)")
assert sql(f"set role authenticated; set request.jwt.claim.sub='{uid}'; select count(*) from studkab_request_files")=='1'
assert sql(f"set role authenticated; set request.jwt.claim.sub='{other}'; select count(*) from studkab_request_files")=='0'
sql(f"set role authenticated; set request.jwt.claim.sub='{uid}'; insert into storage.objects(bucket_id,name) values('studkab-private','{path}')")
try: sql(f"set role authenticated; set request.jwt.claim.sub='{other}'; insert into storage.objects(bucket_id,name) values('studkab-private','{request_id}/bad/1')")
except subprocess.CalledProcessError: pass
else: raise AssertionError('Foreign or unprepared upload must fail')
for role in ['anon','authenticated']:
 for query in ['select * from studkab_executors','select * from studkab_requirement_passports','select * from studkab_criterion_results',f"select studkab_initialize_request('{request_id}','{uid}')",f"select studkab_transition_request('{request_id}',2,'needs_information','{uid}','executor','test')"]:
  try: sql(f'set role {role}; '+query)
  except subprocess.CalledProcessError: pass
  else: raise AssertionError('Workflow write or internal data leaked to '+role)
sql("update studkab_workflow_config set enabled=false where id=true;")
try: sql(f"set role service_role; select studkab_transition_request('{request_id}',2,'needs_information','{uid}','executor','disabled_test')")
except subprocess.CalledProcessError: pass
else: raise AssertionError('Disabled workflow must reject commands')
print('PASS: quality workflow RLS, private uploads, state transitions, revisions and kill switch')

# Uniform Edge RPC contracts are idempotent and remain owner-bound.
sql("update studkab_workflow_config set enabled=true where id=true;")
command='55555555-5555-4555-8555-555555555555'
prepared=json.loads(sql(f"set role service_role; select studkab_prepare_upload('{request_id}','{command}','{uid}','{{\"purpose\":\"guidelines\",\"originalName\":\"rules.pdf\",\"declaredMime\":\"application/pdf\",\"sizeBytes\":2048}}');"))
assert not prepared['duplicate'] and prepared['path'].startswith(request_id+'/')
duplicate=json.loads(sql(f"set role service_role; select studkab_prepare_upload('{request_id}','{command}','{uid}','{{\"purpose\":\"guidelines\",\"originalName\":\"rules.pdf\",\"declaredMime\":\"application/pdf\",\"sizeBytes\":2048}}');"))
assert duplicate['duplicate'] and duplicate['fileId']==prepared['fileId']
assert sql(f"select count(*) from studkab_request_files where request_id='{request_id}' and purpose='guidelines'")=='1'
try: sql(f"set role service_role; select studkab_prepare_upload('{request_id}','66666666-6666-4666-8666-666666666666','{other}','{{\"purpose\":\"other\",\"originalName\":\"foreign.txt\",\"declaredMime\":\"text/plain\",\"sizeBytes\":10}}')")
except subprocess.CalledProcessError: pass
else: raise AssertionError('Student cannot prepare upload for a foreign request')
transition_command='77777777-7777-4777-8777-777777777777'
first_transition=json.loads(sql(f"set role service_role; select studkab_transition_request('{request_id}','{transition_command}','{uid}','{{\"expectedRevision\":2,\"nextStatus\":\"needs_information\",\"reason\":\"missing_data\"}}');"))
same_transition=json.loads(sql(f"set role service_role; select studkab_transition_request('{request_id}','{transition_command}','{uid}','{{\"expectedRevision\":2,\"nextStatus\":\"needs_information\",\"reason\":\"missing_data\"}}');"))
assert not first_transition['duplicate'] and same_transition['duplicate'] and first_transition['revision']==same_transition['revision']==3
print('PASS: uniform workflow RPC contracts enforce ownership and idempotent retries')
