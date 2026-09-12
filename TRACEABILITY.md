# Соответствие требований и доказательств
Срез 2026-09-11. Статусы нельзя повышать без ссылок на фактические доказательства.

| Требование | Код/версия | Проверка и фактический результат | Публикация / статус |
|---|---|---|---|
| R1 диагностика | PR33, main 2ed9cf4 | Зафиксированы 78 Node + 31 browser тест; реальный контрольный запуск не выполнен | Опубликовано, полная приёмка не пройдена |
| R2 серверное выполнение | PR34, ядро 9d2326e; CI-конфигурация d73f52b | 7 локальных тестов Node/SQLite, включая SIGKILL дочернего процесса; провайдер подставной | Прототип, к Supabase и реестру не подключён |
| R3 версии и контрольные точки | PR34 | Локально: изменение входа создаёт отдельную версию, сохранённая часть остаётся | В рабочей системе не реализовано |
| R4 неизвестный результат и бюджет | PR34 | Локально: нет повторов отправленного запроса, лимит на задание | Общий бюджет и рабочая интеграция отсутствуют |
| R5 полнота/содержание | Действующие проверки реестра | Проверка пустоты есть; достаточность содержания и слов не подтверждена | Не завершено |
| R6 расчёты | Действующий движок, 5 показателей | Полная автоматическая сверка FIN-UAT-01 отсутствует | Не завершено |
| R7 источники | Библиография во входных материалах | Подтверждение утверждений извлечёнными фрагментами отсутствует | Не завершено |
| R8 Word/готовность | Действующий экспорт; PR32 отдельно | Полный контрольный документ и окончательная блокировка не подтверждены | Не завершено |
| R9 сохранность/доступ/совместимость | Действующие механизмы | Новая серверная интеграция не проверена | Нельзя заявлять отсутствие конфликтов |
| A1.1–A1.5 | Производственная интеграция отсутствует | Локальные тесты PR34 не заменяют приёмку приложения | Не пройдено |
| Приёмка 2 | Полный контрольный Word отсутствует | Нет полного протокола | Не пройдено |

Историческая причина обрыва и причина STATUS_BREAKPOINT не установлены.
Результаты CI для новых изменений проверять отдельно; наличие workflow не означает успех.
Следующая реализация должна закрывать интеграцию R2–R4 в действующей инфраструктуре,
а не развивать отдельный Node/SQLite-сервис как замену согласованному приложению.

## Обновление: PostgreSQL, 2026-09-11
R2–R4/R9: в рабочую Supabase применена миграция 20260911195103_studkab_generation_storage_v1. Хранение заданий, неизменяемых материалов и частей, блокировки, неизвестный результат и общий бюджет реализованы на уровне базы. SQL-проверки и проверка service_role прошли с откатом тестовых данных. Подробности: supabase/GENERATION_STORAGE_ACCEPTANCE.md. Edge-обработчик, расписание и интерфейс ещё не подключены; приёмки 1 и 2 не пройдены. Прототип SQLite исключён из итогового дерева PR34.

## Edge-обработчик — следующий шаг
Написан studkab-generation; 6 локальных тестов с подставными зависимостями прошли. Публикация отклонена автоматической проверкой: verify_jwt=false и передача материалов внешнему посреднику требуют явного разрешения. Обход не выполнялся. Обработчик, расписание и frontend не опубликованы. См. supabase/GENERATION_RUNNER_ACCEPTANCE.md.

## 2026-09-12 — защитная доработка обработчика
R1/R2/R4/R9: отдельная ветка feat/generation-server-integration от PR34.
Серверный Bearer до доступа к конфигурации плюс cron_token, verify_jwt=true,
выключенная по умолчанию отправка, ограничение результата в UTF-8 байтах.
90/90 локальных Node-тестов, включая 12 тестов обработчика; git diff --check пройден.
Нет публикации, расписания, Start/status интеграции или новых платных вызовов.
Приёмки A1 и FIN-UAT-01 не закрыты. Предыдущий отказ публикации не обойдён.

