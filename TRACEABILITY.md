# Соответствие требований и доказательств
Срез 2026-09-11. Статусы нельзя повышать без ссылок на фактические доказательства.

## C-045 — начало этапа 1, 2026-09-15

Согласованный порядок 1–8 зафиксирован в `QUALITY_RELEASE_PLAN.md`. В отдельной
ветке подготовлены, но не установлены: автоматический проект паспорта из заявки,
SHA-256 отпечаток текущих материалов, запрет утверждения незаполненного паспорта,
серверный запрет Start без утверждённого паспорта с тем же отпечатком, лимиты
контрольная $0.10 / курсовая $0.25 / ВКР $0.60 и временный общий потолок $0.50.
Паспорт, вид работы и предел включены в неизменяемую запись задания; dispatch
повторно проверяет пределы транзакционно.

Фактическая локальная проверка: 171/171 Node-тест,
миграции базового хранения, паспортов и C-045 последовательно применились в
PostgreSQL/PGlite. Поведенческий SQL-сценарий принял утверждённый паспорт с тем же
отпечатком и подтвердил две рассчитанные резервации ниже прежних $0.25. Платных AI-вызовов
не было. Browser-приёмка локально не запустилась из-за отсутствия Chromium.
GitHub Safety №251 воспроизвёл миграции в изолированной Supabase и успешно прошёл
Node-, SQL-, fault-injection- и браузерную приёмку. Production, Edge, GitHub Pages
и рабочие данные не изменены.

Перед публикацией защита выявила встроенный публичный project JWT в runner.
Он удалён из исходника: runner читает `SUPABASE_ANON_KEY` только из серверной
переменной окружения; отдельный тест подтверждает отсутствие JWT в файле.

Фиксированный резерв $0.25 заменён серверным расчётом по peak-тарифу
DeepSeek-V4.1-Flash, консервативной оценке входа и запасу 25%. Браузер показывает
расчётный максимум, предел работы и остаток до отдельного подтверждающего нажатия.
Рабочая миграция установлена как `20260915070508`; функции обновлены до версий
studkab-requests 21, studkab-generation-api 22 и studkab-generation 20. Проверка
схемы подтвердила три лимита, общий потолок, RLS и новые сигнатуры. Advisors выявил
отсутствующий индекс внешнего ключа `studkab_gen_jobs.passport_id`; индекс
установлен отдельной миграцией `20260915072854`, и повторный Advisors подтвердил
исчезновение этого замечания. Платных вызовов не было.

Этап 1 остаётся незавершённым до финального CI, публикации интерфейса и неплатной
проверки опубликованной страницы.

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


## 2026-09-12 — браузерный CI-контракт

R5/R8/R9: два Safety run воспроизвели 37 passed / 4 failed в одном файле
`tests/browser/drafting.spec.cjs`. Причина — тесты ожидали старые технические
подписи разделов и разрешение общего одобрения для неполного текста. Подготовлен
отдельный PR: селекторы используют фактические названия глав, а неполный документ
обязан показать блокировку, не checkbox. Runtime не меняется. Полный CI ожидается.

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

## 2026-09-13 — Этап 3: процесс изменений

R1/R9: Safety workflow расширен на Pull Request и push в `main`; checkout
получает полную историю, а отдельная проверка отклоняет стандартное сообщение
`Add files via upload`. Добавлены модульные тесты и точная инструкция ruleset,
контрольной проверки и безопасного отката. Эти файлы не включают GitHub ruleset:
до административного применения и отрицательных тестов прямой push технически
остаётся возможным. Production, Supabase, данные и бюджет не изменяются.

## 2026-09-13 — Этап 3 завершён

R1/R9: GitHub ruleset №23135376 прочитан после создания. Enforcement `active`,
цель `~DEFAULT_BRANCH` (`main`), deletion и non-fast-forward запрещены,
Pull Request обязателен, required check `safety` (GitHub Actions), strict=true,
bypass отсутствует и `current_user_can_bypass=never`. Контрольная фиксация
проходит тем же защищённым PR-маршрутом. Production, Supabase, данные и бюджет
не изменены.

## 2026-09-13 — закрытый контур A1 (подготовлен)

