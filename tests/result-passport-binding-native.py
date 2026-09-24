"""C109 passport renewal against an isolated, real PostgreSQL database in CI."""
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
if (os.environ.get('CI') != 'true' or os.environ.get('PGHOST') not in ('localhost', '127.0.0.1')
        or os.environ.get('PGDATABASE') != 'safety_test'):
    raise SystemExit('Requires isolated CI PostgreSQL')
ADMIN = os.environ.copy()
NAME = 'studkab_c109_' + uuid.uuid4().hex[:16]
ENV = {**ADMIN, 'PGDATABASE': NAME}
PSQL = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
STUDENT = '11111111-1111-4111-8111-111111111111'
EXECUTOR = '22222222-2222-4222-8222-222222222222'
OTHER = '33333333-3333-4333-8333-333333333333'
FP = 'a' * 64
ITEM_CODES = ['WORK_TYPE', 'DISCIPLINE', 'STRUCTURE', 'VOLUME', 'METHODOLOGY',
              'FORMATTING', 'SOURCES', 'CALCULATIONS', 'ANTIPLAGIARISM', 'TEACHER']


def lit(value):
    if value is None:
        return 'null'
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    return "'" + str(value).replace("'", "''") + "'"


def sql(command, env=ENV):
    return subprocess.check_output(PSQL, input=command, text=True, env=env,
                                   cwd=ROOT, stderr=subprocess.PIPE, timeout=30).strip()


def rpc(name, *args):
    return 'select ' + name + '(' + ','.join(map(lit, args)) + ');'


def call(name, *args):
    return json.loads(sql('set role service_role;' + rpc(name, *args)))


def denied(name, message, *args):
    try:
        call(name, *args)
    except subprocess.CalledProcessError as error:
        assert message in error.stderr, (name, error.stderr)
    else:
        raise AssertionError(name + ' accepted a forbidden call')


