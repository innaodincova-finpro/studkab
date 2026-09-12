# Scheduled execution checkpoint — 2026-09-12
Existing pg_cron/pg_net and private cron_token verified without reading secret values.
Installed named job studkab-generation-v1, once per minute. The callback uses the
existing public project anon JWT plus private cron capability, both required by the
runner. Gateway verify_jwt remains true. Ordinary user JWT is rejected. The public
JWT is pinned because the runtime default anon key did not match the existing legacy
JWT; first probe returned 401, pinned-key probe 18823 returned HTTP200.

Live readiness: enabled=false, providerConfigured=false. This is the verified blocker:
STUDKAB_PROXY_TOKEN is absent and STUDKAB_GENERATION_ENABLED is not enabled.
No secret-management tool is exposed by the connected Supabase app. Do not ask for
secret values in chat or deploy a credential-extraction workaround.

The scheduler invokes work only with queued/running jobs and available budget OR
running jobs needing recovery. The SQL and parentheses in generation-schedule.sql
are authoritative. It does not increase the global cap or retry unknown jobs.
With an empty queue and zero budget there are no provider or callback requests.
A running job with exhausted reservation can still have its lease recovered when
the runner is configured. Disabled runner does not claim jobs.

Prepared deterministic subdivision of sections and preceding-part context from the
same immutable job. Maximum 100 parts, per-part output limit remains 2500 tokens.
At >180000 input characters preparation blocks the claim before dispatch; no context
is silently dropped. Automatic quality/word-count acceptance is not implied.
Preparation-blocked parts currently use state unknown; exact pre-dispatch code is
in the handler response, not a durable per-job diagnostic column. This remains a gap.

Local npm test: 107/107. Full real recovery/concurrency/FIN-UAT-01 outstanding.
Rollback only this scheduler: select cron.unschedule('studkab-generation-v1');
Keep job/result rows. No paid requests, no budget increase, no changes to other jobs.
