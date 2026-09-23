"""C101: actual two-connection PostgreSQL schedules, never production.

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
DB_NAME = 'studkab_c101_' + uuid.uuid4().hex[:16]
ENV = {**ADMIN_ENV, 'PGDATABASE': DB_NAME}
PSQL = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
STUDENT = '11111111-1111-4111-8111-111111111111'
EXECUTOR = '22222222-2222-4222-8222-222222222222'
TARGET = '33333333-3333-4333-8333-333333333333'
FP = 'a' * 64
ITEMS = [{'id': key, 'category': 'method', 'required': True, 'verified': True,
          'text': 'Synthetic material requirement', 'source': 'Synthetic assignment page 1', 'answer_ids': []}
         for key in ['WORK_TYPE', 'DISCIPLINE', 'STRUCTURE', 'VOLUME', 'METHODOLOGY',
                     'FORMATTING', 'SOURCES', 'CALCULATIONS', 'ANTIPLAGIARISM', 'TEACHER']]
REASON = 'Synthetic approved administrative reassignment'
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
                   + command + "select 'C101_HELD';\n").encode())
    p.stdin.flush()
    buffer = b''
    deadline = time.monotonic() + 10
    while b'C101_HELD\n' not in buffer:
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


def race(label, first, second, expected_error=None, cloud_conflict=False, expected_json_error=None):
    winner = begin_held(first)
    loser = contender(second, 'c101_' + uuid.uuid4().hex[:12])
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
    elif expected_json_error:
        assert loser.returncode == 0, combined
        reply = json.loads(output.strip().splitlines()[-1])
        assert reply.get('error') == expected_json_error, reply
    else:
        assert loser.returncode == 0 and '\"error\"' not in output, label + ': ' + combined
        if cloud_conflict:
            reply = json.loads(output.strip().splitlines()[-1])
            assert reply['ok'] is False and reply['conflict'] is True, reply
    print('PASS native lock wait: ' + label)


def attachment(q, previous=None):
    ident = str(uuid.uuid4())
    values = [ident, q, STUDENT, 'assignment', 'synthetic.txt', 'text/plain', 3,
              ident.replace('-', '').ljust(64, '0'), ident, 'Synthetic immutable materials', previous]
    return ('set role service_role;insert into studkab_request_attachments('
            'id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,'
            'storage_path,extracted_text,supersedes) values(' + ','.join(map(lit, values)) + ');'), ident


def new_case():
    q = str(uuid.uuid4())
    client_id = 'synthetic_' + uuid.uuid4().hex
    payload = {'v': 1, 'id': client_id, 't': 'Synthetic reassignment lock test',
               'rq': 'Synthetic assignment text', 'n': 'Synthetic student', 'g': 'Test group',
               'dl': '2026-12-01', 'cn': 'Synthetic contact', 'org': 'Synthetic data',
               'mn': 'Synthetic method', 'k': 'Coursework', 'd': 'Test discipline',
               'u': '', 'fc': '', 'kf': '', 'ct': '', 'pr': '', 'fo': '', 'co': '', 's': '',
               'fm': {'mt': 20, 'mr': 20, 'mb': 20, 'ml': 20, 'fn': 'Arial',
                      'sz': 12, 'sp': 1.5, 'ind': 1.25}}
    call('insert into studkab_requests(id,student_id,client_id,payload) values('
         + ','.join(map(lit, [q, STUDENT, client_id, payload])) + ');')
    upload, a = attachment(q)
    sql(upload)
    expected = int(call('select revision from studkab_requests where id=' + lit(q)))
    number = int(call('select number from studkab_requests where id=' + lit(q)))
    manifest = {'basis': 'Synthetic assignment', 'requirements': [
        {'id': 'assignment', 'label': 'Assignment', 'required': True,
         'attachment_ids': [a], 'answer_ids': [], 'payload_fields': []}]}
    passport = json.loads(call(rpc('studkab_requirement_passport_save', q, EXECUTOR,
                                  'Synthetic passport', '', ITEMS, FP, expected, manifest)))
    assert 'id' in passport, passport
    source_data = {'works': [{'id': 'source_other', 'topic': 'Preserve source card'}],
                   'settings': {'name': 'Synthetic source'}, 'notes': ['source untouched']}
    target_data = {'works': [{'id': 'target_other', 'topic': 'Preserve target card'}],
                   'settings': {'name': 'Synthetic target'}, 'notes': ['target untouched']}
    for user, data in [(STUDENT, source_data), (TARGET, target_data)]:
        sql('insert into app_data(user_id,app,data,rev) values('
            + ','.join(map(lit, [user, 'kabinet', data, 1]))
            + ') on conflict(user_id,app) do update set data=excluded.data,rev=excluded.rev;')
    sql('insert into studkab_request_reassignment_permissions(request_id,from_student_id,to_student_id,reason) values('
        + ','.join(map(lit, [q, STUDENT, TARGET, REASON])) + ');')
    request = json.loads(sql('select row_to_json(r) from studkab_requests r where id=' + lit(q)))
    # Exercise the actual mapping used by the administrative operation, not a
    # parallel hand-written card shape that can drift from its SQL validation.
    work = json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e',
         "import {requestWorkCard} from './scripts/request-work-card.mjs';"
         "import fs from 'node:fs';const x=JSON.parse(fs.readFileSync(0,'utf8'));"
         "console.log(JSON.stringify(requestWorkCard(x.request,x.workId,{attachmentCount:1})));"],
        input=json.dumps({'request': request, 'workId': 'w' + uuid.uuid4().hex}),
        text=True, cwd=ROOT, timeout=10))
    transfer = rpc('studkab_reassign_request', str(uuid.uuid4()), q, STUDENT, TARGET,
                   EXECUTOR, REASON, expected, 1, 1, work)
    approval = 'set role service_role;' + rpc('studkab_requirement_passport_approve',
                 q, passport['id'], EXECUTOR, passport['items'], FP, expected, manifest)
    return {'q': q, 'a': a, 'passport': passport, 'expected': expected, 'number': number,
            'payload': payload, 'source': source_data, 'target': target_data,
            'transfer': transfer, 'approval': approval, 'work': work}


def cloud_save(user, data):
    return ('set role authenticated;set request.jwt.claim.sub=' + lit(user) + ';'
            'select row_to_json(s) from public.save_app_data_v2('
            + ','.join(map(lit, ['kabinet', data, 1])) + ') s;')


def assert_state(case, transferred, attachments=1):
    q = case['q']
    request = json.loads(sql('select row_to_json(r) from studkab_requests r where id=' + lit(q)))
    assert request['student_id'] == (TARGET if transferred else STUDENT), request
    assert request['number'] == case['number'] and request['payload'] == case['payload'], request
    assert int(sql('select count(*) from studkab_request_reassignments where request_id=' + lit(q))) == int(transferred)
    files = json.loads(sql('select json_agg(a) from studkab_request_attachments a where request_id=' + lit(q)))
    assert len(files) == attachments and all(a['student_id'] == STUDENT for a in files), files
    original = next(a for a in files if a['id'] == case['a'])
    assert original['extracted_text'] == 'Synthetic immutable materials', original
    assert original['supersedes'] is None, original
    target = json.loads(sql('select data from app_data where user_id=' + lit(TARGET) + " and app='kabinet'"))
    linked = [w for w in target['works'] if w.get('req', {}).get('serverId') == q]
    assert linked == ([case['work']] if transferred else []), target
    assert target['works'][0] == case['target']['works'][0], target
    assert target['settings'] == case['target']['settings'], target
    if transferred:
        assert sql('select status from studkab_requirement_passports where id='
                   + lit(case['passport']['id'])) == 'stale'


def ask(case, question_id):
    return 'set role service_role;' + rpc('studkab_clarification_ask', case['q'], EXECUTOR,
        question_id, 'ANTIPLAGIARISM', 'Synthetic originality threshold?')


def answer(case, question_id, actor=STUDENT):
    return 'set role service_role;' + rpc('studkab_clarification_answer', case['q'], actor,
        question_id, '70 percent', 'Synthetic teacher instruction')


def question(question_id):
    return json.loads(sql('select row_to_json(c) from studkab_clarifications c where id=' + lit(question_id)))


def make_question(case, answered=False):
    question_id = str(uuid.uuid4())
    reply = json.loads(sql(ask(case, question_id)))
    assert reply['id'] == question_id and reply['answer'] is None, reply
    if answered:
        reply = json.loads(sql(answer(case, question_id)))
        assert reply['answered_by'] == STUDENT and reply['answer'] == '70 percent', reply
    return question_id


created = False
try:
    sql('create database ' + DB_NAME, ADMIN_ENV)
    created = True
    setup = subprocess.check_output(['node', 'tests/material-revision-fixture.mjs', '--print-sql'],
                                    text=True, cwd=ROOT, timeout=10)
    sql(setup)
    sql("""alter table auth.users add column email_confirmed_at timestamptz default now(),
        add column is_anonymous boolean default false, add column deleted_at timestamptz,
        add column banned_until timestamptz;
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;""")
    sql((ROOT / 'baza.sql').read_text())
    sql('grant select,insert,update on app_data to authenticated;')
    for migration in ['20260916100000_studkab_cloud_write_guard.sql',
                      '20260923082944_c098_material_manifest.sql',
                      '20260923120254_c099_test_delivery.sql',
                      '20260923132840_c100_request_reassignment.sql',
                      '20260923144056_c101_answered_reassignment.sql']:
        sql((ROOT / 'supabase/migrations' / migration).read_text())

    case = new_case()
    pending = str(uuid.uuid4())
    race('new clarification before transfer blocks transfer', ask(case, pending), case['transfer'],
         expected_error='REQUEST_REASSIGNMENT_CLARIFICATION')
    assert_state(case, transferred=False)
    assert question(pending)['answer'] is None

    case = new_case()
    answered = make_question(case, answered=True)
    preserved = question(answered)
    pending = str(uuid.uuid4())
    race('transfer before new clarification preserves history and new question',
         case['transfer'], ask(case, pending))
    assert_state(case, transferred=True)
    assert question(answered) == preserved
    assert question(pending)['answer'] is None
    # New owner may answer the new question, without rewriting the original answer.
    reply = json.loads(sql(answer(case, pending, TARGET)))
    assert reply['answered_by'] == TARGET and reply['answer'] == '70 percent', reply
    assert question(answered) == preserved

    case = new_case()
    pending = make_question(case)
    race('answer completes before transfer and remains attributed to original author',
         answer(case, pending), case['transfer'])
    assert_state(case, transferred=True)
    saved = question(pending)
    assert saved['answered_by'] == STUDENT and saved['answer'] == '70 percent', saved
    assert saved['answer_source'] == 'Synthetic teacher instruction' and saved['answered_at']
    digest = sql("select encode(sha256(convert_to((to_jsonb(c)||jsonb_build_object('created_at',extract(epoch from c.created_at),'answered_at',extract(epoch from c.answered_at)))::text,'UTF8')),'hex') from studkab_clarifications c where id=" + lit(pending))
    snapshot = json.loads(sql('select clarification_snapshot from studkab_request_reassignments where request_id=' + lit(case['q'])))
    assert snapshot[pending] == digest, snapshot

    case = new_case()
    answered = make_question(case, answered=True)
    preserved = question(answered)
    race('successful transfer rejects original owner repeated answer', case['transfer'],
         answer(case, answered), expected_error='FORBIDDEN')
    assert_state(case, transferred=True)
    assert question(answered) == preserved
    # A new owner cannot overwrite the preserved original response either.
    reply = json.loads(sql(answer(case, answered, TARGET)))
    assert reply.get('error') == 'Ответ уже сохранён. Для исправления попросите исполнителя создать новое уточнение', reply
    assert question(answered) == preserved

    assert call('select count(*) from studkab_gen_jobs') == '0'
    assert call('select count(*) from studkab_gen_attempts') == '0'
    assert call('select reserved_microusd from studkab_gen_budget') == '0'
    print('PASS C101: 4 real two-connection schedules; immutable clarification authorship and no stale-owner writes')
finally:
    for process in RUNNING:
        if process.poll() is None:
            process.kill()
            process.communicate()
    if created:
        sql('drop database ' + DB_NAME + ' with (force)', ADMIN_ENV)