created = False
try:
    sql('create database ' + NAME, ADMIN)
    created = True
    setup = subprocess.check_output(
        ['node', '--input-type=module', '-e',
         "import {reassignmentSetupSQL} from './tests/request-reassignment-fixture.mjs';console.log(reassignmentSetupSQL());"],
        text=True, cwd=ROOT, timeout=10)
    sql(setup)
    for migration in [
        '20260923144056_c101_answered_reassignment.sql',
        '20260923153452_c102_quality_evidence.sql',
        '20260924150000_c104_originality_policy.sql',
        '20260924150100_originality_threshold_without_service.sql',
        '20260924170000_c109_result_passport_binding.sql',
    ]:
        sql((ROOT / 'supabase/migrations' / migration).read_text())

    request, source, version = [str(uuid.uuid4()) for _ in range(3)]
    sql('set role service_role;insert into studkab_requests(id,student_id,client_id,payload) values('
        + ','.join(map(lit, [request, STUDENT, request, {'rq': 'Synthetic assignment'}])) + ');')
    sql('set role service_role;insert into studkab_request_attachments'
        '(id,request_id,student_id,category,file_name,content_type,size_bytes,file_hash,storage_path,extracted_text) values('
        + ','.join(map(lit, [source, request, STUDENT, 'sources', 'source.txt',
                             'text/plain', 3, 'c' * 64, source, 'Synthetic accessible source'])) + ');')
    manifest = {'basis': 'Synthetic assignment', 'requirements': [
        {'id': 'task', 'label': 'Assignment', 'required': True, 'attachment_ids': [],
         'answer_ids': [], 'payload_fields': ['rq'], 'not_applicable_reason': ''}]}
    items = [{'id': code, 'category': 'method', 'required': True, 'verified': True,
              'text': ('Оригинальность: не менее 70% в системе Учебная система.'
                       if code == 'ANTIPLAGIARISM' else 'Synthetic material requirement'),
              'source': 'Synthetic assignment page 1', 'answer_ids': [],
              **({'originality': {'mode': 'university_threshold', 'service': 'Учебная система',
                                  'thresholdPercent': 70}} if code == 'ANTIPLAGIARISM' else {})}
             for code in ITEM_CODES]

    def passport(label, requirements):
        p = call('studkab_requirement_passport_save', request, EXECUTOR, label, '',
                 requirements, FP, None, manifest)
        approved = call('studkab_requirement_passport_approve', request, p['id'],
                        EXECUTOR, requirements, FP, None, manifest)
        assert approved['status'] == 'approved'
        return p

    p1 = passport('Original', items)
    word = 'UEsDBHRlc3Q='
    doc = {'topic': 'Synthetic', 'reviewContext': {'passportId': p1['id'],
           'sourceFingerprint': FP, 'fingerprint': 'b' * 64}}
    receipt = call('prepare_studkab_result', request, version, STUDENT, doc, word)

    def quality(p):
        internal = {'disposition': 'pass', 'notes': 'All available synthetic sources compared',
                    'scan': {'fileHash': receipt['fileHash']}, 'scanHash': 'd' * 64,
                    'sourceBindings': [{'id': source, 'fileHash': 'c' * 64}],
                    'scanComplete': True, 'findingIds': [], 'findingDecisions': []}
        external = {'service': 'Учебная система', 'checkId': 'offline-1',
                    'checkedAt': '2026-01-01T00:00:00Z', 'thresholdItemId': 'ANTIPLAGIARISM',
                    'thresholdBasis': items[8]['text'], 'thresholdMode': 'university_threshold',
                    'thresholdPercent': 70, 'actualPercent': 80,
                    'requirementConfirmed': True, 'wordBindingConfirmed': True,
                    'disposition': 'pass', 'notes': 'Synthetic report bound to exact Word'}
        common = [request, version, str(uuid.uuid4()), EXECUTOR, STUDENT, p['id'],
                  receipt['fileHash'], receipt['documentHash'], FP]
        call('studkab_quality_save', *common, 'internal_borrowing', internal, None)
        common[2] = str(uuid.uuid4())
        call('studkab_quality_save', *common, 'external_originality', external,
             'JVBERi0xLjUKc3ludGhldGljCiUlRU9G')

    criteria = {code: {'status': 'pass', 'evidence': 'Checked against synthetic assignment'}
                for code in [f'C{i:02d}' for i in range(1, 14)] + ['S01', 'S02', 'S03']}
    def review(review_id):
        return call('review_studkab_result', request, version, review_id, EXECUTOR, STUDENT,
                    receipt['fileHash'], receipt['documentHash'], criteria)
    def deliver(review_id):
        return call('deliver_reviewed_studkab_result', request, str(uuid.uuid4()), version,
                    review_id, STUDENT, receipt['fileHash'], receipt['documentHash'])

    quality(p1)
    old_review = str(uuid.uuid4())
    assert review(old_review)['reviewId'] == old_review
    assert deliver(old_review)['duplicate'] is False
    revised = [dict(item, text='Changed teacher requirement') if item['id'] == 'TEACHER'
               else item for item in items]
    p2 = passport('Revised', revised)
    new_doc = {**doc, 'reviewContext': {'passportId': p2['id'],
               'sourceFingerprint': FP, 'fingerprint': 'c' * 64}}
    args = [request, version, EXECUTOR, new_doc, ['TEACHER'],
            'Checked the changed teacher requirement against the exact Word']
    denied('studkab_rebind_result_passport', 'FORBIDDEN',
           request, version, OTHER, *args[3:])
    denied('studkab_rebind_result_passport', 'RESULT_BINDING_CONFIRMATION_REQUIRED',
           request, version, EXECUTOR, new_doc, [], args[-1])
    bound = call('studkab_rebind_result_passport', *args)
    assert call('studkab_rebind_result_passport', *args)['bindingId'] == bound['bindingId']
    assert sql('select count(*) from studkab_result_versions where request_id=' + lit(request)) == '1'
    assert json.loads(sql('select document from studkab_result_versions where id='
                          + lit(version))) == doc
    assert sql('select docx_base64 from studkab_result_versions where id=' + lit(version)) == word
    assert call('studkab_quality_check', request, version)['eligible'] is False
    denied('deliver_reviewed_studkab_result', 'QUALITY_EVIDENCE_REQUIRED',
           request, str(uuid.uuid4()), version, old_review, STUDENT,
           receipt['fileHash'], receipt['documentHash'])
    quality(p2)
    denied('deliver_reviewed_studkab_result', 'QUALITY_REVIEW_STALE',
           request, str(uuid.uuid4()), version, old_review, STUDENT,
           receipt['fileHash'], receipt['documentHash'])
    new_review = str(uuid.uuid4())
    assert review(new_review)['reviewId'] == new_review
    assert deliver(new_review)['duplicate'] is False
    assert sql('select count(*) from studkab_results where version_id=' + lit(version)) == '2'
    assert sql('select count(distinct binding_id) from studkab_result_review_bindings '
               'where review_id in (' + lit(old_review) + ',' + lit(new_review) + ')') == '2'
    print('PASS C109 native PostgreSQL: immutable Word, distinct review cycles and deliveries')
finally:
    if created:
        sql('drop database ' + NAME + ' with (force)', ADMIN)
