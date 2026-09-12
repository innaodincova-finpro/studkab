"""Run after legacy fixtures in disposable tests/sql_safety.py only."""
import base64,hashlib
migration=root/'supabase/migrations/20260912091822_studkab_versioned_delivery.sql'
sql(migration.read_text())
version_id='77777777-7777-4777-8777-777777777777'
review_id='88888888-8888-4888-8888-888888888888'
new_delivery='99999999-9999-4999-8999-999999999999'
file=base64.b64encode(b'PK\x03\x04synthetic zip bytes').decode()
content=json.dumps({'topic':'Synthetic review','student':'Synthetic'})
def prepare(vid=version_id,body=content):
 return json.loads(sql(f"set role service_role; select prepare_studkab_result('{request_id}','{vid}','{uid}','{body}','{file}');"))
a=prepare();assert a['fileHash']==hashlib.sha256(base64.b64decode(file)).hexdigest()
assert prepare()==a
assert prepare(body='{}')['error']=='conflict'
codes=[f'C{i:02}' for i in range(1,14)]+['S01','S02','S03']
criteria={c:{'status':'pass','evidence':'Synthetic evidence at page 1'} for c in codes}
def review(body=criteria,rid=review_id):
 return json.loads(sql(f"set role service_role; select review_studkab_result('{request_id}','{version_id}','{rid}','{other}','{uid}','{a['fileHash']}','{a['documentHash']}','{json.dumps(body)}');"))
def deliver_new(vid=version_id,rid=review_id,recipient=uid,delivery=new_delivery,fh=None):
 return json.loads(sql(f"set role service_role; select deliver_reviewed_studkab_result('{request_id}','{delivery}','{vid}','{rid}','{recipient}','{fh or a['fileHash']}','{a['documentHash']}');"))
assert deliver()['error']=='review_required'
assert deliver_new()['error']=='review_required'
assert review({})['error']=='criteria'
assert review({**criteria,'C11':{'status':'not_checked','evidence':'Not opened in Word'}})['error']=='criteria'
assert review()['reviewId']==review_id
assert review()['reviewId']==review_id
assert deliver_new(recipient=other)['error']=='stale'
assert deliver_new(fh='0'*64)['error']=='stale'
with concurrent.futures.ThreadPoolExecutor(2) as pool:
 pair=list(pool.map(lambda _:deliver_new(),range(2)))
assert sorted(x['duplicate'] for x in pair)==[False,True]
assert sql(f"select count(*) from studkab_results where delivery_id='{new_delivery}';")=='1'
# The database trigger blocks both legacy and direct service inserts without review.
for query in [f"insert into studkab_results(request_id,delivery_id,document) values('{request_id}',gen_random_uuid(),'{{}}');", f"update studkab_result_versions set document='{{}}' where id='{version_id}';",f"delete from studkab_result_reviews where id='{review_id}';"]:
 try:sql(query)
 except subprocess.CalledProcessError:pass
 else:raise AssertionError('Delivery/history guard bypassed')
prepare(vid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',body='{"topic":"New version"}')
assert deliver_new(delivery='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')['error']=='stale'
assert review(rid='cccccccc-cccc-4ccc-8ccc-cccccccccccc')['error']=='stale'
assert deliver_new()['duplicate'] # receipt for a historical success is safe, not a new delivery
for role in ['anon','authenticated']:
 for query in ['select * from studkab_result_versions','select * from studkab_result_reviews',f"select prepare_studkab_result('{request_id}','{version_id}','{uid}','{{}}','{file}')"]:
  try:sql(f'set role {role}; '+query)
  except subprocess.CalledProcessError:pass
  else:raise AssertionError('Version access leaked to '+role)
print('PASS: exact file hash, immutable versions/reviews, stale/missing/forged review blocked, concurrent delivery idempotent, legacy preserved')