## 2026-09-12 — установка после разрешения пользователя
PR35 77e6c732: GitHub Safety checks #98 success. studkab-generation v1 установлен
с verify_jwt=true. Живой неавторизованный запрос отклонён HTTP401. Бюджет 0/0,
заданий 0; платных запросов нет. Расписание, Start/status и frontend остаются
неподключёнными. Установка функции не равна серверной генерации и приёмке A1.
Разрешение на существующий внешний маршрут получено; бюджет не повышен.

## 2026-09-12 — API запуска/статуса и интерфейс (подготовлены)
R2/R3/R4/R9: отдельная studkab-generation-api и свёрнутый блок реестра.
Проверка исполнителя, владелец только из сессии, серверный резерв и запрет запуска
при нулевом бюджете, чтение результатов без перезаписи документа. 100/100 Node-тестов.
Сценарий браузерной приёмки добавлен; первоначальный запуск не состоялся из-за
отсутствия Chromium. Публикация клиента и полная интеграция не подтверждены.
Протокол: supabase/GENERATION_API_ACCEPTANCE.md. Расписание и секреты не настроены;
деление больших глав, контекст частей и приёмки A1/FIN-UAT-01 остаются открытыми.

API 8a0113a7 установлен как studkab-generation-api v1 с verify_jwt=true; живой
запрос без входа: 401. В рабочей БД с ROLLBACK подтверждены одинаковое задание
при повторном Start, блокировка dispatch нулевым бюджетом, отсутствие попытки.
Клиент ещё не опубликован; настоящая конкуренция и приёмка A1 не заявляются.

8a0113a7: GitHub Safety checks #100 (34663493812) success, включая Node, SQL и
браузерную проверку нового блока: нулевой бюджет, прежняя версия, сохранность
редактируемого документа. В браузерном тесте API подставной, это не рабочая A1.

## 2026-09-12 — расписание и ограниченные части
Установлен studkab-generation-v1, раз в минуту; подтверждены 3 успешных прохода
на пустой очереди. probe18823: HTTP200, enabled=false, providerConfigured=false.
Это подтверждает отсутствие настройки ключа посредника, не готовность генерации.
Подготовлены ограниченные части, контекст только своего job, остановка до dispatch
при превышении контекста. 107/107 Node-тестов. Бюджет не повышен, платных вызовов нет.
Протокол и ограничения: supabase/GENERATION_SCHEDULE_ACCEPTANCE.md.

1ef690f2: GitHub Safety checks #105 (34673870947) success: Node, SQL, browser.
Рабочая проверка JWT без cron_token отклонена 401. Итог: 9 проходов расписания,
budget/reserved/jobs/attempts = 0. Ключ посредника не настроен; значения секретов
не извлекались. Полный реальный запуск, приёмка A1 и FIN-UAT-01 не выполнены.

## 2026-09-12 — uploaded live Worker verified
R1/R2/R4/R9 C010: uploaded ai-proxy equals tracked worker after newline normalization.
Added modern DeepSeek allowlist entries and explicit Flash non-thinking mode; no legacy
remapping. node --test tests/ai-proxy.test.mjs: 14/14 with mocked provider, no paid calls.
Manual deployment pending; runner still uses legacy name and remains disabled.
USD1 cap previously verified, reserved0/jobs0/attempts0. A1 and FIN-UAT-01 open.

## 2026-09-12 — recovery transaction and intake gate
In production DB, exclusively locked generation tables, guarded no active jobs and
reserved750000, exercised expired unsent claim/reclaim, stale dispatch rejection,
expired sent attempt to unknown without retry, late result rejection. All assertions
passed and transaction rolled back. No HTTP/model request. Script tests/manual/generation-recovery.sql.
This does not simulate process kill or network interruption at the Edge runtime.
C012 aligns API capability with minimum250000 and whole-part remaining reserve;
14 API tests pass. Browser live executor acceptance still blocked on unpublished UI.

## 2026-09-12 — main compatibility and lost job link
Merged main a34efc6 into feature; preserved reporting rules and both change records.
C014 adds executor-scoped request history and explicit result selection when browser
lost Start response. No automatic generation; basis unknown warns before use.
113 Node tests pass. Added browser scenario with two history choices and no paid Start;
CI verification pending. Main remains unpublished; real authenticated browser still pending.