R2–R4/R9, A1.2–A1.4: добавлен одноразовый контур `studkab_a1_fault` для Safety CI.
Он допускает только записи `A1-SYNTHETIC`, не обращается к рабочей очереди или
внешнему провайдеру и удаляется после теста. Сценарии выполняют SIGKILL обработчика
после claim, гонку двух процессов и обрыв после сохранённой синтетической квитанции.
PR52 commit b33e94c5: Safety run162/34750936608 `success`; шаг изолированного A1,
чистое воспроизведение Supabase и browser-набор прошли. A1.2–A1.4 подтверждены в
закрытом контуре; это не выдаётся за отключение размещённого Supabase Edge runtime.
Протокол: `supabase/A1_FAULT_INJECTION_PROTOCOL.md`.

## 2026-09-13 — универсальный Word-экспорт (подготовлен)

R5/R8/R9: экспортёр получил сквозную нумерацию подписей таблиц, отказ от
обязательного разрыва страницы перед каждым разделом и перенос сохранённых
PNG/JPEG из раздела в DOCX. Это общая возможность платформы; FIN-UAT-01 применён
только как насыщенный контрольный документ. Модульные проверки: 138/138.
Контрольная сборка: 51 страница, таблицы 1–14 без повторов, два изображения.
Локальный browser-набор заблокирован отсутствием Chromium и сетевым тайм-аутом
его загрузки; поэтому изменение ещё не считается опубликованным или принятым.

## Обновление: 13.09.2026, единая подготовка документа

R2–R4/R8–R10. Две конкурирующие кнопки общей подготовки удалены. В первом
шаге осталось одно действие: оно сначала ищет сохранённый серверный запуск,
затем проверяет доступность и бюджет и только после этого создаёт новый запуск.
Сохранённое задание можно продолжить после закрытия браузера. Отдельный
«Неполный Word» удалён: незавершённые части остаются видимыми для проверки,
а итоговый Word создаётся одной штатной кнопкой после переноса и проверки текста.

Ручное редактирование разделов, локальная переработка отдельного раздела,
сохранение и Word не зависят от доступности серверной подготовки. Уже введённый
текст не заменяется автоматически. Схема базы, рабочие данные, доступы, секреты,
расписания и бюджет не меняются; платных проверочных запусков нет.

Проверка: модульный контракт единственного процесса; браузерные сценарии начала,
восстановления потерянной связи с запуском, продолжения после повторного открытия,
нулевого бюджета, неизвестного результата и частично сохранённых частей.

Откат: revert изменения интерфейса, тестов и этой документации; сервер и данные
откатывать не требуется.

## 2026-09-13 — устранение повторного выбора и устаревшей карточки

R2/R3/R8/R9. Для неизменной пары локальных и облачных записей решение «позже»
сохраняется в локальном хранилище конкретного аккаунта. Автоматический запуск после
повторного входа не показывает тот же вопрос снова; пользователь может в любой
момент вернуться к нему через «Проверить записи». Ни одна версия при откладывании
не заменяется.

Карточка заявки обновляется после закрытия редактора документа и показывает
«Открыть документ» сразу после сохранения. Добавлены браузерные проверки обоих
сценариев. Production, Supabase-схема, рабочие данные и платные функции не менялись.

## 2026-09-13 — нефинансовая приёмка NONFIN-UAT-02

R5/R8/M8. В опубликованной платформе создана полностью синтетическая заявка №4
по теме организации работы проектной команды. Методичка требует введение с целью
и задачами, теоретическую и практическую главы, заключение с выводами, отдельный
список источников, таблицу, рисунок и приложение. Финансовые расчёты прямо отмечены
как неприменимые. Заявка дошла до реестра исполнителя; первоначальная передача
пустого документа корректно заблокирована из-за отсутствия обязательных элементов.

При заполнении выявлена ошибка универсального контроля: норма объёма основной
главы применялась также к библиографии и приложению. C-033 исключает эти служебные
разделы только из подсчёта объёма; проверки их наличия, заполненности, количества,
источников и изображений сохранены. FIN-UAT-01 не меняется. Локальный полный
`npm test`: 146/146, 0 ошибок. Повторная опубликованная приёмка и передача результата
студенту выполняются после зелёной Safety-проверки и публикации изменения.


## 2026-09-13 — эксплуатационная приёмка после PR #58

