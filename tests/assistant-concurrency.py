"""ASSISTANT native two-connection tests. Only CI loopback; own disposable database.

Run after tests/sql_safety.py with PGDATABASE=safety_test. No production server,
network provider, deployment, real account, or existing application rows are used.
PGlite serializes queries; this harness verifies actual PostgreSQL lock waits.
"""
import json
import os
from pathlib import Path
import select
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
if (os.environ.get('CI') != 'true' or os.environ.get('PGHOST') not in ('localhost', '127.0.0.1')
        or os.environ.get('PGDATABASE') != 'safety_test'):
    raise SystemExit('Refusing: requires CI=true, loopback PGHOST and PGDATABASE=safety_test')

ADMIN_ENV = os.environ.copy()
DB_NAME = 'studkab_assistant_' + uuid.uuid4().hex[:16]
ENV = {**ADMIN_ENV, 'PGDATABASE': DB_NAME}
PSQL = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
STUDENT = '11111111-1111-4111-8111-111111111111'
EXECUTOR = '22222222-2222-4222-8222-222222222222'
FP = 'a' * 64
RUNNING = []


def lit(value):
    if value is None:
        return 'null'
    if isinstance(value, (dict, list)):
        value = json.dumps(value)
    return "'" + str(value).replace("'", "''") + "'"


def sql(command, env=ENV):
    return subprocess.check_output(PSQL, input=command, text=True, env=env,
                                   cwd=ROOT, stderr=subprocess.PIPE, timeout=20).strip()


def rpc(name, *args):
    return 'select ' + name + '(' + ','.join(map(lit, args)) + ');'


def call(command):
    return sql('set role service_role;' + command)


def begin_held(command):
    p = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, env=ENV, cwd=ROOT)
    RUNNING.append(p)
    p.stdin.write(('begin;set local statement_timeout=10000;set local role service_role;'
                   + command + "select 'ASSISTANT_HELD';\n").encode())
    p.stdin.flush()
    buffer = b''
    deadline = time.monotonic() + 10
    while b'ASSISTANT_HELD\n' not in buffer:
        if p.poll() is not None:
            raise AssertionError('Winner failed: ' + p.stderr.read().decode())
        if time.monotonic() > deadline:
            raise AssertionError('Winner failed to reach hold point')
        if select.select([p.stdout], [], [], 0.05)[0]:
            buffer += os.read(p.stdout.fileno(), 65536)
    assert b'"error"' not in buffer, buffer.decode()
    return p


def contender(command, name):
    p = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, env=ENV, cwd=ROOT)
    RUNNING.append(p)
    p.stdin.write(('set application_name=' + lit(name) + ';set statement_timeout=10000;'
                   'set role service_role;' + command).encode())
    p.stdin.close()
    p.stdin = None
    deadline = time.monotonic() + 8
    while True:
        waiting = sql("select count(*) from pg_stat_activity where datname=current_database() "
                      "and application_name=" + lit(name) + " and wait_event_type='Lock'")
        if waiting == '1':
            return p
        if p.poll() is not None:
            out, err = p.communicate()
            raise AssertionError('Contender did not wait on PostgreSQL lock: '
                                 + out.decode() + err.decode())
        if time.monotonic() > deadline:
            raise AssertionError('Expected real PostgreSQL lock wait was not observed')
        time.sleep(0.03)


def race(label, first, second, expect_rejection=True):
    winner = begin_held(first)
    loser = contender(second, 'assistant_' + uuid.uuid4().hex[:12])
    winner.stdin.write(b'commit;\n\\q\n')
    winner.stdin.close()
    winner.stdin = None
    _, first_error = winner.communicate(timeout=12)
    assert winner.returncode == 0, first_error.decode()
    out, err = loser.communicate(timeout=12)
    combined = out.decode() + err.decode()
    assert 'deadlock' not in combined.lower(), combined
    assert 'statement timeout' not in combined.lower(), combined
    rejected = loser.returncode != 0 or '"error"' in out.decode()
    assert rejected == expect_rejection, label + ': ' + combined
    print('PASS native lock wait: ' + label)


STUDENT='11111111-1111-4111-8111-111111111111'
EXECUTOR='22222222-2222-4222-8222-222222222222'
HASH='b'*64
WORD='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
def request():
    q=str(uuid.uuid4())
    call("insert into studkab_requests(id,student_id,payload) values("+','.join(map(lit,[q,STUDENT,{'route':'r3','n':'Offline Student','rq':'Synthetic offline assignment'}]))+');')
    snapshot=json.loads(call(rpc('studkab_assistant_snapshot',q,EXECUTOR)))
    args=[q,EXECUTOR,'claude',str(uuid.uuid4()),1,FP,snapshot['basis'],{'schema':1},['answer']]
    return q,args

def saved():
    q,args=request()
    job=json.loads(call(rpc('studkab_assistant_accept',*args)))['jobId']
    return q,job

def financially_started(q,job):
    quote=json.loads(call(rpc('studkab_assistant_quote',job,EXECUTOR,5000,'claude-offline','b'*64)))
    call(rpc('studkab_assistant_confirm_queue',job,EXECUTOR,quote['quoteId'],5000))
    claim=json.loads(call(rpc('studkab_assistant_claim',job,EXECUTOR)))['claim']
    permit=json.loads(call(rpc('studkab_assistant_reserve_dispatch',job,EXECUTOR,claim,5000,'claude-offline','b'*64)))
    assert permit['ok'] is True
    return claim,permit['dispatchId']

