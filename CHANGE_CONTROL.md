# Контроль изменений
## Обязательная запись до изменения направления
- Идентификатор требования TASK.md.
- Наблюдаемый факт и источник доказательства; гипотезы обозначаются отдельно.
- Рассмотренные варианты и причина выбора.
- Изменяемые компоненты, зависимости PR, влияние на данные и доступ.
- Влияние на разрешённый бюджет.
- Проверка результата и способ отката.
- Если меняются согласованные границы — основание полномочий или необходимое разрешение.

## Проверка перед объединением
- [ ] Требование и критерий приёмки указаны.
- [ ] Проверена актуальная main и совместимость зависимых PR.
- [ ] Решение работает в действующей архитектуре и подключено к нужному сценарию.
- [ ] Для неполного этапа явно названы границы; он не выдаётся за законченное исправление.
- [ ] Проверены данные, права доступа и бюджет в затронутой области.
- [ ] Указаны команды/протоколы, фактические результаты и точный commit.
- [ ] TRACEABILITY.md обновлён без неподтверждённых отметок.
- [ ] Есть откат, ограничения и необходимые проверки после публикации.
Документ не заменяет технические CI-проверки и не является автоматической защитой ветки.

## C-001 — фиксация управления работой, 2026-09-11
Основание: прямое поручение пользователя закрепить четыре обязательных правила.
Изменение: AGENTS.md, TASK.md, TRACEABILITY.md, CHANGE_CONTROL.md и шаблон PR.
Архитектура, данные, runtime и бюджет не изменяются.
Проверка: соответствие согласованному заданию, наличие всех требований и обеих приёмок,
честные статусы; чтение файлов из сохранённого commit.
Откат: отмена документального commit без изменения данных приложения.

## D-001 — выявленное отклонение PR34
Факт: прототип реализован на Node/SQLite при рабочей Supabase/Cloudflare-системе.
Семь локальных тестов полезны как ограниченное доказательство поведения прототипа,
но не подтверждают исправление приложения.
Решение: не публиковать этот прототип как производственную серверную обработку.
Дальнейшая работа — интеграция с действующими Postgres/Edge и реестром.
Не создавать новый оплачиваемый хостинг для оправдания уже написанного прототипа.

## C-002 — серверное хранение в существующей Supabase
R2/R3/R4/R9. Основание: рабочая база не содержит хранения серверной генерации; пользователь поручил реализовать этот шаг. Выбраны PostgreSQL-транзакции и существующая Supabase вместо отдельного Node/SQLite-хостинга. Только новые studkab_gen_* объекты, service_role-only, без изменения текущих записей и служб. Числовой бюджет не подтверждён — установлен ноль, платные вызовы не выполняются. SQL-проверки выполнены с ROLLBACK, затем применена миграция 20260911195103; проверены права service_role и запрет повышения лимита. Фактические результаты и ограничения: supabase/GENERATION_STORAGE_ACCEPTANCE.md. PR34 заменяет прототип; остальные PR не объединяются. Откат без автоматического удаления накопленных данных описан в протоколе.

## C-004 — обработчик Supabase
R1–R4/R9. Используются установленная PostgreSQL-схема и существующий Cloudflare-посредник. Авторизация предполагается серверным cron_token, секрет посредника — только переменная окружения. 6 локальных тестов прошли; автоматическая проверка отклонила публикацию с отключённой JWT-проверкой и отправкой материалов внешнему Worker. Развёртывание и расписание не выполнены; новые платные вызовы отсутствуют. Откат опубликованной функции не нужен, поскольку она не установлена.

## C-005 — безопасная подготовка обработчика после отказа публикации
R1/R2/R4/R9, 2026-09-12. Найден протокол отказа автоматической проверки C-004.
Публикация не повторяется. Подготавливается отдельный зависимый PR: обязательный
серверный Bearer плюс cron_token, verify_jwt=true, закрытый по умолчанию выключатель
отправки, проверка UTF-8 размера результата и включение тестов обработчика в npm test.
Альтернатива с verify_jwt=false отклонена. Данные, бюджет, расписание и рабочие
функции не изменяются. Проверки выполняются без внешнего провайдера. Откат —
отмена этого PR. Внешняя передача и реальное включение остаются за границей этапа.

