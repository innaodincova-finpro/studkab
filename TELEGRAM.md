# Telegram: recipient setup (phase 1)

## ROUTE-02 — согласованный маршрут, 01.10.2026

Статус: требования согласованы владельцем; новая реализация и приёмка не выполнены.
Действующий план изменений: [ROUTE-02](docs/APPROVED_REQUEST_ROUTE_2026-10-01.md).
Этот раздел заменяет прежнюю последовательность INTAKE-01 только в части приёма:
сохранение выбранных оригиналов и регистрация → изучение → существенные уточнения.
Анализ и подтверждение раскладки по полям не блокируют отправку.
Кандидаты ИИ не считаются проверенными требованиями.
R2–R9/R13/R14, версии, бюджет, изоляция и ограничения выдачи сохраняются.

Вопрос ИИ адресован студенту, но сначала показан администратору с обоснованием.
Публикация только после её подтверждения. Внутренняя переписка с помощником —
текстом или голосом по выбору; возврат с замечанием вызывает повторное изучение.
Запуск подготовки — «Начать подготовку» после обзора требований/стоимости.
Выдача — «Передать студенту» после обязательных проверок точного файла;
администратор принимает решение о выпуске, не выполняет предметную проверку за ИИ.
Бот уведомляет администратора, поддерживает согласование вопросов и внутреннее
общение. Push — штатный канал обеих ролей с настройкой и проверкой фактического
получения. Все действия связаны с одной заявкой. Этапы отображаются с текстом
и зелёной отметкой только по подтверждённому прохождению.

Нижележащие описания прежнего порядка/ручных действий являются исторической
реализацией в противоречащей этому разделу части. Нельзя выдавать новый маршрут
за уже установленный или удалять историю прежних проверок.


Bot: `@Studkab_Requests_bot`. Secret: `STUDKAB_TELEGRAM_BOT_TOKEN` in Edge Function Secrets.

This phase verifies bot identity, installs an authenticated webhook and binds one executor chat using an expiring, unguessable private start link. It does **not** submit requests or relay conversations yet. The bot explicitly tells users this.

## Provisioning

Apply `telegram-setup.sql`. Generate two independent 256-bit random values outside the repository. Store only SHA-256 hashes in the single setup row: `setup_hash` hashes the hex bootstrap value, `owner_hash` hashes `bind_` followed by the base64url recipient value (without padding). Set `expires_at` to 48 hours from provisioning. Do not overwrite an existing row or recipient.

Deploy `supabase/functions/studkab-telegram/index.ts` with `verify_jwt=false`: the body authenticates `/setup` using the single-use bootstrap capability and `/webhook` using Telegram's secret header. Call POST `/setup` with the bootstrap value in the Bearer header. It refuses a token for another bot or a foreign existing webhook; after success setup is disabled.

Deliver the `https://t.me/Studkab_Requests_bot?start=bind_...` link only to the executor in the private project conversation. The first valid private-chat activation binds the recipient atomically. Reuse cannot change the recipient. No chat IDs, tokens or activation links belong in GitHub, HTML, logs, or public reports.

## Verification

`node --test tests/telegram.test.mjs` checks forged webhooks, wrong bot, setup replay, expired/invalid/group activation and recipient replacement. Read-only SQL may check `installed`, `owner_chat_id is not null`, and `bound_at`; do not print the chat ID. Existing cabinet, registry, push functions and other shared-project applications are unchanged.

Next phase: authenticated student request storage, executor inbox authorization, durable Telegram delivery/retries, student linkage and private replies. Keep existing request sharing until that phase passes acceptance.

## ROUTE-02: место в реализации

Текущая привязка через /start остаётся. Существующая отправка уведомления о новой
заявке реализована в studkab-requests/index.ts; ответы студента исполнителю —
в studkab-push/index.ts. Одобрение вопросов, текст/voice и callback управления
добавляются по ROUTE-02, а не объявляются работающими. Два интерфейса используют
одну запись решения; студенту доступен только одобренный вопрос, не внутренний чат.