771976ce: GitHub Safety checks114/run34677768400/job103510601737 completed SUCCESS,
including Node, SQL and full browser suite with lost-job selection scenario.
API v8 deployed, hash8cb0cbfc430caa47f778baff50010fe28618caa5c8c2d46cb2c54f5d423941ee;
live history request without authentication rejected401. Frontend remains unpublished;
browser tests mock Auth/API and do not equal real executor acceptance. No paid calls.

## 2026-09-12 — trial publication and length correction
User authorized pilot publication; PR35 merged2cea907. Real executor browser Start
created FIN-UAT01 job5230bfde, 17 parts. First response hit length2500, no completed part.
Status persisted across reopening. Existing document text was not replaced.
Budget limit/reserved1000000; no further paid requests.
C015: new plans target<=2000 characters per chunk rather than4500. Overall requested
volume preserved; >100 parts or oversized snapshot still rejected, never silently cut.
Existing immutable job remains unknown; no automatic retry/migration. Status reads
sanitized attempt reason after owner authorization and renders OUTPUT_LIMIT clearly.
17 API tests passed; browser regression added. Live diagnosis can be checked free;
real generation with smaller chunks remains unverified until budget decision.

## 2026-09-12 — read-only cloud assembly (C016)
R3/R5/R8/R9: cloudReport groups only one returned job plan, preserves original text,
marks missing parts, rejects duplicate/invalid ordinals and reports repeated prose.
wordCount counts Unicode words/numbers, excludes Markdown headings/table rows/code,
URLs and citation markers; it is not a Word count or an academic completeness gate.
Frontend adds a collapsed read-only review; no local document/review/budget mutation.
119 Node tests passed. Browser scenario covers gaps, narrow screen, text injection,
no paid action and preservation of local text; CI pending. Full A1/FIN-UAT01 open.
Live reduced-part test from prior stage: job5e847793 complete,969 chars,stop,
12286 input/337 output tokens, one call; approved cap=reserved1250000 microUSD.

## 2026-09-12 — original criteria and incomplete Word (C017)
Original control archive d5ba4cfe806dcb8f5460e657bd989cafcea4ad9076d360b263de239712db73b9;
16 manifest entries verified. Original requirements and acceptance text retained outside the repository.
Only labelled profile bounds are used in code; exact requirement identity is not verified.
Examiner content is not added to provider prompts.
FIN-UAT checks section words, total and missing required sections; C01–C13/S01–S03
remain unaccepted, so frontend general approval/delivery cannot mark this case ready.
This is a frontend gate, not a completed server delivery gate or full examiner.
Cloud DOCX captures one status response, exports only its parts and gaps, marks incomplete
on title and notes page, includes job/version. No local document mixing/paid calls.
Serializer now emits native numbered subsection headings and12pt single-spaced table cells.
122 Node tests passed. Four-page serializer fixture rendered and every PNG inspected:
no clipping, editable OOXML table, visible missing-part marker, TOC pages3/4 and footer2–4.
LibreOffice rendering does not establish Microsoft Word acceptance C11. Browser CI pending.
Full FIN-UAT01, financial/source checks and A1 remain incomplete.

Auto-review rejected original private-source fixture publication; those files and full
requirements literal were removed from the upload scope. Only application code, synthetic
test labels and this provenance summary are proposed. Local original files preserved.

## 2026-09-12 — extended deterministic arithmetic (C018)
financial-analysis.js parses monetary rows from current materials, validates balances,
PNL, direct/indirect cash flow, equity/assets/loan movements and opening2022 data.
Twenty metrics use end or average balances as specified, no intermediate rounding;
zero denominators are null, not zero. Scenario guards prevent impossible repayments.
Horizontal/vertical dynamics and profit bridge are computed from inputs, not reference.
Local original examiner comparison:60/60 metric values within1e-9;21 scenario fields
within0.005. Script tests/manual/verify-financial-reference.cjs takes private paths;
no source/reference content published. Arithmetic tests include independent synthetic
fixture, missing/blank/opening/conflicting data, zero revenue and insufficient loan.
128 Node tests passed; browser calculation UI test added, CI pending.
FIN-UAT preflight rejects conflicting8-column/materials values; deterministic result
enters preparation context. Existing snapshots/results remain immutable and untouched.
No paid calls. This does not certify generated prose, source claims, graphs, complete
financial Word, server-side acceptance or full R6/A1/A2.

