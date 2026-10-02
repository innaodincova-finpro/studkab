"""ROUTE-02-C: independent PostgreSQL transactions, synthetic data, no provider."""
import concurrent.futures, json, os, pathlib, subprocess
root=pathlib.Path(__file__).resolve().parents[1]
database='studkab_registered_study_concurrency'
env={**os.environ,'PGDATABASE':database}
student='11111111-1111-4111-8111-111111111111'
executor='22222222-2222-4222-8222-222222222222'
def sql(source):
 return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=source,text=True,env=env).strip()
def literal(value):return "'"+str(value).replace("'","''")+"'"
def encoded(value):return literal(json.dumps(value))+"::jsonb"
def call(source):return json.loads(sql('set role service_role;select coalesce(to_jsonb('+source+"),'null'::jsonb);"))
def parallel(fn):
 with concurrent.futures.ThreadPoolExecutor(2) as pool:return list(pool.map(fn,range(2)))
subprocess.run(['createdb',database],check=True)
try:
 migrations=['20261001162253_route02_receive_before_analysis.sql','20261001175519_route02_registered_reading.sql','20261002015056_route02_registered_analysis.sql','20260921165603_c084_requirement_clarifications.sql','20260926114639_c120_dialog_events.sql','20261002015751_route02_private_questions.sql','20261002020616_route02_reviewed_classification.sql','20261002031300_route02_kit_review.sql']
 setup=subprocess.check_output(['node','--input-type=module','-e',"import fs from 'node:fs';import {schema,submissionExtension} from './tests/intake-fixture.mjs';process.stdout.write(schema()+submissionExtension()+"+json.dumps(migrations)+".map(n=>fs.readFileSync('supabase/migrations/'+n,'utf8')).join(''));"],cwd=root,text=True)
 sql(setup)
 sql(f"alter table auth.users add column email text;update auth.users set email='executor@example.invalid' where id='{executor}';grant select(id,email) on auth.users to service_role;update studkab_request_config set executor_email='executor@example.invalid';update studkab_intake_analysis_policy set enabled=true,limit_microusd=10000000;update studkab_gen_budget set limit_microusd=10000000;")
 draft=call(f"studkab_intake_open('{student}')")['id']
 f=call(f"studkab_intake_reserve('{student}','{draft}','Task.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',10,'{'a'*64}',null)")['file']
 call(f"studkab_intake_finish('{student}','{draft}','{f['id']}','{f['file_hash']}')")
 snap=call(f"studkab_intake_receive_snapshot('{student}','{draft}')")
 receipts=parallel(lambda _:call(f"studkab_intake_receive('{student}','{draft}',{snap['revision']},'2026-10-30','','synthetic@example.invalid')"))
 assert receipts[0]['id']==receipts[1]['id'];request=receipts[0]['id']
 claims=parallel(lambda _:call("studkab_registered_read_claim('intake-reader-1')"))
 assert sum(x is not None for x in claims)==1
 c=next(x for x in claims if x)
 text='Предоставить исходные данные за 2022–2024 годы.'
 reading={'schema':1,'status':'ready','readerVersion':'intake-reader-1','fileId':f['id'],'fileHash':f['file_hash'],'blocks':[{'text':text,'kind':'paragraph','source':{'paragraph':1}}],'warnings':[],'extracted_text':text}
 finished=parallel(lambda _:call(f"studkab_registered_read_finish('{request}',{c['revision']},'{f['id']}','{c['file']['read_lease']}','intake-reader-1',{encoded(reading)})"))
 assert all(x.get('saved',False) for x in finished);assert sum(x.get('duplicate',False) for x in finished)==1
 src=call(f"studkab_registered_analysis_source('{request}')")
 manifest=sql(f"select encode(sha256(convert_to(studkab_registered_analysis_source('{request}')::text,'UTF8')),'hex')")
 plan=[{'analysis_version':'intake-analysis-2','kind':'kit_review','review_version':'registered-kit-review-1','blocks':[{'blockId':'b0','text':text}],'prompt':'synthetic-only','max_output_tokens':4000,'max_cost_microusd':1000}]
 starts=parallel(lambda _:call(f"studkab_registered_analysis_start('{request}','{manifest}',{encoded(plan)})"))
 assert starts[0]['id']==starts[1]['id'];job=starts[0]['id']
 leases=parallel(lambda _:call('studkab_intake_analysis_claim()'))
 assert sum(x is not None for x in leases)==1;c=next(x for x in leases if x)
 def dispatch(_):
  try:return call(f"studkab_intake_analysis_dispatch('{job}','{c['claim']}',1000)")
  except subprocess.CalledProcessError:return 'STALE_CLAIM'
 sent=parallel(dispatch);assert sent.count('STALE_CLAIM')==1;provider_id=next(x for x in sent if x!='STALE_CLAIM')
 assert int(sql('select reserved_microusd from studkab_gen_budget'))==1000
 ref={'fileId':f['id'],'fileHash':f['file_hash'],'fileName':'Task.docx','source':{'paragraph':1},'quote':text}
 result={'analysisVersion':'intake-analysis-2','status':'candidate','fields':{},'roles':[{'role':'assignment','refs':[ref]}],'requirements':[],'kitReview':{'version':'registered-kit-review-1','gaps':[{'key':'years','question':'Где исходные данные за требуемые годы?','reason':'Задание требует исходные данные.','refs':[ref],'answerId':None}],'answerReviews':[],'returnedReviews':[]}}
 call(f"studkab_intake_analysis_finish('{job}','{c['claim']}','{provider_id}',{encoded({'candidates':[],'roles':[]})},{encoded(result)},'synthetic-only',null)")
 refresh=parallel(lambda _:call(f"studkab_registered_questions_refresh('{request}')"))
 assert len(refresh[0]['proposals'])==len(refresh[1]['proposals'])==1;q=refresh[0]['proposals'][0]
 assert int(sql('select count(*) from studkab_dialog_events'))==0
 classified=parallel(lambda _:call(f"studkab_registered_material_classify('{request}','{executor}','{job}','{f['id']}','assignment')"))
 assert all(x['saved'] for x in classified);assert sum(x.get('duplicate',False) for x in classified)==1
 published=parallel(lambda _:call(f"studkab_registered_question_decide('{request}','{executor}','{q['id']}','publish','Уточните местонахождение данных.')"))
 assert all(x['state']=='published' for x in published);assert sum(x.get('duplicate',False) for x in published)==1
 assert int(sql('select count(*) from studkab_clarifications'))==1
 assert int(sql("select count(*) from studkab_dialog_events where kind='question'"))==1
 try:sql(f"set role service_role;insert into studkab_requirement_passports(request_id,status) values('{request}','approved');")
 except subprocess.CalledProcessError:pass
 else:raise AssertionError('unresolved essential gap approved')
 answers=parallel(lambda _:call(f"studkab_clarification_answer('{request}','{student}','{q['id']}','Не знаю','Уточню у преподавателя')"))
 assert all(x['answer']=='Не знаю' for x in answers)
 assert int(sql("select count(*) from studkab_dialog_events where kind='answer'"))==1
 assert call(f"studkab_registered_analysis_state('{request}','{executor}')")['state']=='awaiting_analysis'
 assert sql('select file_hash from studkab_request_attachments')=='a'*64
 print('PASS: native registered reading/queue/dispatch/proposal/classification/decision/answer concurrency; private events and unresolved-gap gate')
finally:
 subprocess.run(['dropdb','--if-exists',database],check=True)