M1/M5/M10/M12/M13. Точная версия main `e2da867`: локальные Node-проверки
146/146. GitHub Safety run #188 (`34773312609`) success, включая SQL, закрытый
контур A1, воспроизведение Supabase и browser Chromium/WebKit. Опубликованный
реестр повторно открыт в новой вкладке: синтетическая заявка №4 и документ
7 разделов / 9 069 знаков сохранены. Desktop 1363×936 без горизонтального
переполнения.

В рабочей базе все таблицы `studkab_*` имеют RLS и не дают anon/authenticated
прямых прав чтения или записи. Четыре push-доставки имеют accepted и не более
одной попытки. Это не заменяет вход двух независимых студентов.

Приёмка частичная: физические iPhone/Android, восстановление всей базы из резервной
копии, живой переход по уведомлению и пилот 2–3 независимых пользователей не
выполнены. Советник общего Supabase-проекта также показывает отключённую leaked
password protection и две доступные authenticated SECURITY DEFINER-функции
«Точки дня»; это отдельный риск совместного размещения, а не дефект STUDKAB.
Фактический протокол: `OPERATIONS_ACCEPTANCE_2026-09-13.md`.


## 2026-09-13 — уточняющий аудит безопасности общей Supabase

M1/M13. Read-only проверка `tochka_manage_access` и `tochka_visit`:
обе SECURITY DEFINER, owner postgres, `search_path=''`; anon EXECUTE отсутствует,
authenticated/service_role разрешены намеренно. `tochka_manage_access` проверяет
`auth.uid()`, подтверждённый email владельца, совпадение целевого id/email,
запрещает удаление владельца и меняет только данные «Точки дня».
`tochka_visit` обновляет только строку текущего непрекращённого участника.
Вызовы подтверждены в репозитории `tochka-dnya`. Немедленный REVOKE сломал бы
рабочие сценарии; фактическая уязвимость не подтверждена.

Leaked password protection действительно выключена, но организация использует
Supabase Free, а функция доступна только на Pro и выше. Платное изменение не
выполнялось. Остаточный риск — общий Auth и компрометация аккаунта владельца;
целевое решение после функциональной приёмки — разделение приложений, а не
отключение проверенных функций.

## 2026-09-13 — готовность закрытого пилота

M1/M11–M13: выполнена читающая проверка общего проекта Supabase. Подтверждены
5 Auth-пользователей без тестовых адресов example.com/example.test, 4 существующие
заявки, RLS на всех таблицах STUDKAB, отсутствие прямых прав anon/authenticated и
service-role-only доступ к функциям очереди/выдачи. Производственные данные и Auth
не изменялись. Состав трёх синтетических студентов и критерии изоляции зафиксированы
в `PILOT_READINESS_2026-09-13.md`.

Аккаунты и приглашения не создавались: недоставляемые адреса-заглушки не проверяют
реальный путь, а прямая SQL-запись в `auth.users` недопустима. До пилота остаются
зафиксированные в baseline проверки восстановления, физических устройств,
уведомлений и нагрузки 15–20 студентов.

## 2026-09-14 — календарь учебных дел по образцу «Точки дня»

M5/M12/R9/R10. Месячный экран STUDKAB переведён на последовательные карточки
трёх месяцев. В клетке отображаются до двух названий учебных дел и количество
остальных; оформление различает предстоящие, просроченные и полностью выполненные
дни. Нажатие по-прежнему открывает список выбранного дня, а срок сдачи ведёт к
соответствующей работе. Режимы недели и периода сохранены.

Код, данные и хранилище «Точки дня» не подключались. Supabase, Auth, рабочие
записи и уведомления не менялись. Добавлены модульные проверки состояния,
экранирования названий и доступной подписи дня; полный локальный Node-набор:
150/150. Браузерная, визуальная и GitHub Safety-проверки фиксируются отдельно до
публикации.

## 2026-09-14 — исправление экрана первого входа

M1/M12/R9. Физическая проверка на iPhone подтвердила, что ранее созданная
одноразовая ссылка тестового студента недействительна; пароль по ней не был задан.
На экране также обнаружено пользовательское упоминание второго приложения.

В клиенте STUDKAB тексты активации, входа, восстановления, приглашения и настройки
пароля сделаны самостоятельными: они описывают только кабинет студента. Добавлен
автоматический тест, запрещающий повторное появление названия второго продукта на
этих экранах; обновлён офлайн-кэш. Общий Auth-проект и остаточный архитектурный риск
продолжают фиксироваться в эксплуатационной документации. Supabase, пользователи,
пароли и рабочие данные этой правкой не изменяются.