## 2026-09-12 — C019 versioned Word delivery (implementation)
R3/R5/R8/R9: migration adds immutable Word bytes/version/review records; server hashes
both the text snapshot and exact file, binds recipient to original request, and rejects
stale/unreviewed delivery at RPC and table-trigger levels. Legacy results stay readable.
Client previews one captured Blob, records 16 separate evidence items, and downloads
stored bytes after SHA-256 comparison. FIN-UAT's existing incompleteness guard remains.
131 Node tests passed. Added SQL concurrency/forgery/immutability tests and exact-byte
browser tests; those checks and deployment are pending. Human evidence does not mean
an automated academic examiner, full Word acceptance or A1/A2 completion. No paid calls.

C019 local verification: all131 Node tests pass. Isolated PostgreSQL/PGlite migration
checks pass for exact-byte SHA-256, absent/failed/stale review, recipient mismatch,
idempotence, direct insert guard, immutable history, denied anon/authenticated access,
and preservation of a historical result. DOM/jsdom checks pass for missing preview or
evidence, preview/upload byte equality, retry identity, recipient/account changes,
exact-byte student download and corrupt-hash rejection. Optional reproducible runners:
tests/manual/result-review-pglite.mjs and tests/manual/result-ui-dom.mjs.
These are not native concurrent PostgreSQL CI or real-browser acceptance. Native SQL
and browser tests are prepared but pending: local browser download timed out; managed
browser refused the local URL. No production migration or Edge/frontend deployment.
Git push was rejected by automatic approval review for missing explicit end-user
publication authorization to public innaodincova-finpro/studkab. Remote identity/push
permissions and code-only scope were checked; a second attempt was also rejected.
No alternate publication mechanism was used. Work remains in the local feature branch.


C019 continuation: explicit user publication authorization received. Command-line Git
could not authenticate; the connected GitHub app published code-only PR40 at da058f4.
CI run34686333912 passed Node131 and native PostgreSQL including concurrency. Browser:
38 passed,1 failed because CSS overrode the hidden download button on corrupt-file
rejection. Explicit display:none now preserves the gate; repeat CI pending. Installed
requests v8 matches main98d795b (all4 files), verify_jwt=false with custom auth preserved.
Production still has2 requests and1 historical result; no C019 migration/deployment.

C019 CI run34686491225/job103534257547 at4c48c626 completed SUCCESS: Node, native
PostgreSQL and browser checks all passed after the hidden-button fix. The deployment
attempt was rejected by automatic approval because code-publication consent was not
accepted as authorization for persistent production DB changes. Migration was not
applied; Edge and frontend remain unchanged. PR40 remains draft, awaiting explicit
production update authorization. No alternate mutation path was attempted.

C019 production installation after explicit user approval: migration applied; synthetic
transactional checks passed and rolled back (2 original requests,1 result preserved).
requests v9 ACTIVE/hash d142b47875be9ca4c6201a76e8516f53e6ac20c59382e615828f074152f103b8;
custom auth preserved, live unauthenticated POST401. Final head4812ca2 CI34686638421
SUCCESS; PR40 merged98cca80f. No new advisor WARN; server-only RLS tables intentionally
have no client policies. No paid calls. Authenticated full application acceptance and
A1/A2 remain open; this installation does not prove complete FIN-UAT generation.

C020/R10: responsive desktop workspace and semantic request table implemented.
Verification and publication pending; mobile and desktop use the same persisted data.

C020 check at636efd39: CI34689181432 SUCCESS, including 131 Node tests, SQL and
Chromium/WebKit browser checks. Desktop1440 and mobile390 width, sidebar geometry,
request opening and wide document editor passed. Synthetic screenshots inspected;
editor screenshot captured during entrance animation, so screenshots now finish
animations before capture for meaningful visual inspection. Publication pending.

