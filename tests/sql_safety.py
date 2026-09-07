"""Destructive setup: use only an empty disposable PostgreSQL database."""
import subprocess, concurrent.futures, pathlib
root=pathlib.Path(__file__).resolve().parents[1]
def sql(text):
 return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',text],text=True).strip()
uid='11111111-1111-1111-1111-111111111111'
other='22222222-2222-2222-2222-222222222222'
sql("create schema auth; create role anon; create role authenticated; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;")
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
