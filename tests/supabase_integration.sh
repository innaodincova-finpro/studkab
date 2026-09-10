#!/usr/bin/env bash
set -euo pipefail

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

STUDENT_JSON=$(create_user student.workflow@example.test)
OTHER_JSON=$(create_user other.workflow@example.test)
STUDENT_ID=$(jq -r .id <<<"$STUDENT_JSON")
OTHER_ID=$(jq -r .id <<<"$OTHER_JSON")
STUDENT_TOKEN=$(token student.workflow@example.test)
OTHER_TOKEN=$(token other.workflow@example.test)
REQUEST_ID='11111111-1111-4111-8111-111111111111'

psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v student_id="$STUDENT_ID" -v request_id="$REQUEST_ID" <<'SQL'
insert into public.studkab_requests(id,student_id,client_id,payload)
values(:'request_id',:'student_id','integration-request','{"id":"integration-request","t":"Test","cn":"test"}');
update public.studkab_workflow_config set enabled=true where id=true;
select public.studkab_initialize_request(:'request_id',:'student_id');
SQL

COMMAND_ID='22222222-2222-4222-8222-222222222222'
BODY=$(jq -nc --arg requestId "$REQUEST_ID" --arg commandId "$COMMAND_ID" '{action:"prepare_upload",requestId:$requestId,commandId:$commandId,payload:{purpose:"assignment",originalName:"task.txt",declaredMime:"text/plain",sizeBytes:12}}')
RESPONSE=$(curl --fail-with-body --silent --show-error "$API_URL/functions/v1/studkab-workflow" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' --data "$BODY")
jq -e '.ok == true and .result.duplicate == false' <<<"$RESPONSE" >/dev/null
PATH_VALUE=$(jq -r .result.path <<<"$RESPONSE")

printf 'test content' | curl --fail-with-body --silent --show-error -X POST \
 "$API_URL/storage/v1/object/studkab-private/$PATH_VALUE" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: text/plain' --data-binary @- >/dev/null

CODE=$(curl --silent --output /dev/null --write-out '%{http_code}' \
 "$API_URL/storage/v1/object/authenticated/studkab-private/$PATH_VALUE" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $OTHER_TOKEN")
test "$CODE" = 400 || test "$CODE" = 403 || test "$CODE" = 404

DOWNLOADED=$(curl --fail-with-body --silent --show-error \
 "$API_URL/storage/v1/object/authenticated/studkab-private/$PATH_VALUE" \
 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STUDENT_TOKEN")
test "$DOWNLOADED" = 'test content'

echo "PASS: local Supabase Auth, Edge Function, PostgREST, RLS and private Storage"
