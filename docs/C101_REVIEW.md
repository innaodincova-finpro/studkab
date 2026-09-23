# C101 independent review — answered clarification reassignment

Scope: `20260923144056_c101_answered_reassignment.sql`, existing clarification
ask/answer RPCs and administrative transfer. No production access or mutations.

## Result

No blocking defect remains in the reviewed C101 SQL after timestamp
canonicalization. This is a code/local test review, not deployment or full route
acceptance. Native lock schedules still require PostgreSQL CI.

## Corrected finding

Hashing `to_jsonb(clarification)` directly was session-timezone dependent because
it includes `timestamptz`. The same timestamp produced different SHA256 under UTC
and Europe/Moscow in an isolated reproduction. Both snapshot creation and evidence
validation now replace `created_at` and `answered_at` with epoch values before
hashing. The regression test verifies an unchanged historical answer in another
timezone and rejects actual mutation.

## Lock and authorization review

- Transfer takes advisory lock 713, then the request row lock. Both clarification
  ask and answer RPCs take the request row lock before touching clarification
  rows. Neither acquires a reverse advisory lock. A waiting transfer therefore
  checks the committed clarification state.
- A new unanswered question blocks transfer. A completed answer may transfer only
  when its author is the original owner, its question author is the configured
  executor, and answer/source/timestamps are valid.
- The transfer remains administrator-only and requires the existing explicit
  request/from/to allowlist, current recipient eligibility, and request/cloud CAS.
  C101 does not grant API roles access to the administrative operation.
- Historical answer UUIDs, contents, authors and timestamps remain unchanged;
  the immutable transfer audit contains the count and exact canonical hashes.
- Historical evidence is accepted only for the same request, exact from/to
  lineage, and exact snapshotted row. A foreign request, later original-author
  row, or changed row cannot satisfy that fallback.
- After transfer, the old owner cannot answer even an idempotent retry. The new
  owner cannot overwrite an existing answer and can answer a newly asked question.
- Previously approved passports become stale; a new review must still reference
  all relevant clarification answer IDs before approval.

## Executed checks

- C101 SQL tests: 8/8 passed independently, including timezone, malformed/history,
  preserved authorship, evidence mutation and existing C100 audit compatibility.
- Exact fixtures from `tests/answered-reassignment-concurrency.py` exercised in
  PGlite in sequential order: all four expected outcomes and snapshot/authorship
  assertions passed. This validates fixture/API compatibility, not concurrency.
- Python compilation and `git diff --check` passed.

## Native CI scenarios

The standalone script refuses to run outside CI with loopback PostgreSQL and
`PGDATABASE=safety_test`, creates its own disposable database, and requires an
observed PostgreSQL Lock wait in every schedule:

1. Ask before transfer: transfer rejects the unanswered question.
2. Transfer before ask: transfer preserves the old answer; the new question and
   subsequent new-owner answer remain separate.
3. Answer before transfer: transfer preserves the completed answer and its author.
4. Transfer before old-owner retry: retry is forbidden without changing history.

No AI/provider calls, existing application accounts or production rows are used.
