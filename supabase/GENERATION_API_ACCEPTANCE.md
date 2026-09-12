# Generation API and registry integration checkpoint — 2026-09-12
R2/R3/R4/R9. Extends PR35 and depends on PR34 storage.

Implemented: separate JWT-protected studkab-generation-api, actual Auth user lookup,
executor authorization from server configuration, owner from session only, bounded
immutable input/plan, server-only per-part reservation, zero-budget start refusal,
owner-filtered status and saved text without claims, prompts or configuration.
Registry has a collapsed availability/start/status section. Old document text is never
replaced by received results. Account changes invalidate an in-flight API response.
New cache version v32-generation-api and cloud module v14.

Local npm test: 100/100 passed (12 runner and 10 API tests included). New browser
scenario checks a disabled zero-budget start, saved result display, old-version notice
and preservation of the edited document. Initial browser run could not launch because
the browser executable was absent; this is not a passed UI acceptance.

Configuration gates: STUDKAB_GENERATION_ENABLED=true and a positive, operator-verified
STUDKAB_GENERATION_PART_RESERVE_MICROUSD covering the worst-case provider charge for
180000 input characters and 2500 output tokens. This is a conservative reservation,
not client-provided pricing. It must not be set without a verified cost bound.
The existing global database budget remains authoritative at dispatch time. A start
precheck does not reserve funds and never replaces that transactional check.

Known remaining work: scheduler credential installation and provider secret configuration,
chapter subdivision and context between parts, quality checks, financial calculations,
source verification, controlled result application/Word and real A1/FIN-UAT-01.
The API queues the supplied sections; it does not yet split large chapters. Do not enable
paid operation or describe this as reliable complete-document generation.
No student materials or credentials were used in tests. Vault metadata check showed
no stored entries; no credential values were read. No automated schedule was installed.