## 2026-09-14 — устранение повторного ввода в работе

M1/M12/R9. По результату физической проверки iPhone общие сведения профиля
автоматически заполняют только пустые поля существующих и новых работ. Значения,
которые уже заданы для конкретной работы, не перезаписываются. Подсказка заявки
указывает фактические разделы, пример темы стал нефинансовым, мобильные поля стали
компактнее. База и сохранённые записи не мигрируют; публикация и физическая
повторная проверка фиксируются после Safety.
## 2026-09-14 — сокращённая пользовательская приёмка и ТЗ 1.1

M1/M8/M10/M12/R9. На опубликованной версии `a9aa35d` синтетический студент A
прошёл на физическом iPhone активацию, создание работы, заявку №5, получение и
скачивание проверенного Word. В рабочей базе подтверждены одна версия, один review,
один result и совпадение получателя с владельцем заявки. Отдельный Auth-аккаунт B
активирован штатно; при последовательном живом входе его «Работы» и календарь пусты,
данные A не отображаются. Точные доказательства и ограничения записаны в
`SHORT_ACCEPTANCE_2026-09-14.md`.

Проект функционального ТЗ помощника исполнителя зафиксирован в
`EXECUTOR_ASSISTANT_SPEC_1_1.md`. Он использует паспорт требований конкретной работы,
разделяет требования, измеримые ошибки, предметные рекомендации и предположения,
сохраняет контроль исполнителя, версионность, бюджет и существующий серверный gate
передачи. Это проект документа: код помощника, production и платные вызовы не
изменены; реализация начинается только после утверждения содержания.

## 2026-09-14 — помощник 1.1, этап 1 подготовлен локально

M8–M10/R3/R5/R7–R9. Добавлены `requirements.mjs`, действия `passport-get`,
`passport-save`, `passport-approve` и карточка паспорта в заявке исполнителя.
Валидация различает требование методички, измеримую проверку, предметную рекомендацию
и предположение; сервер повторно проверяет исполнителя и существование заявки,
игнорирует подмену идентификатора студента. SQL-шаблон включает версии, статусы,
RLS, отсутствие клиентских grants и service-role-only RPC.

Локальный `npm test`: 159/159, `git diff --check`: без замечаний. Browser 0/43:
тесты не запускались из-за отсутствующих исполняемых Chromium/WebKit; две попытки
загрузки Chromium завершились сетевым тайм-аутом. Supabase CLI отсутствует.
Создание платной branch ($0.01344/час) и бесплатного третьего проекта завершилось
`INVALID_ARGUMENT`; организация Free уже содержит два рабочих проекта. Поэтому
миграция не создана/не применена, Edge/frontend не развёрнуты, production и данные
не менялись. Этап остаётся локальной подготовкой, а не готовой функцией.

## 2026-09-14 — паспорт требований развёрнут на сервере

Safety run 214 прошёл: Node, SQL, полный replay Supabase, Chromium и WebKit.
После отдельных разрешений пользователя применена migration
`20260914105509_studkab_requirement_passports` и Edge Function
`studkab-requests` обновлена с версии 17 до 18. Frontend ещё не опубликован;
пользовательские данные и платные AI-вызовы не изменялись.

## 2026-09-14 — desktop-заявка собрана в один рабочий поток

M8/M12/R9. Детальный экран исполнителя на ширине от 960 px ограничен центральной
колонкой 1080 px. Документ, передача, справочник, работа, паспорт требований,
оформление и статус идут сверху вниз в порядке работы; основные кнопки и подписи
укрупнены. Дублирующая плавающая кнопка документа в этом режиме скрыта. Мобильный
интерфейс и функциональное поведение не изменены. Проверка фиксируется отдельным
layout-тестом, полным Node-набором и Safety PR.

## 2026-09-14 — карточка заявки сгруппирована по смыслу

M8/M12/R9. По результату пользовательской визуальной проверки линейная лента
C-040 заменена смысловыми разделами. Основные сведения о заявке видны сразу;
требования, выполнение, результат и передача студенту сворачиваются. Самостоятельная
карточка справочника исключена: сведения вуза и паспорт требований находятся в
разделе требований. Одновременно открыт один раздел, его выбор сохраняется для
конкретной заявки. Рабочая ширина уменьшена до 900 px, кнопка передачи больше не
растягивается на всю карточку. Данные и обработчики действий не менялись.
Локальный `npm test`: 160/160.

