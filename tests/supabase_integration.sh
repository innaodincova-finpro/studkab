#!/usr/bin/env bash
set -euo pipefail
trap 'echo "FAIL: integration script line $LINENO" >&2' ERR

eval "$(supabase status -o env)"
: "${API_URL:?}" "${DB_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f baza.sql
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f telegram-setup.sql
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f request-delivery.sql
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f result-delivery.sql
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f supabase-test-migrations/202609070001_studkab_push.sql
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f supabase-test-migrations/202609100001_quality_workflow.sql

create_user(){
 curl --fail-with-body --silent --show-error "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  --data "{\"email\":\"$1\",\"password\":\"Test-only-29!safe\",\"email_confirm\":true}"
}
token(){
 curl --fail-with-body --silent --show-error "$API_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  --data "{\"email\":\"$1\",\"password\":\"Test-only-29!safe\"}" | jq -r .access_token
}

echo 'CHECK: create isolated users'
STUDENT_JSON=$(create_user student.workflow@example.test)
OTHER_JSON=$(create_user other.workflow@example.test)
STUDENT_ID=$(jq -r .id <<<"$STUDENT_JSON")
OTHER_ID=$(jq -r .id <<<"$OTHER_JSON")
EXECUTOR_ID="$OTHER_ID"
STUDENT_TOKEN=$(token student.workflow@example.test)
OTHER_TOKEN=$(token other.workflow@example.test)
EXECUTOR_TOKEN="$OTHER_TOKEN"
REQUEST_ID='11111111-1111-4111-8111-111111111111'
OTHER_REQUEST_ID='33333333-3333-4333-8333-333333333333'

psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v student_id="$STUDENT_ID" -v other_id="$OTHER_ID" -v executor_id="$EXECUTOR_ID" -v request_id="$REQUEST_ID" -v other_request_id="$OTHER_REQUEST_ID" <<'SQL'
update public.studkab_workflow_config set enabled=true,pilot_student_ids=array[:'student_id'::uuid] where id=true;
insert into public.studkab_executors(user_id) values(:'executor_id');
insert into public.studkab_requests(id,student_id,client_id,payload)
values(:'request_id',:'student_id','integration-request','{"id":"integration-request","t":"Test","cn":"test"}');
insert into public.studkab_requests(id,student_id,client_id,payload)
values(:'other_request_id',:'other_id','other-integration-request','{"id":"other-integration-request","t":"Test","cn":"test"}');
SQL
echo 'CHECK: workflow initialization and student upload'
test "$(psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "select count(*) from public.studkab_request_process where request_id='$REQUEST_ID'")" = 1
test "$(psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "select count(*) from public.studkab_request_process where request_id='$OTHER_REQUEST_ID'")" = 0

NON_PILOT_BODY=$(jq -nc --arg requestId "$OTHER_REQUEST_ID" '{action:"prepare_upload",requestId:$requestId,commandId:"44444444-4444-4444-8444-444444444444",payload:{purpose:"assignment",originalName:"task.txt",declaredMime:"text/plain",sizeBytes:12}}')
NON_PILOT_CODE=$(curl --silent --output /dev/null --write-out '%{http_code}' "$API_URL/functions/v1/studkab-workflow" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $OTHER_TOKEN" -H 'Content-Type: application/json' --data "$NON_PILOT_BODY")
test "$NON_PILOT_CODE" = 503

SNAPSHOT_BODY=$(jq -nc --arg requestId "$REQUEST_ID" '{action:"get_snapshot",requestId:$requestId,commandId:"55555555-5555-4555-8555-555555555555",payload:{}}')
SNAPSHOT=$(curl --fail-with-body --silent --show-error "$API_URL/functions/v1/studkab-workflow" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' --data "$SNAPSHOT_BODY")
jq -e '.ok == true and .result.role == "student" and .result.process.status == "submitted"' <<<"$SNAPSHOT" >/dev/null

COMMAND_ID='22222222-2222-4222-8222-222222222222'
BODY=$(jq -nc --arg requestId "$REQUEST_ID" --arg commandId "$COMMAND_ID" '{action:"prepare_upload",requestId:$requestId,commandId:$commandId,payload:{purpose:"assignment",originalName:"task.txt",declaredMime:"text/plain",sizeBytes:12}}')
RESPONSE=$(curl --fail-with-body --silent --show-error "$API_URL/functions/v1/studkab-workflow" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' --data "$BODY")
jq -e '.ok == true and .result.duplicate == false' <<<"$RESPONSE" >/dev/null
PATH_VALUE=$(jq -r .result.path <<<"$RESPONSE")

printf 'test content' | curl --fail-with-body --silent --show-error -X POST \
 "$API_URL/storage/v1/object/studkab-private/$PATH_VALUE" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: text/plain' --data-binary @- >/dev/null

FILE_ID=$(jq -r .result.fileId <<<"$RESPONSE")
COMPLETE_BODY=$(jq -nc --arg requestId "$REQUEST_ID" --arg fileId "$FILE_ID" '{action:"complete_upload",requestId:$requestId,commandId:"66666666-6666-4666-8666-666666666666",payload:{fileId:$fileId}}')
COMPLETE=$(curl --fail-with-body --silent --show-error "$API_URL/functions/v1/studkab-workflow" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' --data "$COMPLETE_BODY")
jq -e '.ok == true and .result.state == "accepted" and .result.duplicate == false' <<<"$COMPLETE" >/dev/null
REPLAY=$(curl --fail-with-body --silent --show-error "$API_URL/functions/v1/studkab-workflow" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' --data "$COMPLETE_BODY")
jq -e '.ok == true and .result.state == "accepted" and .result.duplicate == true' <<<"$REPLAY" >/dev/null

CODE=$(curl --silent --output /dev/null --write-out '%{http_code}' \
 "$API_URL/storage/v1/object/authenticated/studkab-private/$PATH_VALUE" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $OTHER_TOKEN")
test "$CODE" = 400 || test "$CODE" = 403 || test "$CODE" = 404

DOWNLOADED=$(curl --fail-with-body --silent --show-error \
 "$API_URL/storage/v1/object/authenticated/studkab-private/$PATH_VALUE" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN")
test "$DOWNLOADED" = 'test content'

workflow(){
 curl --fail-with-body --silent --show-error "$API_URL/functions/v1/studkab-workflow" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $EXECUTOR_TOKEN" -H 'Content-Type: application/json' --data "$1"
}
echo 'CHECK: passport, checklist and verified delivery'
TRANSITION=$(jq -nc --arg requestId "$REQUEST_ID" '{action:"transition_request",requestId:$requestId,commandId:"77777777-7777-4777-8777-777777777777",payload:{expectedRevision:1,nextStatus:"completeness_review",reason:"integration_review"}}')
jq -e '.result.revision == 2' <<<"$(workflow "$TRANSITION")" >/dev/null
ITEMS='[{"code":"DOC-01","ruleText":"Manual review","sourceType":"profile","sourceLocation":"integration","severity":"critical","scope":"whole_document","verificationMethod":"manual","applicability":"applicable"},{"code":"DOC-06","ruleText":"Valid DOCX","sourceType":"profile","sourceLocation":"integration","severity":"critical","scope":"whole_document","verificationMethod":"automatic","applicability":"applicable"},{"code":"DOC-07","ruleText":"Verified version","sourceType":"profile","sourceLocation":"integration","severity":"critical","scope":"whole_document","verificationMethod":"automatic","applicability":"applicable"},{"code":"DOC-08","ruleText":"Correct recipient","sourceType":"profile","sourceLocation":"integration","severity":"critical","scope":"whole_document","verificationMethod":"automatic","applicability":"applicable"}]'
PASSPORT_BODY=$(jq -nc --arg requestId "$REQUEST_ID" --argjson items "$ITEMS" '{action:"submit_passport",requestId:$requestId,commandId:"88888888-8888-4888-8888-888888888888",payload:{expectedRevision:2,profileCode:"financial-course-v1",profileVersion:"1.0",sourceSetHash:("a"*64),items:$items}}')
PASSPORT=$(workflow "$PASSPORT_BODY"); PASSPORT_ID=$(jq -r .result.passportId <<<"$PASSPORT")
jq -e '.result.revision == 3' <<<"$PASSPORT" >/dev/null
APPROVE_PASSPORT=$(jq -nc --arg requestId "$REQUEST_ID" --arg passportId "$PASSPORT_ID" '{action:"approve_passport",requestId:$requestId,commandId:"99999999-9999-4999-8999-999999999999",payload:{passportId:$passportId,expectedRevision:3}}')
jq -e '.result.revision == 4' <<<"$(workflow "$APPROVE_PASSPORT")" >/dev/null
PREPARING=$(jq -nc --arg requestId "$REQUEST_ID" '{action:"transition_request",requestId:$requestId,commandId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",payload:{expectedRevision:4,nextStatus:"preparing",reason:"integration_prepare"}}')
jq -e '.result.revision == 5' <<<"$(workflow "$PREPARING")" >/dev/null

RESULT_DIR=$(mktemp -d); trap 'rm -rf "$RESULT_DIR"' EXIT
mkdir -p "$RESULT_DIR/word"
printf '<Types/>' > "$RESULT_DIR/[Content_Types].xml"
printf '<document/>' > "$RESULT_DIR/word/document.xml"
(cd "$RESULT_DIR" && zip -q result.docx '[Content_Types].xml' word/document.xml)
RESULT_SIZE=$(stat -c%s "$RESULT_DIR/result.docx")
PREPARE_RESULT=$(jq -nc --arg requestId "$REQUEST_ID" --argjson size "$RESULT_SIZE" '{action:"prepare_result_upload",requestId:$requestId,commandId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",payload:{originalName:"result.docx",declaredMime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",sizeBytes:$size}}')
RESULT_META=$(workflow "$PREPARE_RESULT"); RESULT_FILE_ID=$(jq -r .result.fileId <<<"$RESULT_META"); RESULT_PATH=$(jq -r .result.path <<<"$RESULT_META")
curl --fail-with-body --silent --show-error -X POST "$API_URL/storage/v1/object/studkab-private/$RESULT_PATH" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $EXECUTOR_TOKEN" -H 'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document' --data-binary @"$RESULT_DIR/result.docx" >/dev/null
COMPLETE_RESULT=$(jq -nc --arg requestId "$REQUEST_ID" --arg fileId "$RESULT_FILE_ID" '{action:"complete_result_upload",requestId:$requestId,commandId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",payload:{fileId:$fileId}}')
RESULT_CHECK=$(workflow "$COMPLETE_RESULT"); RESULT_SHA=$(sha256sum "$RESULT_DIR/result.docx" | cut -d' ' -f1)
jq -e '.result.state == "accepted"' <<<"$RESULT_CHECK" >/dev/null
CONTENT='{"topic":"Integration","chapters":[{"id":"intro","name":"Introduction"}],"structure":{"intro":{"text":"Complete integration document without unresolved markers."}}}'
CONTENT_SHA=$(printf '%s' "$CONTENT" | sha256sum | cut -d' ' -f1)
CREATE_DOCUMENT=$(jq -nc --arg requestId "$REQUEST_ID" --arg passportId "$PASSPORT_ID" --arg fileId "$RESULT_FILE_ID" --arg docxSha "$RESULT_SHA" --arg contentSha "$CONTENT_SHA" --argjson content "$CONTENT" '{action:"create_document_version",requestId:$requestId,commandId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",payload:{expectedRevision:5,passportId:$passportId,content:$content,contentSha256:$contentSha,docxFileId:$fileId,docxSha256:$docxSha,exporterVersion:"integration-1"}}')
DOCUMENT=$(workflow "$CREATE_DOCUMENT"); DOCUMENT_ID=$(jq -r .result.documentId <<<"$DOCUMENT")
jq -e '.result.revision == 6' <<<"$DOCUMENT" >/dev/null

BEFORE_DELIVERY=$(curl --silent --output /dev/null --write-out '%{http_code}' "$API_URL/storage/v1/object/authenticated/studkab-private/$RESULT_PATH" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN")
test "$BEFORE_DELIVERY" = 400 || test "$BEFORE_DELIVERY" = 403 || test "$BEFORE_DELIVERY" = 404
AUTO=$(jq -nc --arg requestId "$REQUEST_ID" --arg documentId "$DOCUMENT_ID" '{action:"run_automatic_checks",requestId:$requestId,commandId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",payload:{documentId:$documentId}}')
jq -e '.result.recorded == 3' <<<"$(workflow "$AUTO")" >/dev/null
MANUAL_ID=$(psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "select id from public.studkab_requirement_items where passport_id='$PASSPORT_ID' and code='DOC-01'")
MANUAL=$(jq -nc --arg requestId "$REQUEST_ID" --arg documentId "$DOCUMENT_ID" --arg requirementId "$MANUAL_ID" '{action:"record_checks",requestId:$requestId,commandId:"ffffffff-ffff-4fff-8fff-ffffffffffff",payload:{documentId:$documentId,checks:[{requirementId:$requirementId,status:"pass",evaluatorType:"human",evidence:{confirmedInUi:true},comment:"integration",checkerVersion:"integration-1"}]}}')
jq -e '.result.recorded == 1' <<<"$(workflow "$MANUAL")" >/dev/null
# Synthetic confirmation exercises the gate, not a claim of visual Word acceptance.
WORD_ID=$(psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "select id from public.studkab_requirement_items where passport_id='$PASSPORT_ID' and code='DOC-06'")
WORD_REVIEW=$(jq --arg id "$WORD_ID" '.commandId="14141414-1414-4414-8414-141414141414" | .payload.checks[0].requirementId=$id | .payload.checks[0].comment="Synthetic Word review for integration test"' <<<"$MANUAL")
jq -e '.result.recorded == 1' <<<"$(workflow "$WORD_REVIEW")" >/dev/null
APPROVE_DOCUMENT=$(jq -nc --arg requestId "$REQUEST_ID" --arg documentId "$DOCUMENT_ID" '{action:"approve_document",requestId:$requestId,commandId:"12121212-1212-4212-8212-121212121212",payload:{documentId:$documentId,expectedRevision:6}}')
jq -e '.result.revision == 7' <<<"$(workflow "$APPROVE_DOCUMENT")" >/dev/null
DELIVER=$(jq -nc --arg requestId "$REQUEST_ID" --arg documentId "$DOCUMENT_ID" '{action:"deliver_document",requestId:$requestId,commandId:"13131313-1313-4313-8313-131313131313",payload:{documentId:$documentId,expectedRevision:7}}')
jq -e '.result.revision == 8' <<<"$(workflow "$DELIVER")" >/dev/null
AFTER_DELIVERY=$(curl --fail-with-body --silent --show-error "$API_URL/storage/v1/object/authenticated/studkab-private/$RESULT_PATH" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN" | sha256sum | cut -d' ' -f1)
test "$AFTER_DELIVERY" = "$RESULT_SHA"

echo "PASS: full student/executor workflow, Auth, Edge Function, PostgREST, RLS and private Storage"
