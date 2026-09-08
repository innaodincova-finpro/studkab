# Direct student request delivery

Phase 2 adds authenticated cabinet submissions, a durable private server inbox and Telegram notifications. Email recipient is configured as inna_odincova@mail.ru, but email sending and bot conversations remain unimplemented. No SMTP/domain claim is made.

## Provisioning

Apply request-delivery.sql once after telegram-setup.sql. All tables and RPCs are closed to anon/authenticated; the Edge Function validates the session against Auth and uses the verified email for executor-only inbox access. The executor account is inna_odincova@mail.ru. Never accept a recipient or student ID supplied by a browser.

Deploy studkab-requests with verify_jwt=false: browser requests authenticate through Auth; jobs authenticate with the separate configuration cron token. Schedule a per-minute pg_cron job invoking the function using pg_net and reading the key directly from studkab_request_config. Do not expose the key in logs or Git. Deploy the updated studkab-telegram handler after enabling direct intake.

## Behavior and limitations

Submission commits the request before Telegram dispatch. The same student/client request ID is idempotent, including concurrent retries. A changed payload with an existing ID returns a conflict; the student is told to contact the executor instead of silently changing an accepted request. Limit: 30 new requests per student per day. Inbox pagination is 100 rows; repeated import preserves existing executor notes/status/documents. The original immutable request remains on the server even if the local registry save fails. Registry changes continue using the existing cloud/local save system.

Telegram dispatcher leases five jobs for two minutes, retries failures with backoff up to eight attempts, and records errors. Telegram is at-least-once: if it accepts a message but acknowledgement/save fails, a repeated notification is possible, carrying the same request number. No duplicate request is created. Failed jobs remain in the database for diagnosis. Delivery to the user's screen is not proven by API acceptance.

No browser route is provided for reading another student's requests. A Telegram link contains only an opaque UUID; opening it requires the executor's authenticated account. The registry button imports incoming requests without overwriting existing work.

## Verification

npm test; SQL safety suite in disposable PostgreSQL 16; Chromium intake tests for acknowledgement, retries and repeat import. A live user trial of one request is still required to prove actual receipt. Do not send production test requests in a student's name.
