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