C020 publication: final head b8277efe CI34689378465 SUCCESS; synthetic desktop,
editor and mobile screenshots visually inspected. PR41 merged25402a2b; GitHub Pages
build/deploy34689509773 SUCCESS. Live browser at1363px: registry width1348, sidebar224,
all4 existing requests visible, FIN-UAT search returns1, detail uses2 columns, editor
width1292. Cabinet width1363/sidebar224. No horizontal overflow on either page.
Canonical URL initially served old cached markup; ?v=desktop-38 loads published UI.
No records, auth settings or budget changed; no paid calls. R10 desktop layout delivered.
A1/A2 full recovery and full FIN-UAT generation/Word acceptance remain open.

Post-C020 live acceptance continuation: read-only browser readiness check confirms
FIN-UAT editor has1455 words,8 missing sections and transfer blocked. Cloud status
for original job5230bfde reports0/17 saved, first response finish_reason=length;
SQL confirms12253 prompt/2500 completion tokens. C015 smaller chunks already exist;
job5e847793 finished stop with12286/337 tokens and1 saved part. Production budget
limit=reserved=1250000 microUSD, available0; five reservations of250000. These are
conservative reservations, NOT confirmed provider charges. No paid call, budget
reset, new generation or data change performed. Full paid acceptance blocked pending
verified provider spending/reconciliation or a new explicitly approved total cap.
A1 forced-runner termination/network-loss and A2 full Word remain unproven.

C021: administrator-only audited reconciliation implemented in budget-reconciliation.sql.
Local isolated PGlite test passes unknown-hold, invalid/duplicate IDs, amount bounds,
idempotence/conflict/overlap, cap and original-history preservation, immutable audit
and service-role denial. No automatic price inference or production release performed.
User screenshot shows rounded account-wide cost0.05/64 calls, balance1.94; account/key
coverage of the five server attempts is not yet established. Do not treat rounded
account total as per-request settlement. Deployment and verified reconciliation pending.
C021 schema installed successfully in production; readback confirms cap/reserve both
1250000,5 original attempts,0 reconciliations, service_role cannot execute release.
Native PostgreSQL rollback test rejects release of unknown attempt. Advisors show no
warning for the new function/table; no client RLS policies is intentional admin-only.
Full CI pending on PR42. Funds still held: provider-account coverage needs export.
C021 CI34693992917 SUCCESS. Automatic approval rejected merging PR42 into main:
implementation authorization was not accepted as explicit protected-branch merge
permission. No alternate merge path attempted. Schema is already installed; actual
reconciliation still not performed. Await explicit PR42 merge approval and provider
export for account/request coverage before releasing reservations.

## Обновление: 12.09.2026, снятие привязки к одному учебному случаю

R6. Было: финансовый разбор включался по словам «финансовое состояние» в теме;
годы сверки записаны в коде числами 2023, 2024, 2025; требовалось ровно три
отчётных года. Для другой темы, другого периода или другой дисциплины проверка
расчётов не работала.

Стало: разбор включается по наличию заполненной таблицы показателей в материалах,
а не по теме работы. Годы берутся из первой колонки самой таблицы. Число лет —
от двух до пяти, как и было записано в правилах ввода.

R5. Было: нормы объёма в словах существовали только для контрольного случая
FIN-UAT-01. Стало: для любой работы нормы считаются из числа страниц, указанного
вами для каждого раздела; проверка объёма работает для всех тем и вузов.

Чем подтверждено: работа по праву на 30 страниц — нормы посчитаны по разделам,
завышенный раздел найден. Таблица показателей за 2019–2021 — расчёт выполнен,
годы взяты из таблицы. Таблица за два года принимается. Свод проверок 132 из 132.

Откат: вернуть прежний файл draft-quality.js.

## Обновление: 12.09.2026, проверка источников

R7. Было: в тексте стояли ссылки вида [S1], но никто не проверял, есть ли такой
источник в списке и используется ли список вообще. Ссылку можно было поставить
на что угодно.

Стало: перед передачей документ проверяется сравнением, без нейросети.
Проверяется четыре вещи: ссылка ведёт к источнику, который есть в списке;
каждый источник из списка хотя бы раз использован; крупный раздел не остаётся
совсем без ссылок; при наличии ссылок в тексте список источников заполнен.
Замечания попадают в перечень, который блокирует передачу студенту.