## C-006 — разрешённая установка обработчика, 2026-09-12
Пользователь явно разрешил передачу материалов через существующий Cloudflare
посредник в DeepSeek при сохранённом бюджете. Предыдущий отказ C-004 сохранён
как история; отключение JWT не выполнялось. Установлен studkab-generation v1,
verify_jwt=true, код PR35 77e6c732. GitHub Safety checks #98 завершены success.
Живой POST без авторизации: HTTP401. Бюджет базы 0/0, заданий 0.
Расписание не установлено, frontend не переключён, платные запросы не выполнялись.
STUDKAB_GENERATION_ENABLED и STUDKAB_PROXY_TOKEN не задавались в этом этапе;
по коду обработчик не берёт задания без обеих настроек. Их фактические значения
не извлекались. Откат: выключить обработчик/расписание перед дальнейшими изменениями,
сохранить накопленные записи. Эта установка не закрывает R2 и приёмку A1.

## C-007 — серверный запуск и чтение статуса
R2/R3/R4/R9, 2026-09-12. Добавляется отдельная studkab-generation-api с проверкой
реального пользователя через Auth и исполнителя через серверную конфигурацию.
Владелец задания берётся только из проверенной сессии. План проходит ограничения,
резерв стоимости задаётся только сервером, общий лимит не изменяется. При отсутствии
настроек и нулевом бюджете Start блокируется без создания платного запроса.
В реестре добавляется свёрнутый блок с запуском и обновлением статуса, без подмены
текущей генерации. Результат читается отдельно: автоматической перезаписи текста нет.
Проверки: чужой пользователь, подмена владельца/цены, нулевой бюджет, повторный
Start, безопасные статусы. Публикация клиента только после регрессионных проверок;
полная интеграция/приёмка качества этим этапом не объявляются завершёнными.

## C-008 — расписание с JWT и диагностика готовности
R2/R4/R9, 2026-09-12. Нет безопасно установленного service-role ключа в Vault.
Он не извлекается и не копируется. Для расписания выбран публичный legacy anon JWT
этого же проекта плюс существующий секрет cron_token, получаемый SQL внутри базы.
Проверка JWT шлюза сохраняется; пользовательский JWT и публичный ключ без cron_token
не дают доступ к заданиям. Прежний service-role маршрут сохраняется. Это расширение
машинной авторизации, а не снятие проверки JWT. Ответ диагностики содержит только
булевы признаки настройки, без секретов и пользовательских материалов.
Расписание вызывает ровно одну часть за проход; нулевой бюджет и выключатель
сохраняются. Данные пользователей не меняются. При отмене удалить только именованное
расписание studkab-generation-v1, сохранив задания. Проверки — JWT/cron, отсутствие
вызовов провайдера при отключении, живой запуск расписания с нулевым бюджетом.

## C-009 — ограниченные части и контекст версии
R2/R3/R4. Крупный раздел раскладывается в устойчивый план частей с ориентиром
не более 4500 знаков на часть (это ограничение выполнения, не приёмка объёма).
Предыдущие сохранённые части читаются только из того же job; контекст не обрезается.
При превышении лимита блокируется текущий claim до резервирования и вызова провайдера.
Все записи остаются в существующих таблицах, схемы/права не меняются. 107 Node-тестов
пройдены. Реальная платная генерация и A1/FIN-UAT-01 не заявляются. Откат: прежние
версии функций при выключенном расписании, сохранённые результаты не удалять.

