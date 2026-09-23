"""C096 native two-connection tests. Only CI loopback; own disposable database.

Run after tests/sql_safety.py with PGDATABASE=safety_test. No production server,
network provider, deployment, real account, or existing application rows are used.
PGlite serializes queries; this harness verifies actual PostgreSQL lock waits.
"""
import base64
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
DB_NAME = 'studkab_c096_' + uuid.uuid4().hex[:16]
ENV = {**ADMIN_ENV, 'PGDATABASE': DB_NAME}
PSQL = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
STUDENT = '11111111-1111-4111-8111-111111111111'
EXECUTOR = '22222222-2222-4222-8222-222222222222'
FP = 'a' * 64
ITEMS = [{'id': key, 'category': 'method', 'required': True, 'verified': True,
          'text': 'Synthetic material requirement', 'source': 'Synthetic assignment page 1', 'answer_ids': []}
         for key in ['WORK_TYPE', 'DISCIPLINE', 'STRUCTURE', 'VOLUME', 'METHODOLOGY',
                     'FORMATTING', 'SOURCES', 'CALCULATIONS', 'ANTIPLAGIARISM', 'TEACHER']]
PLAN = [{'id': 'intro', 'prompt': 'Synthetic offline part', 'max_cost_microusd': 250000,
         'max_output_tokens': 4000}]
INPUT = {'system': 'Synthetic offline test', 'prompts': {'intro': 'Synthetic part'},
         'material_fingerprint': FP}
REASON = 'Additional synthetic input data required'
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


def revision(q):
    return int(call('select revision from studkab_requests where id=' + lit(q)))


def attachment(q, previous=None, cycle=None):
    ident = str(uuid.uuid4())
    return ("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,"
            "content_type,size_bytes,file_hash,storage_path,extracted_text,supersedes,material_revision_id) values("
            + ','.join(map(lit, [ident, q, STUDENT, 'assignment', 'synthetic.txt', 'text/plain',
                                3, ident.replace('-', '').ljust(64, '0'), ident,
                                'Synthetic immutable materials', previous, cycle])) + ');'), ident


def new_case(approved=True):
    q = str(uuid.uuid4())
    call('insert into studkab_requests(id,student_id,client_id,payload) values('
         + ','.join(map(lit, [q, STUDENT, q, {'id': q, 't': 'Synthetic lock test'}])) + ');')
    upload, a = attachment(q)
    call(upload)
    p = json.loads(call(rpc('studkab_requirement_passport_save', q, EXECUTOR, 'Synthetic', '', ITEMS, FP)))
    if approved:
        call(approve_sql(q, p))
    return q, a, p


def approve_sql(q, p):
    return rpc('studkab_requirement_passport_approve', q, p['id'], EXECUTOR, p['items'], FP)


def open_sql(q, cycle, expected):
    return rpc('studkab_material_revision_open', q, EXECUTOR, cycle, REASON, expected)


def complete_sql(q, cycle, expected):
    return rpc('studkab_material_revision_complete', q, STUDENT, cycle, expected)


def start_sql(q, p):
    return rpc('studkab_gen_start', EXECUTOR, q, INPUT, PLAN, p['id'], 'coursework', 250000)


def prepare_sql(q, p):
    document = {'topic': 'Synthetic', 'reviewContext': {'passportId': p['id'],
                'sourceFingerprint': FP, 'fingerprint': 'b' * 64}}
    return rpc('prepare_studkab_result', q, str(uuid.uuid4()), STUDENT, document,
               base64.b64encode(b'PK\x03\x04synthetic').decode())


def state(q):
    return json.loads(call(rpc('studkab_material_revision_state', q, EXECUTOR)))['materials']


def begin_held(command):
    p = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, env=ENV, cwd=ROOT)
    RUNNING.append(p)
    p.stdin.write(('begin;set local statement_timeout=10000;set local role service_role;'
                   + command + "select 'C096_HELD';\n").encode())
    p.stdin.flush()
    buffer = b''
    deadline = time.monotonic() + 10
    while b'C096_HELD\n' not in buffer:
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
    loser = contender(second, 'c096_' + uuid.uuid4().hex[:12])
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


created = False
try:
    sql('create database ' + DB_NAME, ADMIN_ENV)
    created = True
    setup = subprocess.check_output(['node', 'tests/material-revision-fixture.mjs', '--print-sql'],
                                    text=True, cwd=ROOT, timeout=10)
    sql(setup)
    for first_kind, second_kind in [('open', 'start'), ('start', 'open'),
                                    ('open', 'prepare'), ('prepare', 'open')]:
        q, a, p = new_case()
        cycle = str(uuid.uuid4())
        commands = {'open': open_sql(q, cycle, revision(q)),
                    'start': start_sql(q, p), 'prepare': prepare_sql(q, p)}
        race(first_kind + ' before ' + second_kind, commands[first_kind], commands[second_kind])
        is_open = state(q)['state'] == 'open'
        jobs = int(call('select count(*) from studkab_gen_jobs where request_id=' + lit(q)))
        words = int(call('select count(*) from studkab_result_versions where request_id=' + lit(q)))
        assert is_open == (first_kind == 'open')
        assert not (is_open and (jobs or words))
        assert jobs + words == (0 if first_kind == 'open' else 1)

    for first_kind in ['upload', 'complete']:
        q, a, p = new_case()
        cycle = str(uuid.uuid4())
        call(open_sql(q, cycle, revision(q)))
        commands = {'upload': attachment(q, a, cycle)[0], 'complete': complete_sql(q, cycle, revision(q))}
        second_kind = 'complete' if first_kind == 'upload' else 'upload'
        race(first_kind + ' before ' + second_kind, commands[first_kind], commands[second_kind])
        assert (state(q)['state'] == 'open') == (first_kind == 'upload')
        count = int(call('select count(*) from studkab_request_attachments where request_id=' + lit(q)))
        assert count == (2 if first_kind == 'upload' else 1)

    q, a, p = new_case()
    p = json.loads(call(rpc('studkab_requirement_passport_save', q, EXECUTOR, 'New draft', '', ITEMS, FP)))
    cycle = str(uuid.uuid4())
    race('open before old passport approval', open_sql(q, cycle, revision(q)), approve_sql(q, p))
    assert state(q)['state'] == 'open'
    assert call('select status from studkab_requirement_passports where id=' + lit(p['id'])) == 'stale'

    q, a, p = new_case()
    p = json.loads(call(rpc('studkab_requirement_passport_save', q, EXECUTOR, 'New draft', '', ITEMS, FP)))
    cycle = str(uuid.uuid4())
    race('approval before open serializes and then invalidates', approve_sql(q, p),
         open_sql(q, cycle, revision(q)), expect_rejection=False)
    assert state(q)['state'] == 'open'
    assert call('select status from studkab_requirement_passports where id=' + lit(p['id'])) == 'stale'

    assert call('select reserved_microusd from studkab_gen_budget') == '0'
    assert call('select count(*) from studkab_gen_attempts') == '0'
    print('PASS C096: 8 real two-connection schedules; immutable history, zero paid calls/reservations')
finally:
    for process in RUNNING:
        if process.poll() is None:
            process.kill()
            process.communicate()
    if created:
        sql('drop database ' + DB_NAME + ' with (force)', ADMIN_ENV)
