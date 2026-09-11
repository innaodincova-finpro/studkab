# PostgreSQL generation storage — verified checkpoint
Date: 2026-09-11. Requirements: R2, R3, R4, R9.
Project: dcpthwmuiodrjepifzsd. Applied migration: 20260911195103_studkab_generation_storage_v1.
Existing main base: 3d96836b5f7262d854f2a2676ffff1dc8df2764d.

## Actual changes
Four server-only tables and transactional functions were installed in the existing
Supabase database. Jobs hold immutable input/plan snapshots. Parts have fenced claims
and immutable completed results. Dispatch reserves worst-case cost globally BEFORE
a provider request. Expired dispatched requests become unknown, without automatic
re-dispatch. New input versions do not reset the shared reservation total.

The production budget starts at zero; no paid requests were made. A server operator
must set a previously authorized numerical cap and trusted price calculations before
real dispatch. The service_role handler cannot raise the cap.

## Actual checks
The schema and scenario test were first run in one Postgres transaction and rolled
back. The migration was then applied. After application the real service_role
completed start/claim/dispatch/settle in a rolled-back transaction and was denied
permission to increase the budget. No test jobs remain.

| Scenario | Actual result |
|---|---|
| Duplicate Start | Same job ID |
| Second claim while part claimed | No second claim |
| Expired un-dispatched claim | Reclaimed; old claim rejected |
| Completed result overwrite | IMMUTABLE_RESULT |
| Expired sent request | Job and attempt unknown; no new dispatch |
| Saved preceding part | Preserved |
| Late response | STALE_RESULT |
| Changed materials | Separate immutable version |
| Aggregate budget across versions | Second job blocked after original reservations |
| Diagnostic extra field | Discarded |
| authenticated table read / claim RPC | Permission denied |
| anon part read | Permission denied |
| service_role lifecycle | Passed |
| service_role budget increase | Permission denied |

Repeated claim tests above are sequential calls in a transaction, not a test of two
simultaneous network sessions. SKIP LOCKED and transactional locks are implemented;
real concurrent-session and process-crash acceptance remain outstanding.

## Security advisor
All four tables have RLS enabled and no client grants. Advisor INFO “RLS enabled,
no policy” is intentional for these server-only tables, not a missing client policy.
There are existing warnings for unrelated tochka SECURITY DEFINER functions and
disabled leaked-password protection; these were not altered.
References:
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Limitations and next integration
This is real production database storage, but no generation Edge handler, scheduler
or frontend Start/status connection is deployed yet. No claim of browser-independent
generation or completed acceptance 1/2 is made. Owner authorization must be checked
by the existing executor-authenticated Edge adapter, not accepted from browser input.
Amounts in part plans must be calculated by a trusted server adapter; no public
intake exists at this checkpoint. No automated/manual unknown retry endpoint exists.
No full coursework quality checks, deterministic financial engine or full Word added.

The old Node/SQLite prototype is excluded from this branch's final tree; it remains
in Git history only. This replaces its direction with the agreed production stack.

## Rollback
No existing tables, rows, Edge Functions, cron jobs or frontend files were changed.
Keep these inactive tables until integration is verified. If rollback is required,
first disable any subsequently added handlers and preserve/export generation rows;
only then revert generation functions/tables in reverse dependency order. Do not
drop populated tables as an automatic rollback.

## Reproduction
Scenario scripts require an otherwise empty generation queue and use BEGIN/ROLLBACK.
They are operator-run acceptance fixtures, not suitable for arbitrary production use.
The CLI download was unavailable in this environment. Migration version above was
created by Supabase apply_migration and read back from schema_migrations; the repository
file is an exact export of that applied SQL, not an invented migration version.
