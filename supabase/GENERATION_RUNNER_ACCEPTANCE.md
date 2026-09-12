# Generation Edge handler checkpoint
Requirements R1–R4/R9. Six local Node tests passed on 2026-09-11.
Tests cover unauthorized access, absent configuration, unconfirmed dispatch,
successful save, incomplete result and unconfirmed save. Provider/database are test doubles.
Actual Supabase schema remains installed; this Edge handler is NOT deployed.

Deployment of studkab-generation was rejected by automatic approval review:
verify_jwt=false and transmission of task materials to the external Cloudflare Worker
were flagged as requiring explicit authorization. No indirect deployment or scheduler
activation was attempted after that rejection.

The intended implementation uses existing studkab_request_config.cron_token for
custom authentication, fixed existing proxy URL, server-only STUDKAB_PROXY_TOKEN,
90-second provider timeout and no retries. The token was not obtained or exposed.
Server intake must still validate input.system and trusted part plan/cost estimates.
The global budget remains zero. No paid calls were made.

Remaining: approved deployment, server-to-proxy credential configuration, scheduler,
executor-authenticated Start/status API, frontend integration, trusted cost estimates,
full real concurrency/recovery acceptance and FIN-UAT-01. Do not label this complete.

## 2026-09-12 — reviewable hardening, not deployment
Added a mandatory server Bearer authorization check before configuration access,
in addition to the existing cron token. The entrypoint accepts only the configured
service-role Bearer; ordinary user JWTs are insufficient. Gateway verify_jwt=true
is explicit in supabase/config.toml. STUDKAB_GENERATION_ENABLED must explicitly be
true before any claim; it defaults to off. No deployment or scheduler activation
was attempted after the recorded approval rejection.

Result size is checked in UTF-8 bytes to match PostgreSQL octet_length (100000),
including Cyrillic boundary tests. HTTP errors preserve only the provider detail
which the existing settlement RPC allowlists. Runner tests now run in npm test.
Actual local result: 90/90 Node tests, including 12 runner tests; git diff --check
passed. Provider and RPC are mocked. No claim of real JWT gateway, concurrent
Postgres sessions, full coursework, production installation or browser acceptance.
The original external-transfer approval blocker and zero budget remain in force.

## 2026-09-12 — authorized installation
The user explicitly approved task material transfer via the existing Cloudflare
proxy to DeepSeek, without raising the budget. Deployed PR35 commit 77e6c732 as
studkab-generation v1 with verify_jwt=true. Deployment hash:
764fdf8dac7695eaf669b3620898e5648f42f2fae71518524a51c84dd1961606.
GitHub run 34662873990 (Safety checks #98) completed successfully.
Live unauthenticated POST returned HTTP401. Database check returned budget limit=0,
reserved=0, and jobs=0. No provider request or scheduler activation performed.
No environment secret values were extracted or configured. The code requires both
STUDKAB_GENERATION_ENABLED=true and STUDKAB_PROXY_TOKEN before claiming any task;
actual environment readiness has not been verified with a privileged request.
The previous deployment-blocked statement is historical and superseded for this
JWT-protected version only. Start/status, scheduling, credentials, financial cap,
real concurrency/recovery and FIN-UAT-01 remain outstanding.