## C-010 — current DeepSeek names, 2026-09-12
R1/R2/R4/R9. Uploaded live worker equals repository source after newline normalization.
Add explicit deepseek-flash and deepseek-v4-pro support; legacy names remain unchanged,
no silent remapping or change of default. For explicit Flash requests disable thinking
per official https://api-docs.deepseek.com/guides/thinking_mode/ to retain bounded text mode.
Other providers, auth, limits and secrets unchanged. USD1 cumulative test cap exists;
this change does not enable the runner or create paid requests. Validate payload routing,
unknown-model rejection and existing worker tests. Rollback: previous worker version.
Manual Cloudflare deployment required because connector has no Worker deployment tool.

## C-011 — bounded Flash test runner
R2/R4: user reports Worker deployed. Pin runner to deepseek-flash, retain disabled
by default and JWT/cron guards. Require per-part reservation >=250000 microUSD before
dispatch, including direct database starts. Max180000 UTF16 units <=540000 UTF8 bytes;
byte-level token upper bound plus framing and 2500 output at peak Flash rates
($0.30/M input, $1.20/M output) fits USD0.25 conservative reservation.
Official pricing checked 2026-09-12. No automatic replenishment: global cap USD1.
Rollback previous runner while disabled. Live paid test remains pending enable flag.

## C-012 — align intake availability with runner reserve
R2/R4. Review found capabilities reports available for any positive remaining balance,
even below one part, and accepts a reserve the Flash runner refuses (<250000).
Align API minimum reserve and availability with runner. Status reading stays available.
Verify exact boundary, insufficient balance and invalid configuration before mutation.
No budget increase, no student-data changes; rollback previous API.
## C-003 — обязательный формат завершения этапа
Основание: прямое поручение пользователя закрепить итог «Сделано / Следующий этап /
Осталось / Ваше участие». Изменены AGENTS.md и шаблон PR. Это правило общения и
контроля исполнения, не изменение архитектуры, данных или бюджета.
Проверка: наличие четырёх пунктов и чтение сохранённых файлов из commit.
Откат: отмена документального изменения. При объединении PR34 сохранить также его C-002.

## C-013 — integrate current main without losing controls
R9. Integration branch lacked main's mandatory reporting instructions and PR checklist.
Merge main a34efc6 into feature branch; preserve both independent change-control entries.
No production main update, deployment, data mutation or budget change.
Run combined Node suite and CI before publishing the experimental interface.

## C-014 — recover lost browser job link
R2/R3/R9. Browser can close after server Start before saving returned job id.
Add executor-only request history (metadata only, max20 newest) and explicit selection
in client when no job link exists. Recovered job has unknown basis, always warns old
version; never overwrites document or starts generation. Test owner filter, metadata
minimization, browser selection and preserved document. No new paid calls.

## C-015 — smaller parts and precise failure reason
R1/R2/R4. Live FIN-UAT01 job5230bfde first part hit length at2500 output tokens.
Reduce new plan chunk target4500 to2000 characters without changing overall requested
section volume or raising provider output/budget limits. Original immutable plans remain.
Add status-only sanitized attempt diagnostics after owner check; distinguish OUTPUT_LIMIT
from genuinely unknown result. No retry, no schema/data change. Existing trial publication
authorized by user. Test size boundaries, known/unknown failures, secret stripping and UI.
Rollback previous API/frontend; keep failed job and budget reservation. This mitigates
length risk, does not prove model compliance or completed academic document.

## C-016 — read-only assembly and word counts
R3/R5/R8/R9. The one-part real test completed but returned969 chars for target1929;
completion is not academic completeness. Existing cloud UI lists isolated parts.
Add deterministic read-only grouping for one status response, ordinal validation,
visible missing-part markers, word counts and repeated-paragraph notes. Never join
other jobs/current document, write review approval or claim full chapter coverage.
No provider calls, budget/schema/auth changes. Validate gaps, shuffled order, duplicates,
HTML text safety, original text preservation and browser narrow-screen rendering.
Rollback frontend module/HTML/cache version; persisted results remain unchanged.