## 2026-09-14 — исправления по внешнему аудиту подготовлены локально

R9/M11–M13, C-042. `@supabase/supabase-js` 2.57.4 добавлен в `vendor/` и подключён
локально на `index.html`, `reestr.html` и `activate.html`; внешняя загрузка jsDelivr
удалена; SHA-256 локальной копии закреплён тестом. На трёх страницах задана CSP,
которая запрещает внешние сценарии, но из-за встроенного JavaScript пока сохраняет
`unsafe-inline` и не является полной XSS-защитой. Workflow рабочего AI-посредника запускается
автоматически только из `main`; ручной запуск сохранён. Worker без `ALLOWED_ORIGIN`
отвечает ошибкой до проверки токена и вызова поставщика. Общие функции HTML-вывода
экранируют одинарную кавычку. GitHub Actions закреплены по commit SHA.

Специальные проверки фиксируют локальную pinned-копию и её SHA-256, отсутствие CDN,
наличие CSP, единственный production branch-trigger, fail-closed Origin, экранирование
и неизменяемые версии GitHub Actions. Чистая ветка собрана непосредственно от
публичного `e8510d9`; дублированный локальный C-040 в неё не включён. Полный локальный
Node-набор: 165/165; `npm audit --omit=dev`: 0 известных уязвимостей;
`git diff --check`: без замечаний. Изменение ещё не опубликовано.

Повторная установка Chromium/WebKit завершилась ошибкой: CDN Playwright несколько
раз вернул пустой/повреждённый ZIP, затем тайм-аут. Поэтому 43 браузерных сценария
локально не запускались; это инфраструктурный блокер, а не пройденная проверка и не
43 дефекта приложения. Их должен выполнить GitHub Safety после публикации ветки.
Визуальная проверка не выполнена. Замечание о распределённом rate limit и гигиена
удалённых веток остаются открытыми и не входят в C-041/C-042.

## 2026-09-14 — C-043 компактный справочник вузов подготовлен локально

M8/M10/M12/R9. Вкладка «Вузы» переведена на компактные смысловые группы: закрытая
строка показывает вуз, число направлений, заявок и статус проверки; подробности
факультетов и кафедр раскрываются по запросу, одновременно открыт один вуз.
Добавлены поиск и отбор «Требует уточнения». Вкладка «Заявки» сохранена как
обзорная таблица, вкладка «Ещё» уже использует сворачиваемые смысловые разделы.

Локальный Node-набор: 167/167, `git diff --check`: без замечаний. Browser-сценарий
добавлен, но локально не выполнен: в среде отсутствует исполняемый Chromium. Его
обязан выполнить GitHub Safety после публикации ветки. Production, Supabase,
Auth, данные, уведомления и бюджет не изменены.

## 2026-09-14 — C-044 прямой платный маршрут закрыт локально

R4/R9. Из браузерной `askAI` удалён сетевой транспорт; функция всегда завершает
операцию кодом `DIRECT_AI_DISABLED` до `fetch`. Кнопка «проверить лимит» обращается
только к авторизованному `studkab-generation-api` с действием `capabilities` и не
вызывает модель. Старые функции переработки разделов сохранены как интерфейсно
совместимый откат, но физически не могут отправить запрос. Офлайн-кэш повышен до
`studkab-v47-budget`, старые именованные кэши STUDKAB теперь удаляются.

Регрессионная проверка подтверждает ноль сетевых обращений старого маршрута.
Локальный Node-набор: 163/163 до удаления мёртвого транспорта; окончательный прогон
фиксируется перед коммитом. Production, база, баланс и лимит не изменялись;
реальная сумма DeepSeek остаётся внешним фактом кабинета поставщика, а не значением
внутреннего серверного бюджета.

## 2026-09-15 — C-046 исправление реальной приёмки этапа 1 подготовлено локально