def completed(q,job):
    claim,dispatch=financially_started(q,job)
    response={'status':'completed','jobId':job,'requestId':q,'provider':'claude','revision':1,'fingerprint':FP,'dispatchId':dispatch,'sections':[{'id':'answer','text':'Synthetic offline output'}]}
    call(rpc('studkab_assistant_complete',job,EXECUTOR,claim,response))

def returning(q,job):
    completed(q,job)
    claim=json.loads(call(rpc('studkab_assistant_begin_return',job,EXECUTOR,1,FP)))['claim']
    return rpc('studkab_assistant_commit_return',job,EXECUTOR,claim,1,FP,'Work.docx',WORD,1200,HASH,'r3-results/'+q+'/'+HASH)

created=False
try:
    sql('create database '+DB_NAME,ADMIN_ENV);created=True
    setup=subprocess.check_output(['node','tests/assistant-budget-fixture.mjs','--print-sql'],text=True,cwd=ROOT,timeout=15)
    sql(setup)
    sql('update studkab_gen_budget set limit_microusd=10000000,reserved_microusd=0;')
    q,args=request()
    accept=rpc('studkab_assistant_accept',*args)
    race('duplicate acceptance receipt',accept,accept,expect_rejection=False)
    assert call('select count(*) from studkab_assistant_jobs where request_id='+lit(q))=='1'
    q,args=request()
    race('changed kit before acceptance','update studkab_requests set revision=2 where id='+lit(q)+';',rpc('studkab_assistant_accept',*args))
    q,job=saved();commit=returning(q,job)
    race('changed kit before file return','update studkab_requests set revision=2 where id='+lit(q)+';',commit)
    assert call('select returned_at is null from studkab_assistant_jobs where id='+lit(job))=='t'
    q,job=saved();commit=returning(q,job)
    race('duplicate return receipt',commit,commit,expect_rejection=False)
    assert call('select count(*) from studkab_assistant_events where job_id='+lit(job)+" and kind='returned'")=='1'
    race('review then delivery locks same current file',rpc('studkab_assistant_review',job,EXECUTOR,HASH),rpc('studkab_r3_deliver',q,HASH),expect_rejection=False)
    q,job=saved();call(returning(q,job))
    race('changed materials cannot borrow existing review','update studkab_requests set revision=2 where id='+lit(q)+';',rpc('studkab_assistant_review',job,EXECUTOR,HASH))
    q,job=saved();claim,dispatch=financially_started(q,job)
    response={'status':'completed','jobId':job,'requestId':q,'provider':'claude','revision':1,'fingerprint':FP,'dispatchId':dispatch,'sections':[{'id':'answer','text':'Synthetic output'}]}
    race('expired dispatch rejects late completion',"update studkab_assistant_jobs set lease_until=clock_timestamp()-interval '1 second' where id="+lit(job)+';',rpc('studkab_assistant_complete',job,EXECUTOR,claim,response))
    # Shared-budget races use disposable policy values, never production limits.
    baseline=int(call('select reserved_microusd from studkab_gen_budget'))
    attempts=int(call('select count(*) from studkab_assistant_attempts'))
    sql('update studkab_gen_budget set limit_microusd=10000000;update studkab_gen_policy set temporary_total_microusd='+str(baseline+10000)+';')
    def paid_candidate():
        q,args=request();args[2]='deepseek'
        job=json.loads(call(rpc('studkab_assistant_accept',*args)))['jobId']
        quote=json.loads(call(rpc('studkab_assistant_quote',job,EXECUTOR,7000)))
        call(rpc('studkab_assistant_confirm_queue',job,EXECUTOR,quote['quoteId'],7000))
        claim=json.loads(call(rpc('studkab_assistant_claim',job,EXECUTOR)))['claim']
        return q,job,claim
    q,j,c=paid_candidate();q2,j2,c2=paid_candidate()
    reserve=rpc('studkab_assistant_reserve_dispatch',j,EXECUTOR,c,7000,'deepseek-flash')
    reserve2=rpc('studkab_assistant_reserve_dispatch',j2,EXECUTOR,c2,7000,'deepseek-flash')
    race('shared policy cap cannot overspend',reserve,reserve2,expect_rejection=False)
    assert int(call('select reserved_microusd from studkab_gen_budget'))==baseline+7000
    assert int(call('select count(*) from studkab_assistant_attempts'))==attempts+1
    assert call(rpc('studkab_intake_ledger_matches',baseline+7000))=='t'
    sql('update studkab_gen_policy set temporary_total_microusd=100000;')
    q,j,c=paid_candidate();reserve=rpc('studkab_assistant_reserve_dispatch',j,EXECUTOR,c,7000,'deepseek-flash')
    race('duplicate dispatch claim pays once',reserve,reserve)
    assert call('select count(*) from studkab_assistant_attempts where job_id='+lit(j))=='1'
    q,j,c=paid_candidate();reserve=rpc('studkab_assistant_reserve_dispatch',j,EXECUTOR,c,7000,'deepseek-flash')
    race('material change precedes financial dispatch','update studkab_requests set revision=2 where id='+lit(q)+';',reserve)
    assert call('select count(*) from studkab_assistant_attempts where job_id='+lit(j))=='0'
    print('PASS assistant: 10 native two-connection schedules; zero inference/provider calls')
finally:
    for process in RUNNING:
        if process.poll() is None:process.kill();process.communicate()
    if created:sql('drop database '+DB_NAME+' with (force)',ADMIN_ENV)