## C-017 — incomplete cloud DOCX and FIN-UAT volume gate
R3/R5/R8/R9. Original FIN-UAT01 v1 archive found and16 manifest hashes verified.
Requirements/examiner demand per-criterion evidence; a single checkbox is insufficient.
Add labelled FIN-UAT v1 profile with section word boundaries and missing-section notes;
FIN-UAT delivery remains blocked until independent criteria are implemented/verified.
Do not generalize this test profile to unrelated requests. Cloud DOCX exports a single
status response only, with job/version and incomplete label, no local text mixing.
Fix Markdown subsection headings and table typography in existing DOCX serializer.
No generation, budget, schema or auth change. Node, browser and rendered DOCX checks;
rollback frontend files, keep all persisted input/results. Server-side delivery gate
remains a separate unmet R8 requirement; this frontend guard does not replace it.

Publication review rejected uploading complete private Library source documents.
Safer scope: original requirements/acceptance texts remain outside the repository.
Published code contains only test profile bounds and synthetic test labels, no copied
source text. Profile detection is by label, not proof that requirements are unchanged;
UI explicitly requires separate source comparison and never grants acceptance.

## C-018 — deterministic extended financial analysis
R6/R9. Add a pure calculator for the explicitly labelled FIN-UAT profile, parsing
required monetary rows from existing materials. Validate balance, income, cash and
opening/closing movements before calculating20 metric rows with formulas, scenarios,
profit bridge and dynamics. Inputs are not inferred from generated text or examiner.
Original Library sources/reference values stay local; repository contains generic code
and independent synthetic fixtures only. Existing8-column calculator remains for other
works. No paid request, budget/schema/auth change. Validate against local original
examiner plus missing/zero/broken data and browser checks; do not mark full R6/A2 complete.

## C-019 — bind review and delivery to immutable Word bytes
R3/R5/R8/R9. Existing delivery accepts a JSON document without a server review and
rebuilds Word in the student browser. Add immutable versions storing exact DOCX bytes,
server-computed document/file SHA-256 and the request's server recipient. Per-criterion
review is bound to that version; a newer version invalidates earlier delivery approval.
Delivery atomically checks latest version, recipient, hashes and all review evidence.
Old results remain readable; old unreviewed delivery calls fail closed. Frontend previews
and receives the captured bytes, checks account/document changes, and collects separate
criterion evidence. Human evidence is not automated academic verification; FIN-UAT's
existing incompleteness gate remains. No AI calls/budget change or new infrastructure.
Validate forged/stale versions, missing/failed criteria, concurrency, exact bytes and
legacy retrieval with Node/Postgres/browser tests. Rollback keeps version history;
never restore the bypassing legacy delivery function. Deploy backend before frontend.

## C-020 — desktop workspace
R10/R9, explicit user request. Current520px phone shell wastes desktop space.
Add responsive CSS at960px and a single semantic request table (stacked on mobile).
Keep existing handlers, storage, auth and API. Desktop navigation uses original buttons;
document preview and controls use two columns. No paid calls or schema changes.
Alternative of merely stretching the phone rejected. Verify desktop/mobile layout,
request opening/filtering and existing CI. Rollback frontend commit/cache only.

## C-021 — audited reservation reconciliation
R4/R9. Dispatch reserves funds but settle never releases a verified unused balance.
Add administrator-only reconciliation of completed attempts with an immutable audit
record, evidence reference and a conservative retained cost ceiling. Unknown/sent
attempts remain fully reserved. Keep original attempts and cap unchanged. Serialize
against dispatch on the budget row; reject duplicate IDs, overlapping batches and
ledger mismatch. No automatic inference of actual charges from rounded account totals.
Alternative reset rejected: destroys cost history and exposes unknown requests.
Validate locally before installation. Installation itself releases no funds and sends
no model request. Actual reconciliation needs account/request evidence. Rollback may
remove the callable function but must preserve audit records and accounting balances.
