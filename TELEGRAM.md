# Telegram: recipient setup (phase 1)

Bot: `@Studkab_Requests_bot`. Secret: `STUDKAB_TELEGRAM_BOT_TOKEN` in Edge Function Secrets.

This phase verifies bot identity, installs an authenticated webhook and binds one executor chat using an expiring, unguessable private start link. It does **not** submit requests or relay conversations yet. The bot explicitly tells users this.

## Provisioning

Apply `telegram-setup.sql`. Generate two independent 256-bit random values outside the repository. Store only SHA-256 hashes in the single setup row: `setup_hash` hashes the hex bootstrap value, `owner_hash` hashes `bind_` followed by the base64url recipient value (without padding). Set `expires_at` to 48 hours from provisioning. Do not overwrite an existing row or recipient.

Deploy `supabase/functions/studkab-telegram/index.ts` with `verify_jwt=false`: the body authenticates `/setup` using the single-use bootstrap capability and `/webhook` using Telegram's secret header. Call POST `/setup` with the bootstrap value in the Bearer header. It refuses a token for another bot or a foreign existing webhook; after success setup is disabled.

Deliver the `https://t.me/Studkab_Requests_bot?start=bind_...` link only to the executor in the private project conversation. The first valid private-chat activation binds the recipient atomically. Reuse cannot change the recipient. No chat IDs, tokens or activation links belong in GitHub, HTML, logs, or public reports.

## Verification

`node --test tests/telegram.test.mjs` checks forged webhooks, wrong bot, setup replay, expired/invalid/group activation and recipient replacement. Read-only SQL may check `installed`, `owner_chat_id is not null`, and `bound_at`; do not print the chat ID. Existing cabinet, registry, push functions and other shared-project applications are unchanged.

Next phase: authenticated student request storage, executor inbox authorization, durable Telegram delivery/retries, student linkage and private replies. Keep existing request sharing until that phase passes acceptance.