Ограничение, которое остаётся: программа проверяет наличие и связность ссылок,
но не читает сам источник и не подтверждает, что в нём действительно написано
то, на что ссылаются. Это остаётся проверкой исполнителя.

Чем подтверждено: пять случаев — правильный документ даёт ноль замечаний;
ссылка на отсутствующий источник, неиспользованный источник, раздел без ссылок
и отсутствующий список источников находятся по отдельности. Свод проверок
132 из 132.

Откат: вернуть прежние файлы draft-quality.js и draft-editor.js.

## Обновление: 12.09.2026, согласованность разделов

R5. Было: проверялись только пустые разделы, незаполненные пометки и подписи
к упомянутым таблицам. Согласованность разделов между собой не проверялась.

Стало: перед передачей документ проверяется ещё по трём признакам, сравнением,
без нейросети. Один и тот же абзац в двух разных разделах. Раздел ссылается на
таблицу, но самой таблицы в нём нет — вместо данных стоит рассказ о данных.
Пропуски и сбой в нумерации подписей к таблицам.

Чем подтверждено: четыре случая. Приложение, где написано «таблицы 1 и 2
воспроизводят данные», а таблиц нет, — находится. Повтор абзаца между главой
и заключением — находится. Пропуск номера таблицы — находится. Правильный
документ даёт ноль замечаний. При проверке обнаружена и исправлена ошибка
в самой проверке: строки таблицы искались только в начале абзаца.
Свод проверок 132 из 132.

Остаётся незакрытым в R5: соответствие требованиям методички целиком
(машина не читает методичку) и оценка содержательности текста по существу.

Откат: вернуть прежние файлы draft-quality.js и draft-editor.js.

## Обновление: 12.09.2026, порядок в окне документа

R10. Было: в правой колонке подряд четырнадцать кнопок без разделения, кнопка
«Скачать Word» стояла первой — до того, как работа подготовлена. Сохранение
стояло последним и было оформлено как второстепенное. В разборе облачной
подготовки пользователю показывались служебные названия вида ch2__part_1.

Стало: колонка разделена на три шага. Шаг 1 — подготовка текста. Шаг 2 —
доводка и проверка. Шаг 3 — сохранение и выдача. «Скачать Word» перенесён
в третий шаг и стоит рядом с сохранением; сохранение оформлено как главное
действие. Служебные названия заменены на названия разделов документа
с указанием номера части.

Чем подтверждено: состав колонки выведен по порядку и сверен; свод проверок
132 из 132.

Остаётся незакрытым в R10: облачная и обычная подготовка по-прежнему живут
как две отдельные возможности внутри первого шага. Их объединение —
отдельная работа.

Откат: вернуть прежний файл reestr.html.

## Обновление: 12.09.2026, исправление собственных проверок и нумерация таблиц

Проверка на живом документе показала две ошибки в проверках, добавленных ранее
в тот же день.

Первая: на подписи таблиц 3, 4, 7, 8, 9, 10, 11, 12, 13, 14 выдавалось девять
сообщений о пропусках, хотя настоящих нарушений два — начало не с единицы и
разрыв между 4 и 7. Причина: номер сравнивался с порядковым местом, а не с
предыдущим номером. Исправлено: одно сообщение с перечнем настоящих разрывов.

Вторая: требование ссылок на источники применялось и к приложениям. Приложение
с исходными данными ссылок содержать не должно. Исправлено: требование
действует для глав, введения и заключения, но не для приложений и списка
источников.

Добавлено: сквозная нумерация таблиц по кнопке «Довести до нормы». Подписи
перенумеровываются подряд с единицы, ссылки в тексте правятся тем же
отображением, поэтому «таблица 7» после перенумерации указывает на ту же
таблицу под новым номером.

Чем подтверждено: набор 3, 4, 7, 8, 9 даёт одно сообщение вместо девяти;
правильная нумерация — ноль; приложение без ссылок не считается ошибкой,
глава без ссылок считается; перенумерация проверена на образце с текстом
и подписями. Свод проверок 132 из 132.

