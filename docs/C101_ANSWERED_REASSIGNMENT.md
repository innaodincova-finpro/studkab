# C101: retain answered clarifications during reassignment

C100 rejects every request with clarification history. C101 permits the existing
administrative reassignment only when every clarification has a complete answer
from the exact former request owner, a source, a valid answer timestamp, and a
question asked by the configured executor. Pending, malformed or foreign entries
still reject the entire transaction. No production identifiers or grants are
included in the migration.

Clarification rows, authors, timestamps and passport `answer_ids` are retained.
The immutable reassignment audit records the count and a per-row SHA-256 snapshot.
Timestamp fields are canonicalized to epoch values so verification is independent
of the database session timezone. Existing C100 audit rows receive zero/empty
snapshot defaults; their historical fields remain unchanged.

Material evidence may reference an old-owner answer only when its request,
former/current owner pair and complete canonical row digest match that audit.
Later or modified answers cannot inherit this permission. Existing passports
become stale as before. A fresh passport still needs explicit review of every
clarification and the existing expected-revision checks before approval.
Neither former nor new owners can overwrite the retained answered row through
the answer RPC; new questions follow the existing workflow.

The transfer retains C100's administrator-only allowlist, role checks, request and
cloud CAS, no-output/no-cycle restrictions and atomic cloud-card append. Ask and
answer RPCs acquire the request row lock before modifying clarifications; transfer
acquires the same lock before checking and snapshotting them. Thus a pending
question cannot be hidden by a pre-lock check.

Validation commands:

- `node --test tests/answered-reassignment-sql.test.mjs`
- `python3 tests/answered-reassignment-concurrency.py` with an isolated PostgreSQL
  test database configured as required by that harness.

PGlite tests check exact preservation, immutable audit, timezone independence,
re-review, rejected pending/foreign/damaged answers, denied old-owner writes and
snapshot-bound material evidence. Native PostgreSQL schedules are a separate
check; sequential/mock tests do not prove concurrent behavior.

Rollback: disable further administrative transfers if necessary and preserve
existing audit snapshots and answer rows. Do not relabel authors, delete answers,
or rewrite cloud state to an older copy. Previously transferred requests require
an addressed, revision-checked recovery plan if later work has occurred. Deployment
and a live user route are separate from code and local test completion.
