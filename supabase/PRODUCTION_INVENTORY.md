# Production Supabase inventory — Stage 4

Captured read-only on 2026-09-13. Project: `dcpthwmuiodrjepifzsd` (“Точка дня”), PostgreSQL 17.6.1, region `eu-west-1`.

## Migration boundary

Production currently records **24** migrations. The STUDKAB repository needs **14** migrations through `20260914105509_studkab_requirement_passports`: these create STUDKAB and the shared storage/access layer on which it depends. Their exact SQL and SHA-256 values are restored under `supabase/migrations/` and locked by `manifest.json`.

The remaining seven migrations are owned by the separate “Точка дня” assistant/reminder subsystem:

- 20260912141230 — tochka_assistant_owner_pilot
- 20260912152253 — tochka_assistant_dialog_context
- 20260912155717 — tochka_assistant_isolated_confirmed_sandbox
- 20260912162205 — tochka_assistant_test_calendar_revision
- 20260912211639 — tochka_telegram_reminder_storage
- 20260912211732 — tochka_telegram_reminder_schedule
- 20260913042423 — tochka_confirmed_record_actions

They are not copied into this repository. This is an explicit project-sharing boundary, not a missing STUDKAB migration. A fully isolated STUDKAB project remains Stage 10 work.

## STUDKAB production objects

- 16 `public.studkab_*` tables; RLS is enabled on all 16.
- 6 Edge Functions: `studkab-push` v13, `studkab-telegram` v14, `studkab-requests` v16, `studkab-cloud-check` v12, `studkab-generation` v17, `studkab-generation-api` v19.
- JWT verification: disabled for push/telegram/requests (custom webhook/cron authentication in code), enabled for cloud-check/generation/generation-api.
- 4 active cron jobs, all every minute: `studkab-deadline-push`, `studkab-request-telegram`, `studkab-generation-v1`, `studkab-maintenance`.
- Cron command bodies are not committed or printed here; only their production hashes were recorded during the audit.

## Advisor findings captured, not changed in production

Security:

- 16 STUDKAB tables have RLS enabled and no policies. Access is intentionally revoked from `anon`/`authenticated` and mediated through functions/service role, but this design must be verified in access tests.
- Leaked-password protection is disabled (project-wide; scheduled for Stage 10).
- Two SECURITY DEFINER warnings belong to “Точка дня”, not STUDKAB.

Performance:

- 7 STUDKAB foreign-key paths lack covering indexes.
- `studkab_gen_owner` is currently unused.

No advisor finding was “fixed” directly in production during this inventory.

## Safe replay rule

Never run these recovered historical files against the current production database. Supabase already records them as applied. They are for clean-environment replay and history synchronization only. Future schema changes must use a new timestamped migration through a pull request.
