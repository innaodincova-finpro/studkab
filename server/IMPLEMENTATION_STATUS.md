# Durable execution core — development checkpoint

Base: main 2ed9cf4ed4b780cf6920de71ee1b8391173b66c9.

Implemented server-only SQLite execution core and independent process loop (Node 24).
No frontend or production service is changed by this branch. This is NOT a completed
server integration, and NOT proof that the published application runs without its browser.

## Implemented

- Immutable input and part-plan snapshot with SHA-256 version identity.
- Idempotent Start for owner + request + version, transactional claim and fencing.
- Atomic saved part and task status, SQLite WAL and synchronous FULL.
- A 240-second lease: un-dispatched claims can resume; expired dispatched requests
  become unknown. Completed parts are never regenerated on recovery.
- Zero automatic retries after dispatch. Unknown requests stop the job. No manual
  retry endpoint is provided yet, so ambiguous payment cannot silently be repeated.
- Worst-case per-part integer cost reservation before dispatch; per-job budget cap.
  No currency/pricing assumptions and no paid default adapter. Deployment must derive
  maxCost from trusted provider pricing and enforce the EXISTING authorized aggregate
  budget across jobs and versions; the per-job cap alone is insufficient for that.
- Separate server loop, with no dependency on browser lifecycle.

## Local evidence

Command: node --test tests/server/durable-jobs.test.mjs
Result: 7 passed, 0 failed, on 2026-09-11, Node 24.19.0.

| Scenario | Observed |
| --- | --- |
| Double Start and concurrent database connections | One task ID and one provider call |
| Crash before dispatch | Expired claim reclaimed, old claim cannot dispatch |
| Lost provider response | Unknown status, five repeated Starts cause no extra calls |
| Edited material | Separate job/version, previous saved text unchanged |
| Per-job budget exhaustion | Second provider call blocked before dispatch |
| Actual child-process SIGKILL after dispatch | Saved part survives; ambiguous part stops |
| Late result from expired handler | Rejected, stored result unchanged |

Provider responses are controlled test doubles. The SIGKILL is a real process kill,
not an exception simulating it. This evidence covers the core, not acceptance 1 of
the deployed application. Browser closure and production restart are not yet tested.

## Remaining integration gates

1. Select an available authorized server runtime with persistent storage. The existing
   Cloudflare code-only deployment cannot run Node SQLite or add durable bindings.
   No new hosting service, billing plan or resource has been created.
2. Integrate the existing authenticated ownership model, immutable server input intake,
   executor allowlist, aggregate budget reservations and provider credential storage.
3. Add trusted provider adapter with bounded timeouts below the lease and no implicit
   SDK retries. Distinguish known provider rejection from unknown delivery. Preserve
   provider finish reason and token usage without logging secrets or source material.
4. Generate the chapter-part plan from versioned coursework requirements, validate
   content/word counts and coherence, then connect Start/status/resume to reestr.html.
5. Add explicit authorized reconciliation for unknown requests without losing attempt
   history. Budget must not reset when materials are edited or a task is replaced.
6. Full real-provider acceptance 1, full FIN-UAT-01 calculations/sources/Word acceptance 2.

Historical failure cause remains unknown. No real paid AI calls were made for these tests.
