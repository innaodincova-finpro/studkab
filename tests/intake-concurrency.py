"""INTAKE-01: independent transactions in a newly created disposable CI DB."""
import concurrent.futures, hashlib, json, os, pathlib, subprocess
root=pathlib.Path(__file__).resolve().parents[1]
database='studkab_intake_concurrency'
env={**os.environ,'PGDATABASE':database}
student='11111111-1111-4111-8111-111111111111'
other='22222222-2222-4222-8222-222222222222'
def sql(source):
 return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=source,text=True,env=env).strip()
def call(source):return json.loads(sql("set role service_role;select coalesce(to_jsonb("+source+"),'null'::jsonb);"))
subprocess.run(['createdb',database],check=True)
try:
 setup=subprocess.check_output(['node','tests/intake-fixture.mjs','--print-sql'],cwd=root,text=True)
 sql(setup)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  drafts=list(pool.map(lambda _:call("studkab_intake_open('"+student+"')"),range(2)))
 assert drafts[0]['id']==drafts[1]['id']
 draft=drafts[0]['id']
 def reserve(i,who=student,replaces=None):
  h=hashlib.sha256(str(i).encode()).hexdigest()
  previous="'"+replaces+"'" if replaces else 'null'
  return call(f"studkab_intake_reserve('{who}','{draft}','data.pdf','application/pdf',10,'{h}',{previous})")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  duplicates=list(pool.map(reserve,[0,0]))
 assert duplicates[0]['file']['id']==duplicates[1]['file']['id']
 with concurrent.futures.ThreadPoolExecutor(10) as pool:
  rows=list(pool.map(reserve,range(1,11)))
 assert sum('file' in row for row in rows)==7
 assert sum(row.get('limited',False) for row in rows)==3
 assert int(sql('select count(*) from studkab_intake_files'))==8
 assert reserve(20,who=other).get('missing') is True
 f=duplicates[0]['file']
 def finish(_):return call(f"studkab_intake_finish('{student}','{draft}','{f['id']}','{f['file_hash']}')")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:confirmed=list(pool.map(finish,range(2)))
 assert sorted(x['duplicate'] for x in confirmed)==[False,True]
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  replacements=list(pool.map(lambda i:reserve(i,replaces=f['id']),[30,31]))
 assert sum('file' in row for row in replacements)==1
 assert sum(row.get('conflict',False) for row in replacements)==1
 def begin(_):return call(f"studkab_intake_read_begin('{student}','{draft}','{f['id']}','intake-reader-1')")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:readers=list(pool.map(begin,range(2)))
 assert sum('file' in row for row in readers)==1
 assert sum(row.get('busy',False) for row in readers)==1
 lease=next(row['file']['read_lease'] for row in readers if 'file' in row)
 result={'schema':1,'status':'ready','readerVersion':'intake-reader-1','fileId':f['id'],'fileHash':f['file_hash'],'blocks':[],'warnings':[],'extracted_text':'2023'}
 encoded=json.dumps(result).replace("'","''")
 def finish_read(_):return call(f"studkab_intake_read_finish('{student}','{draft}','{f['id']}','{lease}','intake-reader-1','{encoded}'::jsonb)")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:finished=list(pool.map(finish_read,range(2)))
 assert sum('file' in row for row in finished)==1
 assert sum(row.get('conflict',False) for row in finished)==1
 assert begin(0).get('cached') is True
 # Semantic queue uses the same isolated DB, with a shared capped ledger.
 sql("update studkab_intake_files set state='saved',saved_at=coalesce(saved_at,now()),read_status='ready',read_version='intake-reader-1',read_result='{}';update studkab_intake_analysis_policy set enabled=true,limit_microusd=15000;update studkab_gen_budget set limit_microusd=15000;")
 snapshot=call(f"studkab_intake_analysis_snapshot('{student}','{draft}')")
 plan=json.dumps([{'blocks':[],'prompt':'synthetic','max_output_tokens':4000,'max_cost_microusd':10000}]).replace("'","''")
 def start(_):return call(f"studkab_intake_analysis_start('{student}','{draft}','{snapshot['manifest']}','{plan}'::jsonb)")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:jobs=list(pool.map(start,range(2)))
 assert jobs[0]['id']==jobs[1]['id']
 with concurrent.futures.ThreadPoolExecutor(2) as pool:claims=list(pool.map(lambda _:call('studkab_intake_analysis_claim()'),range(2)))
 assert sum(c is not None for c in claims)==1
 first=next(c for c in claims if c)
 # A second source version competes for the same budget in another transaction.
 sql(f"update studkab_intake_drafts set notes='changed' where id='{draft}'")
 newer=call(f"studkab_intake_analysis_snapshot('{student}','{draft}')")
 second=call(f"studkab_intake_analysis_start('{student}','{draft}','{newer['manifest']}','{plan}'::jsonb)")
 # First claim is stale before dispatch and cannot reserve anything.
 assert call(f"studkab_intake_analysis_dispatch('{first['job_id']}','{first['claim']}',10000)") is None
 c=call('studkab_intake_analysis_claim()')
 def dispatch(_):
  try:return sql(f"set role service_role;select studkab_intake_analysis_dispatch('{c['job_id']}','{c['claim']}',10000);")
  except subprocess.CalledProcessError:return 'STALE_CLAIM'
 with concurrent.futures.ThreadPoolExecutor(2) as pool:sent=list(pool.map(dispatch,range(2)))
 assert sent.count('STALE_CLAIM')==1
 assert int(sql('select reserved_microusd from studkab_gen_budget'))==10000
 assert int(sql('select studkab_gen_expected_reserved()'))==10000
 sql("update studkab_intake_analysis_jobs set lease_until=now()-interval '1 second' where state='sent'")
 assert call('studkab_intake_analysis_claim()') is None
 assert sql(f"select state from studkab_intake_analysis_jobs where id='{second['id']}'")=='unknown'
 # Two independent drafts compete for the remaining 15,000 microUSD.
 sql("update studkab_intake_analysis_policy set limit_microusd=25000;update studkab_gen_budget set limit_microusd=25000;")
 sql(f"update studkab_intake_drafts set notes='third' where id='{draft}'")
 third=call(f"studkab_intake_analysis_snapshot('{student}','{draft}')")
 job3=call(f"studkab_intake_analysis_start('{student}','{draft}','{third['manifest']}','{plan}'::jsonb)")
 d2=call(f"studkab_intake_open('{other}')")['id']
 f2=call(f"studkab_intake_reserve('{other}','{d2}','data.pdf','application/pdf',10,'{'b'*64}',null)")['file']
 call(f"studkab_intake_finish('{other}','{d2}','{f2['id']}','{f2['file_hash']}')")
 sql(f"update studkab_intake_files set read_status='ready',read_version='intake-reader-1',read_result='{{}}' where id='{f2['id']}'")
 snap2=call(f"studkab_intake_analysis_snapshot('{other}','{d2}')")
 call(f"studkab_intake_analysis_start('{other}','{d2}','{snap2['manifest']}','{plan}'::jsonb)")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:pair=list(pool.map(lambda _:call('studkab_intake_analysis_claim()'),range(2)))
 # SKIP LOCKED may return no work while the other cursor holds ready rows.
 # The next scheduler tick must claim the remaining job, never the same lease.
 pair=[x for x in pair if x is not None]
 assert 1<=len(pair)<=2
 if len(pair)==1:pair.append(call('studkab_intake_analysis_claim()'))
 assert all(pair) and pair[0]['job_id']!=pair[1]['job_id']
 with concurrent.futures.ThreadPoolExecutor(2) as pool:funded=list(pool.map(lambda x:call(f"studkab_intake_analysis_dispatch('{x['job_id']}','{x['claim']}',10000)"),pair))
 assert sum(x is not None for x in funded)==1
 assert int(sql('select reserved_microusd from studkab_gen_budget'))==20000
 assert int(sql('select studkab_gen_expected_reserved()'))==20000
 print('PASS: semantic duplicate start, exclusive claim/dispatch, stale-source refusal, retained reserve and unknown without retry')
 print('PASS: parallel draft creation, hash deduplication, eight-file limit, ownership, finish, one successor and persisted exclusive reading')
finally:
 subprocess.run(['dropdb',database],check=True)
