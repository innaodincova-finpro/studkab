"""C102: evidence versus ordinary delivery, actual two-connection schedules.

Run with the safety CI PostgreSQL environment. Each run creates/drops its own
random database and only synthetic accounts. An observed pg_stat_activity Lock
wait is required: sequential execution or mocks cannot satisfy these tests.
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
DB_NAME = 'studkab_c102_' + uuid.uuid4().hex[:16]
ENV = {**ADMIN_ENV, 'PGDATABASE': DB_NAME}
PSQL = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
STUDENT = '11111111-1111-4111-8111-111111111111'
EXECUTOR = '22222222-2222-4222-8222-222222222222'
FP = 'a' * 64
ITEMS = [{'id': key, 'category': 'method', 'required': True, 'verified': True,
          'text': 'Synthetic material requirement', 'source': 'Synthetic assignment page 1', 'answer_ids': []}
         for key in ['WORK_TYPE', 'DISCIPLINE', 'STRUCTURE', 'VOLUME', 'METHODOLOGY',
                     'FORMATTING', 'SOURCES', 'CALCULATIONS', 'ANTIPLAGIARISM', 'TEACHER']]
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
    p.stdin.write(('begin;set local statement_timeout=10000;'
                   + command + "select 'C102_HELD';\n").encode())
    p.stdin.flush()
    buffer = b''
    deadline = time.monotonic() + 10
    while b'C102_HELD\n' not in buffer:
        if p.poll() is not None:
            raise AssertionError('Winner failed: ' + p.stderr.read().decode())
        if time.monotonic() > deadline:
            raise AssertionError('Winner failed to reach hold point')
        if select.select([p.stdout], [], [], 0.05)[0]:
            buffer += os.read(p.stdout.fileno(), 65536)
    assert b'"error"' not in buffer, buffer.decode()
    assert b'"ok":false' not in buffer.replace(b' ', b''), buffer.decode()
    return p


def contender(command, name):
    p = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, env=ENV, cwd=ROOT)
    RUNNING.append(p)
    p.stdin.write(('set application_name=' + lit(name) + ';set statement_timeout=10000;' + command).encode())
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


def race(label, first, second, expected_error=None):
    winner = begin_held(first)
    loser = contender(second, 'c102_' + uuid.uuid4().hex[:12])
    winner.stdin.write(b'commit;\n\\q\n')
    winner.stdin.close()
    winner.stdin = None
    _, first_error = winner.communicate(timeout=12)
    assert winner.returncode == 0, first_error.decode()
    out, err = loser.communicate(timeout=12)
    output, errors = out.decode(), err.decode()
    combined = output + errors
    assert 'deadlock' not in combined.lower(), combined
    assert 'statement timeout' not in combined.lower(), combined
    if expected_error:
        assert loser.returncode != 0 and expected_error in combined, label + ': ' + combined
    else:
        assert loser.returncode == 0 and '\"error\"' not in output, label + ': ' + combined
    print('PASS native lock wait: ' + label)


def new_case():
    q, attachment, version = [str(uuid.uuid4()) for _ in range(3)]
    call('insert into studkab_requests(id,student_id,client_id,payload) values('
         + ','.join(map(lit, [q, STUDENT, q, {'rq': 'Synthetic assignment'}])) + ');')
    call("insert into studkab_request_attachments(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text) values("
         + ','.join(map(lit, [attachment, q, STUDENT, 'sources', 'source.txt', 'text/plain', 3,
                            'c'*64, attachment, 'Synthetic accessible source fragment'])) + ');')
    manifest = {'basis': 'Synthetic assignment', 'requirements': [{'id': 'task', 'label': 'Assignment',
                'required': True, 'attachment_ids': [], 'answer_ids': [], 'payload_fields': ['rq'],
                'not_applicable_reason': ''}]}
    items = [dict(i, text='Система проверки: учебная. Оригинальность не ниже 70%.')
             if i['id'] == 'ANTIPLAGIARISM' else i for i in ITEMS]
    passport = json.loads(call(rpc('studkab_requirement_passport_save', q, EXECUTOR,
                         'Synthetic passport', '', items, FP, None, manifest)))
    approved = json.loads(call(rpc('studkab_requirement_passport_approve', q, passport['id'],
                          EXECUTOR, items, FP, None, manifest)))
    assert approved.get('status') == 'approved', approved
    document = {'topic': 'Synthetic', 'reviewContext': {'passportId': passport['id'],
                'sourceFingerprint': FP, 'fingerprint': 'b'*64}}
    prepared = json.loads(call(rpc('prepare_studkab_result', q, version, STUDENT, document, 'UEsDBHRlc3Q=')))
    f = {'q': q, 'a': attachment, 'v': version, 'p': passport, 'r': prepared}
    internal = {'disposition': 'pass', 'notes': 'Accessible source fragments manually reviewed',
                'scan': {'fileHash': prepared['fileHash']}, 'scanHash': 'd'*64,
                'sourceBindings': [{'id': attachment, 'fileHash': 'c'*64}], 'scanComplete': True,
                'findingIds': ['match1'], 'findingDecisions': [{'findingId': 'match1',
                'disposition': 'explained', 'notes': 'Quotation correctly attributed to source'}]}
    f['internalId'] = str(uuid.uuid4())
    call(save(f, 'internal_borrowing', internal, f['internalId']))
    f['external'] = {'service': 'Учебная система', 'checkId': 'offline-1',
        'checkedAt': '2026-01-01T00:00:00Z', 'thresholdItemId': 'ANTIPLAGIARISM',
        'thresholdBasis': next(i['text'] for i in items if i['id']=='ANTIPLAGIARISM'),
        'thresholdPercent': 70, 'actualPercent': 80, 'requirementConfirmed': True,
        'wordBindingConfirmed': True, 'reportName': 'report.pdf', 'disposition': 'pass',
        'notes': 'Exact Word and offline synthetic report manually bound'}
    f['externalId'] = str(uuid.uuid4())
    call(save(f, 'external_originality', f['external'], f['externalId']))
    criteria = {k: {'status': 'pass', 'evidence': 'Checked against exact synthetic materials'}
                for k in ['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12','C13','S01','S02','S03']}
    f['reviewId'], f['deliveryId'] = str(uuid.uuid4()), str(uuid.uuid4())
    reviewed = json.loads(call(rpc('review_studkab_result', q, version, f['reviewId'], EXECUTOR,
                         STUDENT, prepared['fileHash'], prepared['documentHash'], criteria)))
    assert reviewed['reviewId'] == f['reviewId'], reviewed
    f['reviewBefore'] = sql('select to_jsonb(r) from studkab_result_reviews r where id='+lit(f['reviewId']))
    return f


def save(f, kind, payload, ident):
    import base64
    report = base64.b64encode(b'%PDF-1.7\nsynthetic\n%%EOF').decode() if kind=='external_originality' else None
    return rpc('studkab_quality_save', f['q'], f['v'], ident, EXECUTOR, STUDENT,
               f['p']['id'], f['r']['fileHash'], f['r']['documentHash'], FP, kind, payload, report)


def delivery(f):
    return 'set role service_role;' + rpc('deliver_reviewed_studkab_result', f['q'], f['deliveryId'],
           f['v'], f['reviewId'], STUDENT, f['r']['fileHash'], f['r']['documentHash'])


def verify(f, delivered):
    assert sql('select to_jsonb(r) from studkab_result_reviews r where id='+lit(f['reviewId'])) == f['reviewBefore']
    snapshot = json.loads(sql('select quality_evidence_ids from studkab_result_reviews where id='+lit(f['reviewId'])))
    assert snapshot == {'internal_borrowing': f['internalId'], 'external_originality': f['externalId']}, snapshot
    assert call('select count(*) from studkab_quality_evidence where request_id='+lit(f['q'])) == '3'
    assert call('select count(*) from studkab_results where request_id='+lit(f['q'])) == str(int(delivered))
    if delivered:
        record = json.loads(sql('select to_jsonb(r) from studkab_results r where delivery_id='+lit(f['deliveryId'])))
        assert record['review_id'] == f['reviewId'] and record['version_id'] == f['v'], record
        assert sql('select file_hash from studkab_result_versions where id='+lit(record['version_id'])) == f['r']['fileHash']


created = False
try:
    sql('create database '+DB_NAME, ADMIN_ENV)
    created = True
    setup = subprocess.check_output(['node', '--input-type=module', '-e',
        "import {reassignmentSetupSQL} from './tests/request-reassignment-fixture.mjs';console.log(reassignmentSetupSQL());"],
        text=True, cwd=ROOT, timeout=10)
    sql(setup)
    for migration in ['20260923144056_c101_answered_reassignment.sql',
                      '20260923153452_c102_quality_evidence.sql']:
        sql((ROOT/'supabase/migrations'/migration).read_text())
    for disposition in ['fail', 'pass']:
        f = new_case()
        replacement = dict(f['external'], disposition=disposition, actualPercent=50 if disposition=='fail' else 85)
        write = 'set role service_role;' + save(f, 'external_originality', replacement, str(uuid.uuid4()))
        race('new '+disposition+' evidence commits before delivery', write, delivery(f),
             expected_error='QUALITY_EVIDENCE_REQUIRED' if disposition=='fail' else 'QUALITY_REVIEW_STALE')
        verify(f, False)
        f = new_case()
        replacement = dict(f['external'], disposition=disposition, actualPercent=50 if disposition=='fail' else 85)
        write = 'set role service_role;' + save(f, 'external_originality', replacement, str(uuid.uuid4()))
        race('delivery commits before new '+disposition+' evidence; history survives', delivery(f), write)
        verify(f, True)
    assert call('select count(*) from studkab_gen_jobs') == '0'
    assert call('select reserved_microusd from studkab_gen_budget') == '0'
    print('PASS C102: 4 actual lock-wait schedules, no stale delivery or historical rewrite')
finally:
    for process in RUNNING:
        if process.poll() is None:
            process.kill()
            process.communicate()
    if created:
        sql('drop database '+DB_NAME+' with (force)', ADMIN_ENV)
