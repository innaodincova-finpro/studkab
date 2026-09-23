# C100 independent review

Reviewed 2026-09-23. Scope: addressed administrative request reassignment, immutable attachment authorship, cloud restoration and existing passport/material controls. No production mutation was performed by this review.

Reviewed migration: `20260923132840_c100_request_reassignment.sql`.
SHA-256: `44f452bedc029d1add878d7e0ce59858f3a769f41d03f9388e1071ad7eab5bc6`.

## Conclusion

No remaining critical code defect was identified in the final targeted SQL/API/mapping review. Earlier findings were corrected: duplicate migration objects, an upload path without a material cycle after reassignment, missing reassignment-aware passport CAS, and the payload edit path after old passports become stale.

This conclusion permits integration subject to required CI; it does not establish production installation, successful reassignment, or completion of the student workflow.

## Confirmed protections

- Transfer is an invoker function restricted to postgres. Its separate allowlist starts empty, has RLS and no client/service-role grants. There is no ordinary UI or Edge transfer action. The administrator must supply an allowed request/from/to tuple; recipient membership, account status and exclusion of the executor account are checked.
- Transfer obtains advisory lock 713, then the request row, then both cabinet rows in user-id order. Current ownership and request revision are checked under the request lock. Both cloud revisions are compared under row locks. A rejection aborts the transaction; cloud append, ownership change, passport invalidation and immutable audit insertion are atomic.
- Existing jobs, result versions, normal results, clarifications, any material-cycle history, test grants and test deliveries prohibit transfer. The request UUID, number, client id and payload are preserved. Attachments, their authors and storage paths are not rewritten.
- Exact retry parameters return a duplicate result without a second cloud card. A different operation or binding conflicts. Retry does not replay old cloud snapshots or revert subsequent changes.
- SQL validates the reconstructed card against the request payload and attachment count. The helper uses an independent work id. Existing target works and unrelated root keys are retained; the source cabinet is not rewritten. The UI marker preserves intentionally blank submitted identity/format fields against profile autofill. The roundtrip test executes the actual load/profile/requestPayload functions.
- All previous non-stale passports become stale. Save and approve require the current expected revision after reassignment even without a material cycle. Old stale passports cannot be approved as drafts. Existing C098 manifest checks remain in force.
- Transferred requests report locked materials. Explicit material reopening is available; uploads without an open cycle are blocked. Replacement can reference the former author's attachment only through the exact request/from/to audit lineage, with current ownership, category and current supersedes checks. Payload changes remain locked by transfer history.
- Reassignment audit is immutable. Prepared C079 deletion removes the associated graph using its existing restricted deletion exception and records reassignment/permission counts in deletion audit. No replica-role or immutable-trigger bypass was added.
- New attachment list/download requests authorize against the current request owner, not the historical attachment author. The attachment table has no client grants; private Storage access is provided through the Edge service.

## Evidence and remaining gates

Reviewed `tests/request-reassignment-sql.test.mjs`, its fixture, `tests/request-reassignment-api.test.mjs`, and `tests/request-work-card.test.mjs`. The implementation author reported 6/6 PGlite SQL checks passed. The integration lead reported the general Node suite passed 430/430. These reported executions are distinct from this independent source review; this reviewer did not repeat the full suite.

The native two-connection harness was inspected and an obsolete fixture was found: it supplied an incomplete card and an id rejected by final SQL. The assigned author corrected that fixture to use the actual requestWorkCard helper and reported its exact initialization/transfer path passed in PGlite. Native PostgreSQL race success remains **pending**; PGlite and mocked API success do not prove concurrency. Required schedules cover both orders of source/target cloud saves, old-owner upload and old passport approval against transfer, and must observe an actual PostgreSQL lock wait. Existing request/advisory locking also serializes generation start; do not claim a dedicated transfer/start runtime test unless it is actually executed.

Full migration replay/CI and production acceptance remain separate gates. After authorized installation, verify the exact current request/cloud revisions, one restored card, unchanged original attachment hashes/authors, old-owner rejection for new API operations, new-owner download, the normal material cycle and the exact delivered-file hash.

## Explicit limits

Previously issued Storage signed URLs can remain valid for their existing 300-second TTL. A download already authorized before transfer can finish. C100 therefore guarantees current-owner authorization for new API requests after transfer, not retroactive revocation of already issued URLs or files already downloaded. This limitation was accepted without expanding scope.

The transfer history permits one reassignment per request. A reverse operation after commit is not implemented here; do not describe a blind inverse update or full cloud restore as a supported rollback. Any later reversal requires a separately constrained operation preserving audit and later changes.