R4/R5/R9/R10/M8–M10. Проверка C-045 на физическом iPhone подтвердила создание
паспорта и отсутствие платного вызова при нажатии на старый заполненный документ,
но не доказала серверную блокировку: клиент раньше сообщил «Все разделы уже
заполнены». Также зафиксированы нечитаемая двухколоночная раскладка, внутренний
JSON оформления и доступный вид кнопки утверждения при четырёх обязательных
уточнениях.

C-046 выводит паспорт одной колонкой, человекочитаемо показывает оформление,
перечисляет незаполненные требования и блокирует утверждение. Перед проверкой
разделов новый запуск получает текущий паспорт с сервера и требует статус
`approved` с тем же отпечатком материалов; только после этого возможны estimate
и start. Серверный барьер C-045 сохранён.

Локально пройдены `git diff --check` и 173/173 Node-теста. Два выбранных browser-
сценария не запускались из-за отсутствующего исполняемого Chromium; это
инфраструктурный блокер и не успешная проверка. Production, Supabase, данные и
DeepSeek не изменены; платных запросов не было. Browser/Safety и повторная ручная
приёмка остаются обязательными.
## 2026-09-15 — C-048 последовательный путь подготовки готов локально

M8/M10/M12/R4/R9. На странице заявки добавлена одна карточка «Следующий шаг»,
которая выбирает только допустимое действие по состоянию паспорта и документа.
Дублирующая плавающая кнопка документа на детальной странице скрыта. Уточнение
паспорта теперь показывает отдельные подписанные пункты и сохраняет их исходные
категории и источники без повторного ввода остальных данных.

Локальный Node-набор: 173/173; `git diff --check`: без замечаний. Browser-набор
описан, но локально не выполнен из-за отсутствующего Chromium; это не считается
успешной браузерной проверкой. Supabase и платные маршруты не изменены.

## 2026-09-15 — C-049 форма уточнения сокращена локально

M8/M10/M12. По результату проверки C-048 на физическом iPhone форма паспорта
теперь выводит только неуточнённые требования. Известные пункты не отображаются,
но сохраняются без изменений при отправке новой версии паспорта. Добавлены
модульная фиксация сохранности полного массива и браузерная проверка, что при
одном пропуске отображается ровно одно поле.

Локально пройдены 173/173 Node-теста и `git diff --check`. Browser-проверка
остаётся обязательной в GitHub Safety. Supabase, данные и DeepSeek не изменены;
платных запросов не было.
# C-050 — трассировка обязательных проверок содержания

| Требование | Реализация | Проверка |
|---|---|---|
| Все источники утверждённого паспорта отражены в библиографии | `draft-quality.js: sourceCheck` | `approved passport sources must all appear in bibliography` |
| Однословный обрывок не проходит готовность | `draft-quality.js: proseIntegrity`, `draft-editor.js: check` | `one-word prose fragment blocks readiness` |
| Обновление доходит до мобильного ярлыка | версии ресурсов и новый cache namespace в `reestr.html`, `sw.js` | Safety + браузерная приёмка после публикации |

# C-051 — замечания аудита 15.09.2026, этапы 0–1

| № аудита | Требование | Что сделано | Чем доказано | Статус |
|---|---|---|---|---|
| Этап 0 | R9, M13 | Версия a2f73217 = архив; история репозитория без секретов | сравнение файлов; поиск по 478 состояниям | частично: сервер не сверен |
| 1 | R4, M6 | Worker: одна модель, предел 4000, безопасное сравнение; пароль убран из реестра | `ai-proxy.test.mjs`, `ai-transport.test.cjs`: 4 проверки не проходили до правки, проходят после | проверено в рабочей копии |
| 12 | R9 | Проверка номера заявки до запроса к базе | `generation-api.test.mjs`: не проходила до правки, проходит после | проверено в рабочей копии |
| 2 | R2, R3, M4 | Остановка, проверка паспорта перед отправкой, новый старт после остановки | `generation-stop-sql.test.mjs` (5 из 6 сценариев не проходят без миграции, все проходят с ней); `generation-api.test.mjs` (2 не проходили); браузерные C-051 (4 не проходили) | проверено в рабочей копии |
| 6 | R9, M13 | Объекты из файла расхождений записаны миграцией, файл удалён | `supabase-history.test.mjs`: не проходила до правки, проходит после | проверено в рабочей копии |
| 7 | R4, M6 | Неподтверждённый запрос удерживается полностью; возврат только сверкой администратора | `generation-money-sql.test.mjs`: сценарии 7 и сверки не проходили до правки | проверено в рабочей копии |
| 8 | R4, M5 | Обрыв по длине не повторяется; иной неподтверждённый — не более двух попыток | `generation-money-sql.test.mjs`: сценарии 8 и восстановления не проходили до правки; браузерная проверка сообщения | проверено в рабочей копии |

