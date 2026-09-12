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

Code 87b32fcf installed: studkab-generation v4 and studkab-generation-api v2,
verify_jwt=true on both. Runner hash 76e9ac642fc9a04e9cee7a81e1add023180b6ab46a89ecc3b6f9f78d506acc39;
API hash 162090d44777f06007868cca58be9d36456f7814f7613c5e5db613007b89c141.
Scheduler had 3 successful empty-queue ticks at verification. This is proof of the
schedule itself, not proof of running a model or surviving a server interruption.

Final code checkpoint 1ef690f2: GitHub Safety checks #105, run34673870947, SUCCESS
(Node, SQL and browser suite). API v3 additionally refuses intake when proxy secret
is absent. Negative live probe18845 with public JWT but no private cron token: HTTP401.
Final database check: budget0, reserved0, jobs0, attempts0; 9 successful cron ticks.
Remaining operator setup is documented, not bypassed: add STUDKAB_PROXY_TOKEN in
Supabase Edge Function Secrets using the existing proxy password, and set
STUDKAB_GENERATION_ENABLED=true only with all spend gates retained. Server part
reservation and authorized numerical budget must be verified before paid dispatch.
No secrets should be pasted in chat. Current main remains unchanged and PR35 draft.

## Authorized test budget and secret checkpoint — 2026-09-12
User authorized a total USD 1 test cap after the explicit cost proposal.
Protected live probe18909 returned HTTP200: enabled=false, providerConfigured=true.
This proves secret presence only, not provider authentication or model availability.
Conditional budget update (empty jobs, previous cap/reserved zero) returned
limit_microusd=1000000, reserved_microusd=0. This is a cumulative cap, not a top-up.
Worker source still allowlists deepseek-chat/deepseek-reasoner; current official
https://api-docs.deepseek.com/quick_start/pricing/ lists deepseek-flash and deepseek-v4-pro.
Live Worker model compatibility remains unverified. No Cloudflare management tool
is exposed. Do not claim a successful paid test or change to a new model silently.
Runner enable and trusted per-part reserve remain required before dispatch.

## First live scheduled Flash smoke test — 2026-09-12 06:01 UTC
Runner commit1fdc0e93 deployed v6, verify_jwt=true, hash3e81fee96235ea4ae5eb3fdb2b4d55fb0f0c096f8a424b3d28c14932966936c4.
User configured enable/reserve secrets; protected probe19067 returned enabled=true,
providerConfigured=true. Before test budget1000000/reserved0/jobs0/attempts0.
Created synthetic executor-owned job9e75feb7-d00f-47b8-9656-5cd23228787e using
service-only RPC, request smoke-flash-20260912-01; no student data in prompt.
No manual runner POST was used: existing minute scheduler performed dispatch.
Observed job complete, part done, stored result: Проверка сохранения завершена.
Provider request2d51685b-7a51-49d9-b2c2-0aba02dd0f13, finish_reason stop,
prompt_tokens47/completion_tokens10; reserved250000 microUSD, not actual invoice.
Confirms live proxy authentication/model response/scheduled persistence for one part.
Does NOT establish authenticated browser Start/status, multi-part recovery, A1 or FIN-UAT01.
No automatic regeneration or reset of test reservation. Keep test evidence rows.

## Live multipart context and duplicate Start check — 2026-09-12
Synthetic job4305014f-c6b1-4a62-ad78-21bfa1e6be61, request multipart-flash-20260912-01.
Two short parts, each250000 microUSD reservation, within existing USD1 cap.
Second service-only Start with identical owner/request/snapshot returned identical job UUID.
Existing minute scheduler processed both parts; no manual runner invocation.
Part0 done: Контрольное слово — БЕРЁЗА-731. (52 input/14 output tokens).
Part1 done: БЕРЁЗА-731. Вторая часть сохранена. (131 input/15 output tokens).
The second instruction did not include the marker; it was supplied through persisted
preceding-part context. Both finish_reason stop; job complete. Not an academic quality test.
CI code1fdc0e93: Safety checks109/run34676316920/job103506698538 success, including
Node, SQL safety and full browser suite. Existing cloud UI test uses mocked API and
checks result display and preservation of edited text; this is not live user acceptance.
Local browser rerun could not launch because Chromium executable is absent.
No main merge/publication. Real authenticated browser intake/readback, interruption,
concurrent runners, unknown outcome recovery and FIN-UAT01 remain unaccepted.
