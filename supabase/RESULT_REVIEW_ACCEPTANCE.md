# C019 — versioned result delivery

Status: production database and requests v9 installed; PR40 merged98cca80f. Frontend publication verification follows below. No student data or paid AI calls changed.

## What is enforced

- Immutable JSON snapshot and DOCX bytes (up to 3 MiB), SHA-256 computed by PostgreSQL.
- Recipient comes from the original server request. Executor identity is checked by
  the authenticated Edge handler, never by browser-supplied role/recipient metadata.
- Separate evidence for C01–C13/S01–S03; every item must pass and contain an explanation.
- Review is immutable and bound to a version. Creating a newer server version blocks
  new delivery based on the old approval. A retry of an already delivered operation
  returns its historical receipt without adding a delivery.
- A table trigger blocks legacy or direct insert paths without the same valid review.
- Students receive the captured bytes and check SHA-256 before download. Legacy
  results remain readable via the original serializer; they are not retroactively
  labelled as exact-file reviewed results.

The review is a human attestation, not an automated financial/content examiner.
The existing FIN-UAT incomplete-document gate remains. This does not certify the
separately assembled control Word, Microsoft Word opening, full R5/R7 or A1/A2.

## Verification performed

131 Node tests passed. Optional isolated PostgreSQL/PGlite and DOM/jsdom runners
passed. They exercise the actual migration and actual results-ui.js respectively.
Native PostgreSQL concurrent tests and browser scenarios are added to existing CI,
CI run34686333912 passed Node and native PostgreSQL. Browser checks:38 passed,1 failed
because page CSS overrode the download button hidden attribute on corrupt-file rejection.
The button now has explicit display:none until verified; repeat CI run34686491225 at4c48c626 passed all checks (Node, native SQL and browser).
User explicitly authorized code publication; GitHub connector published PR40 after
command-line Git could not authenticate.
Managed browser refused localhost; downloading a local browser timed out.

To reproduce optional checks, install @electric-sql/pglite and jsdom in a disposable
npm directory and set STUDKAB_TEST_MODULE_ROOT to that directory. Run
`node tests/manual/result-review-pglite.mjs` and `node tests/manual/result-ui-dom.mjs`.
Normal CI runs `npm test`, `python3 tests/sql_safety.py` against an empty disposable
PostgreSQL DB, then `npm run test:browser`. Never run sql_safety.py on production.

## Deployment and remaining gates

1. CI passed at4c48c626. Production migration was rejected by automatic approval:
   code publication consent was not accepted as consent for production DB mutation.
   Migration, Edge replacement and frontend publication require explicit production
   update authorization. No workaround or production mutation was performed.
2. Installed studkab-requests v8 matches main98d795b in all four files; preserve verify_jwt=false and its custom authentication.
3. Apply migration 20260912091822_studkab_versioned_delivery.sql and verify access
   advisors plus reversible, synthetic SQL checks. Preserve historical rows.
4. Deploy request handler preserving its existing auth and scheduled notification
   configuration, then publish frontend. Old clients must receive review_required,
   not silently bypass the gate.
5. Perform real browser acceptance on a separate synthetic request: review, stale
   version rejection, lost-response retry, exact-byte download and other-user denial.
   Do not send real student documents or notifications as a test.

Rollback: keep the additive tables/history. Revert the new UI if necessary but retain
server fail-closed legacy delivery and the result-table review trigger. Do not restore
the old unreviewed delivery RPC. Historical result retrieval stays available.

## Verified installation boundary

2026-09-12: production remains unchanged. The proposed additive migration creates
version/review history and guards existing delivery. It preserves historical results
but blocks old unreviewed delivery, so coordinated backend/frontend installation is
required. Authorize migration, studkab-requests replacement and PR40 merge together.
Code tree tested: f5215599e6d52ac0b0cba884254f4e875956c577; GitHub head4c48c626.
No paid calls. Full authenticated application acceptance and A1/A2 remain open.

## Authorized production installation — 2026-09-12

Explicit user approval received for database, Edge and frontend installation.
Migration applied successfully. Transactional synthetic production assertions passed:
exact-byte hash, missing review rejected, wrong recipient rejected, duplicate receipt,
stale version rejected, anon/authenticated access denied and service_role allowed.
All synthetic records rolled back: original2 requests and1 result remain. No HTTP
notifications or provider calls were made by the SQL check.
studkab-requests v9 ACTIVE, existing custom auth/verify_jwt=false preserved.
Unauthenticated live POST returned401. Deployment hash:
d142b47875be9ca4c6201a76e8516f53e6ac20c59382e615828f074152f103b8.
Final PR head4812ca2 passed CI run34686638421; merged as98cca80f.
Security advisors show no new warning-level finding; two new server-only tables
have expected RLS/no-policy INFO, with direct client access revoked. Existing
project warnings (tochka functions and password protection) are unchanged.
Real authenticated end-to-end acceptance, A1 and full FIN-UAT-01 remain open.