| Установка | R9, M13 | Задание GitHub «C-051 установка правок аудита» | `c051-install.test.mjs`: 13 проверок; запуск №3 16.09.2026 успешен, рабочие записи не изменились | установлено; приёмка заказчиком не проведена |

Общий набор: Node 197/197. Браузерные: 49 из 52; 3 не проходят и на исходной версии
из-за проверочной среды (проверка для Safari, имя скачанного файла), в GitHub проверяются.

| № аудита | Требование | Что сделано | Чем доказано | Статус |
|---|---|---|---|---|
| 23 (часть: список заявок) | R10, M12 | C-052: заявка открывается нажатием в любом месте строки | `request-row.spec.cjs`: не проходила до правки | проверено в рабочей копии |
| 24 (часть: подпись значка) | R10, M12 | C-053: подпись значка реестра «Заявки» | `home-screen-name.test.mjs`: не проходила до правки | проверено в рабочей копии |

# C-054 — этап 3: доступ и данные студентов

| № аудита | Требование | Что сделано | Чем доказано | Статус |
|---|---|---|---|---|
| 3 | R9, M1 | Запись кабинета и реестра только через приложение, предел 10 МБ | `cloud-guard-sql.test.mjs` | проверено в рабочей копии |
| 4 | R9, M1 | Восстановление только для допущенных студентов | `student-access.test.mjs` | проверено в рабочей копии |
| 5 | R9, M1 | Список допущенных; заявки, облако, уведомления только для него | `members-sql.test.mjs`, `student-access.test.mjs` | проверено в рабочей копии |
| 9 | R9 | Безопасное сравнение служебных ключей | `service-keys.test.mjs`, проверка кода | проверено в рабочей копии |
| 10 | R9, M11 | Ключ уведомлений до создания ключей подписи | `service-keys.test.mjs` | проверено в рабочей копии |
| 11 | R9 | Связь страниц только со своим сервером | `connect-policy.spec.cjs` | проверено в рабочей копии |
| 13 | R9 | Личная почта убрана из текущих файлов | `public-repo-privacy.test.mjs` | проверено в рабочей копии; в применённых миграциях остаётся |

# C-054 — установка этапа 3 (пункт 10 задания)

| Требование | Реализация | Проверка | Статус |
|---|---|---|---|
| Изменения базы применяются точным текстом файлов и регистрируются в перечне | `supabase/c054-install.sql` | `c054-install-sql.test.mjs` (pglite): текст в перечне совпадает с файлами миграций | проверено в рабочей копии |
| Повторный и преждевременный запуск не меняют базу | защита в `supabase/c054-install.sql` | `c054-install-sql.test.mjs`: «Уже установлено», «Сначала установите изменения C-051», запись больше 10 МБ | проверено в рабочей копии |
| Порядок установки, сохранность записей и сверка с описью | `scripts/c054-install.mjs` | `c054-install.test.mjs`: 11 сценариев, включая остановку при идущей подготовке и при изменении рабочих записей | проверено в рабочей копии |
| Публикация трёх функций без изменения `verify_jwt` | `scripts/c054-install.mjs`, `.github/workflows/c054-install.yml` | `c054-install.test.mjs`: рост версии и неизменность проверки входа | проверено в рабочей копии |
| Проверки доступа без платных запросов | `scripts/c054-install.mjs` (PROBES) | `c054-install.test.mjs`: 403/401/403 обязательны для успеха | проверено в рабочей копии |
| Пределы входа Supabase Auth выводятся без изменений и без секретов | `scripts/c054-install.mjs` | `c054-install.test.mjs`: в журнале только `rate_limit_*`, секреты не попадают | проверено в рабочей копии |
| Установка в рабочую базу | задание GitHub «C-054 установка доступа и данных студентов» | не выполнено: нужен запуск задания с ветки main | не установлено |

Общий набор после изменения: Node 234/234 (было 222/222). Платных запросов не было,
Supabase, Cloudflare и рабочие данные этим изменением не затронуты.