Откат: вернуть прежние файлы draft-quality.js и reestr.html.

## Обновление: 12.09.2026, простановка ссылок на источники

R7. Кнопка «Довести до нормы» после доводки объёма проверяет, остались ли
разделы без ссылок на источники, и проставляет их: расставляет обозначения
вида [S1] по тексту там, где утверждение опирается на источник из списка.

Ограничения, заложенные намеренно. Объём и смысл не меняются: результат
принимается, только если число слов осталось в пределах от 80 до 125 процентов
исходного и в тексте действительно появились ссылки. Источники берутся только
из списка, приведённого в материалах. Приложения и список источников этой
правкой не затрагиваются.

Остаётся ограничение R7 в целом: программа расставляет и проверяет ссылки,
но не читает источник и не подтверждает, что в нём написано именно то, на что
ссылаются. Это проверка исполнителя.

Отдельной кнопки не добавлялось: действие встроено в уже существующую,
чтобы не увеличивать число кнопок в окне.

Чем подтверждено: свод проверок 132 из 132; проверка на живом документе
предстоит.

Откат: вернуть прежний файл reestr.html.

## Обновление: 12.09.2026, повторяющиеся номера таблиц

Найдено при чтении готового документа Word, а не проверками приложения.
В документе номер 1 стоял у трёх разных таблиц, номер 10 — у двух. Ссылка
«как показано в таблице 1» указывала непонятно на какую из трёх.

Причина: проверка собирала номера подписей, отбрасывала повторы и смотрела
только на пропуски. Набор 1, 1, 2, 1 выглядел для неё как 1, 2 — то есть
безупречно. Перенумерация по той же причине считала, что править нечего.
Дефект существовал в документе и раньше, ни одна проверка его не ловила.

Стало: проверка считает каждую подпись отдельно и сообщает о повторяющихся
номерах и о фактическом порядке номеров. Перенумерация присваивает номера
по порядку появления в документе, раздел за разделом, и правит ссылки внутри
того же раздела, где стоит таблица.

Ограничение, названное честно: если раздел ссылается на таблицу из другого
раздела, такая ссылка не правится автоматически — приложение выводит перечень
таких разделов и просит проверить их вручную.

Чем подтверждено: набор 1, 1, 2, 1 даёт два замечания; правильная сквозная
нумерация — ноль; перенумерация трёх разделов даёт сквозные номера 1, 2, 3, 4
с исправлением ссылок внутри разделов. Свод проверок 132 из 132.

Откат: вернуть прежние файлы draft-quality.js и reestr.html.


## 2026-09-12 — Этап 1: единая граница MVP

M1–M13: `MVP_RELEASE_BASELINE.md` фиксирует роли, полный путь студента и
исполнителя, минимальный комплект документов, паспорт требований, определения
«черновик / проверено / готово к передаче / передано», обязательные функции MVP,
перенесённые функции и критерии выпуска. Матрица связывает каждое продуктовое
требование с пользовательской точкой, сервером/данными и будущей приёмкой.
R1–R10 сопоставлены M1–M13. FIN-UAT-01 явно ограничен контрольным финансовым
профилем и не является общей нормой. Это документальная фиксация: код, production,
данные и бюджет не изменены; выполнение M1–M13 этим не подтверждается.


## 2026-09-12 — Этап 2: синхронизация production Edge

R2/R9: в зависимой ветке восстановлен отсутствующий исходник
`studkab-cloud-check`, `studkab-generation-api/plan.mjs` приведён к фактически
установленному делению по 2000 знаков, два entrypoint выровнены побайтово.
Тесты границ обновлены с 6000/6001 на 2000/2001. Повторная сверка уникальных
файлов шести STUDKAB Edge Functions подтвердила 17/17 точных совпадений.
Локальный полный `npm test`: 132/132, 0 ошибок; CI и PR ещё не завершены. Production, данные, миграции, cron и бюджет
не менялись. 17 production-миграций против 3 файлов GitHub остаются Этапом 4.
Протокол: `supabase/PRODUCTION_CODE_INVENTORY.md`.
