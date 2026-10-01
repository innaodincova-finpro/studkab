"""INTAKE-01: independent transactions in a newly created disposable CI DB."""
import concurrent.futures, hashlib, json, os, pathlib, subprocess
root=pathlib.Path(__file__).resolve().parents[1]
database='studkab_intake_concurrency'
env={**os.environ,'PGDATABASE':database}
student='11111111-1111-4111-8111-111111111111'
other='22222222-2222-4222-8222-222222222222'
def sql(source):
 return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=source,text=True,env=env).strip()
def call(source):return json.loads(sql('set role service_role;select '+source+';'))
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
 print('PASS: parallel draft creation, hash deduplication, eight-file limit, ownership, finish, one successor and persisted exclusive reading')
finally:
 subprocess.run(['dropdb',database],check=True)
