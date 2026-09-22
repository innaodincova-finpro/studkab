# Соответствие требований и доказательств

## C-079 — защищённое удаление заявки, 20.09.2026

R3/R4/R9 → `20260920111220_c079_request_deletion.sql`, `studkab-requests`,
`reestr.html`, `sw.js`. Реализованы: исполнительская авторизация, двойное
подтверждение ID, предварительная блокировка новых вложений, запрет удаления при
несверенных расходах, Storage API до транзакции базы, идемпотентный повтор,
удаление полного графа и неперсональный аудит. Локальная карточка удаляется только
после ответа сервера; блокирующий браузерный `confirm()` не используется.

Локально: 7/7 целевых Node/PGlite-тестов; окончательный полный набор 301/301.
Browser-набор локально не стартовал: Chromium отсутствовал, а три попытки загрузки
завершились сетевым timeout; браузерная проверка остаётся обязательной в CI.
Установка, CI, производственная очистка девяти карточек и четырёх Storage-файлов,
создание новой заявки и полный пользовательский цикл пока не подтверждены.

## Подтверждённая установка C-074, 20.09.2026

PR #116 объединён в main5e2a953da0e8995e31ef01365f96e3a55054e0b4.
Обязательный Safety35489406664 — success (Node/SQL/A1/replay/browser).
Предыдущий прогон35489003310 остановился на проверке видимости свёрнутой группы;
сценарий исправлен, повторный полный прогон успешен. Проверки не отключались.
Requests deploy35489726797 и Pages35489726340 — success.
Обе функции — studkab-requests v35 (9 файлов) и studkab-generation-api v35
(5 файлов) — после установки сверены с проверенными исходниками, совпали.
Четыре опубликованных файла сайта сверены побайтно по HTTPS; HTTP200.
Без входа обе функции возвращают401. Это подтверждение установки, не полная
приёмка двух аккаунтов. Рабочие данные/Word/паспорт не менялись, AI-вызовов нет.
Ссылка: https://github.com/innaodincova-finpro/studkab/pull/116


## C-075 — реестр без перекрывающей кнопки, 20.09.2026

TASK R10 → desktop.css, reestr.html, cache desktop?v=7 / sw v64. На телефоне
все семь этапов переносятся на следующие строки; кнопка «Из текста» занимает
собственное место в панели действий на телефоне и компьютере. Сокращены отступы
мобильных строк; таблица и боковая навигация компьютера сохранены. Повторный render
сохраняет исходную кнопку; данные и статусная логика не менялись.

Локальная проверка: 18/18 Chromium browser (mobile-registry, registry-workspace,
desktop, request-row). Новые проверки 320/390/1440 проверяют нажатие каждого этапа,
отсутствие горизонтального выхода, положение кнопки выше строк, открытие формы и
неизменность восьми синтетических записей. Скриншоты всех трёх ширин просмотрены.
Node: 11/11 pretest; основной запуск 286/287, единственное падение — устаревшее
ожидание URL CSS v6. После обновления ожидания на v7 целевой набор 5/5 прошёл.
Дополнительный Chromium mobile-nav прошёл; прямой WebKit mobile-nav превысил
локальный timeout 90 секунд, полный смешанный запуск остановлен при завершении
процесса. WebKit и полный обязательный CI должны быть подтверждены в PR.

Статус при подготовке C-075: установка ещё не выполнена; окончательные
доказательства публикации фиксируются в PR C-075. Эти локальные синтетические проверки не закрывают
содержательную приёмку работ, остальные дефекты вузов/статусов и пользовательский
пилот. Данные рабочей среды, платные запросы и C-074 не затрагивались.


## C-074 — проверка исходных требований и отчёт исполнителю, 20.09.2026

R5/R7/R8/R9. Подготовлены серверный контроль явно сниженного минимума источников
и отчёт с разделением блокеров, замечаний и ручных проверок. Перечень фактов
повторной сверки Word — docs/C074_UAT_REVIEW.md; технические границы —
docs/C074_SERVER_SCOPE.md. Исторический Word и рабочие данные не изменены.
Локально: 285/285 основного Node-набора и 11/11 attachment pretest; после
добавления двух регрессий40/40 целевых quality/source-minimum тестов.
35 целевых browser-сценариев проверены: 34 прошли первоначально; проверка
изменённой подписи и новый сценарий C-074 повторно прошли после корректировки
ожидания теста. Полный обязательный CI фиксируется в PR.
Публикация и полная содержательная приёмка на момент этой записи не заявляются;
статусы установки подтверждаются отдельно журналами PR/Actions. На read-only
выгрузке фактических вложений и revision7 новый guard возвращает conflict10/5.


## Актуальная поправка статуса, 20.09.2026 (C-073)

Текущие статусы сведены в QUALITY_RELEASE_PLAN.md, раздел «Текущий статус на
20.09.2026». Нижележащие записи сохраняют историческое состояние на дату записи.
Формулировки C-068/18.09 о «полной приёмке UAT-MGMT-01» уточнены: техническая
передача подтверждена, содержательная приёмка повторно открыта из-за расхождений
10/5 источников и срока 30/17 октября. Это не потеря Word и не отмена передачи.

C-071 и C-072 установлены, поэтому старые «не опубликовано / 401» больше не
описывают текущую установку. PR #112: SQL 20260919124300 → рабочая 20260919133155,
Edge/Pages success (35446130110/35446129619). PR #114: merge
 ec58349c83f9127e56adf0d0a45e9de39b379221, Edge v34/Pages success
(35485960741/35485960458), 8 файлов Edge и 4 файла сайта совпали с проверенным кодом.
Safety C-072 35485652526: 274 Node и 75 browser, SQL/A1/replay success.
Рабочая SQL-транзакция C-071 с откатом подтвердила основные ограничения передачи.
Полный авторизованный путь после обновлений, содержание, антиплагиат, устройства
и остальные критерии TASK.md остаются открытыми. Ссылки на доказательства — в плане.

C-073 меняет только три контрольных документа. Порядок этапов, бюджет, исходные
требования, код и рабочие данные не меняются. Проверка: согласованность всех восьми
этапов, перенос подтверждённых установок из PR #112/#114, устранение повторяющихся
устаревших текущих статусов; история сохранена. PR #113 содержит более раннюю
документальную фиксацию C-071; её факты включены здесь, его статус не означает
незавершённую установку программы.

Срез 2026-09-11. Статусы нельзя повышать без ссылок на фактические доказательства.

## 2026-09-18 — C-068: фактический остаток качества и выпуска

Повторно разделены техническая готовность маршрута и доказанная готовность качества.
Полный локальный набор до документальной фиксации — 265/265. Подтверждёнными оставлены
заявка, изоляция, версионный Word, SHA-256, паспорт, серверные лимиты и одна приёмка
UAT-MGMT-01. Не закрыты: рабочая публикация C-066 (`401 Unauthorized`), универсальный
содержательный examiner, окончательная проверка источников, единый отчёт рисков,
ручной антиплагиат, цикл замечаний, две приёмки, себестоимость и предпилотные проверки.
FIN-UAT-01 не объявляется обязательной тематикой второй работы: это отдельный профиль
детерминированных финансовых расчётов. Изменены только контрольные документы; код,
база, рабочие данные и расходы не затронуты.

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

## 2026-09-16 — C-054: установка остановлена, добавлена сверка состояния

| Требование | Реализация | Проверка | Фактический результат |
|---|---|---|---|
| R9, M13: не повторять установку вслепую | остановка в `supabase/c054-install.sql` и `scripts/c054-install.mjs` при существующих объектах без записи в перечне | `c054-install.test.mjs`, `c054-install-sql.test.mjs` (pglite) | проверено в рабочей копии |
| R9, M13: фактическое состояние рабочей базы | `scripts/c054-state.mjs`, задание `c054-state.yml` (только чтение) | `c054-state.test.mjs`: 10 сценариев, включая запрет любых запросов, кроме `select` | проверено в рабочей копии; в рабочей базе не запускалось |
| R9, M13: сверка текста функций и состава `studkab_members` | `scripts/c054-state.mjs`: перечень изменений с 20260915, сравнение тел четырёх функций с файлами, столбцы, права, защита строк | `c054-state.test.mjs`: различение версий `save_app_data_v2`, чужого текста и отсутствия функции | проверено в рабочей копии |

Запуск установки 16.09.2026 (прогон №1, коммит 385d613) не выполнен: ошибка
`relation "studkab_members" already exists` на шаге изменений базы. Установка C-054
не завершена; изменения остаются в `pending_migrations`. Общий набор: Node 244/244.

## 2026-09-17 — C-054: расширенная read-only сверка подготовлена

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| Не повторять установку и не изменять production | `scripts/c054-state.mjs`: десять статических `SELECT`, fail-closed guard; workflow без install/CLI/deploy | `c054-state.test.mjs`: запрет DML, DDL и второго statement | локально проверено; production не запрашивалась |
| Сопоставить фактические версии `20260916135700`/`20260916135724` с файлами C-054 | `MIGRATION_RECORDS_QUERY`; statements сравниваются только внутри процесса | отсутствие записи и чужое содержимое дают `не соответствует` | локально проверено; verdict production ещё не получен |
| Проверить полную схему доступа | catalog queries: столбцы, точный набор CHECK, PK/FK, ROW+BEFORE trigger, RLS/policies/grants, owner, `SECURITY DEFINER`, `search_path`, EXECUTE | отдельные негативные сценарии каждого класса | локально 14/14 |
| Сохранить контекст миграций | регистрация C-051 и полный список `version`/`name` с 20260915 без `statements` | тест списка и отсутствия поля `statements` в запросе | локально проверено |
| Не раскрывать персональные данные, SQL и секреты | журнал содержит verdict и агрегаты; тело ошибки Supabase скрыто | тест UUID/email/SQL/JSON/token и ошибки API | локально проверено |

Следующее решение принимается только по фактическому verdict из `main`: при полном
соответствии production не меняется; при расхождении готовится отдельная forward-only
миграция только для доказанно недостающей части. Текущая ветка базу не изменяет.

## 2026-09-17 — C-054: forward-only исправление прав service_role

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| `service_role` имеет только `SELECT`, `INSERT` на `studkab_members` | production migration `20260917120817_c054_service_role_grants.sql` | `c054-grants-sql.test.mjs`; production read-only ACL | применено и проверено |
| Данные и владелец таблицы сохраняются | migration содержит только `REVOKE`/`GRANT` | PGlite: число строк и владелец до/после совпадают; статический запрет DML/DDL | локально проверено |
| Права владельца `postgres` не считаются drift | фильтрация owner-grants в `scripts/c054-state.mjs` | fixture включает полный набор owner-grants и получает `security=true` | локально проверено |
| Migration входит в контролируемую историю | `manifest.json`, SHA-256 и `package.json` | `supabase-history.test.mjs`, полный `npm test` | локально 250/250 |

Production `apply_migration` зарегистрировал версию `20260917120817` с именем
`c054_service_role_grants`. После применения подтверждены только `INSERT`/`SELECT`
у `service_role`, RLS включён, policies 0, активных подготовок 0. Контрольные количества
до и после не изменились: заявки 5, облачные записи 6, подписки 3, допущенные 5.
Репозиторий синхронизируется с фактическим номером без повторного изменения базы.

## 2026-09-17 — C-055: ремонт подтверждённых дефектов независимого аудита

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| R1/R2/R4: подготовительный отказ сохраняется атомарно и не повторяется бесконечно | pending migration `20260917150000_studkab_preparation_diagnostics.sql`; runner вызывает `studkab_gen_fail_preparation` вместо раздельных PATCH | PGlite-сценарий подтверждает сохранение причины, отсутствие requeue и отклонение неизвестной причины | локально проверено; production не изменена |
| R1: безопасная диагностическая цепочка | status API возвращает раздел, стадию, номер попытки, request ID, причину, finish reason, время и ограниченные token counts; материалы, claim и конфигурация не выдаются | `generation-api.test.mjs`, `generation-runner.test.mjs` | локально проверено |
| M11: push открывает нужную заявку | service worker принимает только same-origin URL внутри scope, иначе использует корень приложения | `offline.test.cjs` | локально проверено |
| M12/R10: понятный маршрут и доступность | актуальные тексты облачной заявки/передачи Word; подписи полей; dialog semantics, focus trap и возврат фокуса | `desktop-layout.test.mjs` и статические safety-проверки | локально проверено |

Совокупный локальный `npm test`: 255/255, `git diff --check`: без замечаний.
Браузерные Chromium/WebKit-тесты локально не выполнены: загрузка движков завершалась
тайм-аутом. Миграция, Edge Functions и frontend не опубликованы; рабочая база и
пользовательские данные не изменялись; платных запросов не было. A1, восстановление
полного backup, загрузка материалов студентом и уведомление о готовности результата
остаются отдельными незавершёнными пунктами.

## 2026-09-17 — C-056: M2, материалы студента в заявке

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| M2: четыре категории материалов | поля задания, методики, данных и источников в форме заявки; PDF/DOCX/TXT до 5 МБ | `desktop-layout.test.mjs`, `request-attachments.test.mjs` | локально проверено |
| R9: изоляция и приватность | private Storage bucket; закрытая RLS-таблица; проверка владельца заявки или исполнителя в Edge Function | тесты чужого студента, роли исполнителя и статическая проверка migration | локально проверено |
| Целостность файлов | SHA-256 и размер проверяются клиентом и сервером; не более 8 файлов; база сериализует конкурентные вставки; cleanup при отказе метаданных | `request-attachments.test.mjs` | локально проверено |
| Материалы участвуют в подготовке без потери ручных данных | серверное извлечение текста; отдельные `attachmentMaterials`/`attachmentSources`, объединяемые `DraftQuality.inputs` | `draft-quality.test.cjs` | локально проверено |

Локальный полный набор после конкурентного ограничения и cleanup: Node 257/257;
специализированные проверки вложений 7/7. Браузерный набор локально не стартовал из-за
отсутствующих движков Playwright; их загрузка заблокирована сетью, поэтому он остаётся
обязательной проверкой GitHub Safety. Production, рабочие данные и бюджет этим
изменением пока не затронуты; платных запросов не было.

## 2026-09-18 — C-057: межраздельный контекст и лимит курсовой

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| R2/R4: подготовка не повторяет весь ранее созданный документ в каждом запросе | `studkab-generation/context.mjs` выбирает завершённые части только текущего `section_id`; runner читает `spec` части | `generation-runner.test.mjs`: другой раздел исключён, части текущего сохранены по порядку | локально проверено |
| R4: estimate соответствует фактическому контексту runner | `studkab-generation-api/handler.mjs` ведёт накопленные байты отдельно по разделам | `generation-api.test.mjs`: два раздела не начисляют контекст друг другу | локально проверено |
| Предел курсовой $0.25 и общий временный потолок не обходятся | серверные лимиты и RPC не менялись; многократные задания вместо одной работы не вводились | целевые 49/49; полный Node 259/259; `git diff --check` | локально проверено; production не изменена |

Рабочая попытка до исправления: заявка UAT-MGMT-01, заданию присвоено не было,
платный провайдер не вызывался, общий потолок после диагностики 500000, число заданий
этой заявки 0. Публикация обеих Edge Functions, повторный estimate и платная приёмка
остаются следующими действиями после проверки PR и разрешения на production.

## 2026-09-18 — C-058: точный расчёт без разрешения запуска

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| R1/R4: видеть точную причину денежной блокировки | estimate возвращает сумму, пределы и `canStart=false` | `generation-api.test.mjs`: сумма выше лимита доступна без RPC | локально подготовлено |
| R4: диагностический ответ не обходит денежный запрет | start использует тот же расчёт и возвращает `BUDGET_BLOCKED` | парный estimate/start сценарий | локально подготовлено |
| Понятный интерфейс без ложного приглашения к запуску | `reestr.html` показывает сумму и сохраняет кнопку в состоянии расчёта | browser Safety после PR | ожидает проверки |

## 2026-09-18 — C-059: оптимизация стоимости без сокращения документа

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| R2/R4: сохранить общий целевой объём и снизить повторную передачу контекста | `plan.mjs`: части до 3600 знаков вместо 2000 | `generation-api.test.mjs`: 10 частей и estimate не выше $0.25 | локально проверено; Node 262/262 |
| R7: не поручать модели составление библиографии | UI копирует предоставленные источники; API исключает `refs`, сохраняя совместимость со старой вкладкой | unit и browser-сценарий | unit пройден; browser ожидает GitHub Safety, локально нет Chromium |
| R4: платный запуск не нужен для проверки | только `estimate`, предел работы остаётся 250000 микродолларов | точный локальный расчёт из текущих материалов UAT-MGMT-01 | 195751 микродоллар ($0.195751), запас 54249; 10 частей; провайдер не вызывался |

## 2026-09-18 — C-060: служебная авторизация cron

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| R2: cron достигает серверного runner через JWT-защищённый gateway | `auth.mjs` не зависит от отдельной копии anon key; `verify_jwt=true`; закрытый `cron_token` остаётся обязательным | `generation-runner.test.mjs`; production HTTP 200 | опубликовано как `studkab-generation` v29 |
| R4: посторонний bearer не даёт доступ к claim или провайдеру | bearer проверяется gateway, затем handler сравнивает `cron_token` до операций | тест неверного/отсутствующего cron token | локально проверено |
| Платная контрольная попытка не обходит ограничения | существующее задание, максимум $0.25; новых заданий нет | 7 `done`, 3 `queued`, 0 промежуточных/unknown; runner вернул `status=budget` | частично выполнено; остановлено общим бюджетным потолком |

Семь завершённых попыток имеют `finish_reason=stop`; накопленный резерв проекта вырос
с 851902 до 1044123 микродолларов, то есть на 192221 микродоллар ($0.192221) для
этого задания. Три оставшиеся части провайдеру не отправлялись. Полное завершение
задания требует отдельного решения о доступном общем бюджете и не считается пройденной
приёмкой на основании частичного результата.

## 2026-09-18 — C-061–C-064: денежный журнал и полный UAT job

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| R4: единый проверяемый финансовый инвариант | `studkab_gen_expected_reserved`: несверенные резервы + все immutable retained; reconcile-функции используют его | legacy reconciliation без attempt; повторная сверка; совпадение production `reserved=expected` | опубликовано и проверено |
| R2/R4: estimate, runner и dispatch используют контекст текущего раздела | C-061/C-063; возвраты уменьшают effective per-job used | same-section и alias regression tests; production cron | опубликовано |
| R4: история не исчезает повторно | trigger запрещает DELETE attempts и изменение request/job/ordinal/reservation/started_at | PGlite DELETE rejection | проверено |
| R9: runner не читает закрытые основания сверок | `studkab_private.gen_job_released(uuid)` возвращает только агрегат; EXECUTE только `service_role` | проверка под `set local role service_role`; security advisor | проверено |
| Приёмка 1: одно существующее задание завершается сервером | job `d8f7069f-ddc4-455a-aae3-2aec005f27fe` | 10 done, 0 queued/other; 75435 байт, min 5029, blank 0, placeholders 0 | завершено |
| Бюджет не превышает $0.25 на работу | десять подтверждённых ответов сверены по token usage и пиковым ставкам | 10 reconciliations; retained 30144 микродоллара; общий `882046=882046` | подтверждено |

## 2026-09-18 — UAT-MGMT-01: выдача одной нефинансовой курсовой

| Проверка | Фактическое доказательство | Результат |
|---|---|---|
| Неизменяемая версия результата | request `a47632e9-ff30-426d-9e1a-91979667930f`; version `5867633f-7415-4d2d-ac1c-803c39e51b30`; SHA-256 Word `480884481f4b9a49ee47dfe7be3914bd872f7bf6a467062452b055e7acee435f` | подтверждено |
| Контроль перед выдачей | review `7aa51e22-8fda-4a60-98dc-d05ba756d61a`; документ открыт и редактируется в Microsoft Word; 31 страница A4, основной текст 26 страниц, 5 источников | подтверждено |
| Передача студенту | delivery `c376cc82-f073-44fb-aa61-d8cc56108fe1`, передано `2026-09-18T11:07:52.99523+00`, повторной выдачи нет | подтверждено |
| Получение в кабинете | после безопасного объединения резервных копий кабинет показывает обе работы; карточка результата сообщает передачу 18.09.2026 13:07:52 | подтверждено |
| Точность скачивания | файл, скачанный кнопкой «Скачать черновик Word», имеет SHA-256 `480884481f4b9a49ee47dfe7be3914bd872f7bf6a467062452b055e7acee435f` | точное совпадение байтов |

Эта проверка подтверждает сквозную выдачу одной нефинансовой курсовой по конкретной
заявке. Она не заменяет A1.1–A1.5, FIN-UAT-01, ВКР, ручной пилот антиплагиата или
определение тарифа по трём полным приёмкам.

## 2026-09-18 — C-065: доказательная карточка источника

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| R7: источник имеет проверяемое основание | `sourceEvidence`: реквизиты, фрагмент и подтверждаемое утверждение для каждого `[S#]` | позитивный и три негативных модульных сценария | локальная реализация |
| R8: формальная метка не разрешает передачу | ошибки карточки входят в `sourceCheck`, который блокирует переход к итоговой проверке | полный Node и browser Safety | ожидает выполнения |
| Не выдавать автоматическую проверку за факт | интерфейс требует ручной проверяемый фрагмент; функция проверяет структуру, а не истинность | текст интерфейса и change record | локальная реализация |

## 2026-09-18 — C-066: явные статусы итоговой проверки

| Требование | Реализация | Проверка | Фактический статус |
|---|---|---|---|
| R5: результат каждого критерия выбран явно | `results-ui.js`: `pass`, `fail`, `manual`, `not_applicable` вместо неявного `pass` | DOM/browser сценарии и серверные unit-тесты | локальная реализация |
| R8: ошибка и незавершённая ручная проверка блокируют передачу | клиент останавливает выдачу; API принимает только `pass`/`not_applicable` с доказательством | негативные API/DOM сценарии | локально проверено |
| R8: клиент нельзя обойти прямым запросом | `studkab_valid_review` проверяет допустимый статус и доказательство для всех 16 пунктов | migration integrity; полный Node 264/264 | ожидает CI и установки |
# C-069 — единый маршрут заявки исполнителя, локальная реализация 2026-09-18

R3/R5/R8/R9/R10, M2–M10/M12. На основании пользовательской проверки
UAT-MGMT-01 зафиксирована спецификация `REQUEST_WORKFLOW_SPEC.md`. Добавлен единый
вычисляемый маршрут из пяти этапов; реестр показывает фактический этап и блокер;
карточка использует номер и тему как основной заголовок, одну шкалу этапов и одно
следующее действие. Ручной статус удалён из рабочего блока; заметки и удаление
отделены от маршрута. Наличие текста больше не называется готовым результатом,
а существующий server job не скрывает обязательную проверку качества.

Модуль `request-workflow.js` покрыт отдельными сценариями всех этапов, включая
регрессию «server job + готовый текст → проверка качества». Полный локальный Node
набор: 267/267, без платных запросов и изменений базы. Попытка браузерного набора
не дошла до приложения: Playwright Chromium отсутствует, загрузка браузера прервана
сетевым тайм-аутом. Поэтому визуальная/browser-приёмка, commit, PR и публикация
пока не подтверждены. Рабочие данные, Supabase и GitHub Pages не изменялись.

## C-070 — реестр и карточка исполнителя, 2026-09-19

R9/R10. База ветки ui/registry-workspace — main 1088c5d83e7c7c58316efe1f9a0f81bf78e8e44b.
Реализация: reestr.html (один предикат отбора, номер, 25/50, возврат списка,
шесть вкладок и основное действие из RequestWorkflow), desktop.css (композиция
и узкий экран), согласованная версия CSS в двух HTML и sw.js. Серверные модули,
данные, роли, бюджет и протокол выдачи не изменены. Вкладки сохраняют несохранённую
заметку в DOM; запись происходит прежней кнопкой. Повторная проверка новой версии
после прошлой передачи остаётся доступна. Не реализованы отдельная серверная
фиксация итоговой проверки/последующая передача и общая история выданных Word.

Фактические проверки до PR:
- npm ci — успешно; npm test — 267/267, плюс обязательный pretest вложений.
- Chromium 153, Playwright 1.63: 63/63 браузерных сценария без двух отдельно
  запускаемых mobile-nav (Chromium/WebKit требуют стандартных browser binaries).
- 7/7 целевых сценариев C-070 повторены после визуальных корректировок: 67 записей,
  страницы 25/50, поиск номера, общие счётчики, возврат/фокус, сохранность JSON,
  несохранённая заметка, смена аккаунта, единое действие и повторная проверка,
  ширины 320/390/768/1440, три существующие темы. Это локальный стенд с mock cloud,
  а не приёмка на двух реальных аккаунтах. Платные AI-вызовы не выполнялись.
- Визуально просмотрены реестр 1440 и карточка 390; длинные темы ограничены тремя
  строками, целиком доступны в Обзоре. Вторичный текст новых блоков затемнён.
- git diff --check — без ошибок. Полный screen reader и реальный iPhone не проверены.

Открытые PR просмотрены: #71 пересекается с карточкой, #69 — с формой, #91 —
со сверкой базы; они не включаются в пакет. Остальные открытые цепочки также
не объединяются. GitHub Safety/SQL replay/WebKit и публикация на момент записи
не подтверждены. До успешного CI и отдельного подтверждения пользователя
не объединять и не публиковать. Откат — revert C-070 без удаления записей.

## C-070 — подтверждённая публикация, 2026-09-19

PR #111: проверенный head 1884002c035b84b18899a4153281c0a223fe70c0,
Safety 35441694282 — success (267 Node, SQL safety, A1, migration replay,
65 browser включая Chromium/WebKit mobile navigation). После разрешения
пользователя объединён squash в main bc079269c68bc737cabe32bf590a7369b12d5cba.
Pages 35443192942 — success. Шесть опубликованных файлов получены по HTTPS
с проверкой сертификата, HTTP 200 и совпадением байтов с проверенной версией.
Прямой public Chromium smoke не завершён: ERR_EMPTY_RESPONSE, затем
ERR_CERT_AUTHORITY_INVALID через доступный proxy; проверка сертификатов не
отключалась. Это не приёмка на физическом телефоне или двух реальных аккаунтах.

## C-071 — отдельное сохранение итоговой проверки, 2026-09-19

R3/R8/R9. results-ui.js разделяет review и deliver; закрытие окна/перезагрузка
восстанавливают неизменяемые файл и протокол через executor-only result-review-state.
reviewContext связывает проверку с документом, получателем и актуальным паспортом.
Миграция 20260919124300 усиливает существующий INSERT-триггер и атомарно добавляет
читающий capability marker; без него новый маршрут заблокирован. Новых таблиц,
платных запросов, изменений рабочих данных и установки в production нет.

Проверки: полный локальный Node-набор до последней проверки capability marker —
271/271; полный локальный browser-набор без двух standalone mobile-nav — 70/70.
После добавления маркера целевые API+SQL — 27/27, browser results — 11/11.
Сценарии: save не вызывает deliver; точные байты; отдельная передача; потерянные
ответы review/deliver; восстановление после закрытия и полной перезагрузки;
изменение документа/паспорта/получателя/аккаунта; повреждённые байты; отказ студенту;
устаревший паспорт блокируется SQL; неизменяемость/идемпотентность/закрытые права.
Браузер использует mock endpoint, SQL — PGlite. Это не рабочая приёмка.

Порядок установки, синтетическая приёмка и откат: docs/C071_DEPLOYMENT.md.
CI, установка миграции/Edge/frontend и проверка двух тестовых аккаунтов на момент
этой записи ещё не выполнены. Обязательные приёмки TASK.md и оставшиеся этапы
QUALITY_RELEASE_PLAN.md сохраняются; этот пакет не является полным выпуском MVP.
Финальный локальный повтор после всех изменений: npm test — 272/272;
browser results — 11/11. Экран сохранённой, но не переданной проверки визуально
просмотрен при ширине 390 px; кнопка передачи и статус видимы без перекрытий.

## C-072 — обновление истории передачи существующих заявок, 2026-09-20

Основание R3/R8/R9 и REQUEST_WORKFLOW_SPEC. По read-only проверке production
заявки №6 UAT-MGMT-01: четыре вложения, 10/10 готовых частей, утверждённый паспорт,
16 допустимых критериев, сохранённая передача 18.09.2026 и совпадение SHA-256 Word.
Экран не объяснял связь этой передачи с текущим документом. Дополнительно выявлены
неразрешённые различия источников (10 в задании / 5 в паспорте) и срока (30/17 октября).
Этот пакет не меняет эти требования и не объявляет содержательную приёмку завершённой.

Реализация: inbox по includeDeliveryState возвращает последнюю передачу и дату
сверки, только исполнителю. Обновляются метаданные существующих заявок, не их
документы/заметки/паспорта. Старый endpoint не стирает известную историю. Ошибка
чтения не считается отсутствием выдачи. Строка, карточка и история показывают
прежнюю передачу отдельно. Local status=sent больше не доказывает готовность
текущей версии: подтверждение фиксируется после проверки точной версии сервером
и теряет силу при изменении контекста. История не является разрешением новой выдачи.

Независимый ИИ-разработчик проверил diff: блокеров сохранности не обнаружил;
рекомендованные проверки смены аккаунта и изменения документа добавлены и пройдены.
API tests 28/28; целевые browser (реестр и результаты) 21/21. Browser использует
синтетические данные и mock API. Скриншот 390px просмотрен; это не полная приёмка
удобства. SQL/данные/бюджет не изменялись, платные вызовы не выполнялись.
На момент записи публикация пакета и полная production-приёмка не выполнены.
Остались общая мобильная компоновка, сверка противоречивых требований и TASK.md.


## C-076 — повторные обозначения источников, 2026-09-20

R7/R8/R9 → draft-quality.js, cache studkab-v65-source-cards.
В рабочей заявке №6 обычные упоминания S1–S5 во вложении перезаписывали
заполненные карточки: получались 15 ложных замечаний. Структурированная карточка
теперь имеет приоритет над обычным упоминанием независимо от порядка.
Различающиеся структурированные карточки блокируются; неполные карточки не
объединяются в вымышленные полные. Исходные вложения сохраняются.
Проверки: 43/43 целевых, полный npm test 290/290. Минимум источников
и серверные ограничения не ослаблены. Публикация и проверка рабочего интерфейса
на момент этой записи ещё не выполнены. Содержательная приёмка документа не закрыта.


## C-077 — исправление заполненного паспорта, 2026-09-20
R3/R5/R8/R9. На заявке №6 кнопка «Новая версия» открыла пустую форму:
редактор показывал только пункты со словами «не указано». Это мешало исправить
ошибочное снижение минимума источников с 10 до 5. Новый режим показывает все
заполненные пункты и требует основания изменения. Уточнение только пропущенных
полей сохраняется отдельным действием. Используется прежний passport-save,
новая версия остаётся черновиком до отдельного утверждения; история не стирается.
Альтернатива прямой правки базы отклонена: исправляется штатный рабочий путь.
Данные, серверные права и бюджет не меняются. Проверка: реальный сценарий
создания новой версии из заполненного паспорта, сохранность полей и отсутствие
автоутверждения, обязательный CI, рабочая проверка после публикации.
Откат: revert и новая версия кеша. Публикация на момент записи не выполнена.

## C-078 — локальная проверка Word MGMT-02, 20.09.2026
R5/R7/R8/R9 → result-docx.js, draft-quality.js, reestr.html и cache.
По фактическому экспорту предыдущего этапа воспроизведены отсутствие разрывов,
оторванная подпись таблицы 4, порядок приложений и несовместимость [1]/[S1].
Исправлены разрывы обязательных разделов по умолчанию, keepNext подписи/шапки,
явная перестановка разделов/добавление приложения и однозначное сопоставление
числовых ссылок с карточками через библиографию. Несопоставленные и неоднозначные
записи по-прежнему блокируются. Подлинность источника автоматически не заявляется.

Первый полный Node-прогон: 293/293 и 11/11 pretest. После дополнительной проверки
нулевого ориентира целевые draft-quality/requests: 66/66. Добавлен browser-сценарий
перестановки и сохранности текста; полный обязательный CI ещё должен подтвердить
интеграцию. Локальный рендер MGMT-02: 31 страница, основной текст 3–28 (26 страниц),
библиография29, приложения30–31. Главы начинаются6/15/21, заключение26; содержание
совпадает с фактическими началами. Подпись и таблица4 на странице23.

В тестовом комплекте сохранён минимум10; добавлена его однозначная формулировка.
Ориентир главы1 исправлен6→9 по подготовленной структуре; для приложений ориентир
не задаётся. Это настройки синтетического кейса, не ослабление требований всех
заявок. Устаревшая запись контрольного листа о прежних страницах заменена ссылкой
на протокол точного экспорта. Текст исследования и числа не менялись.
Автоматические блокеры/замечания на этом входе:0/0. Независимая приёмка и
антиплагиат не пройдены. Публикация и повтор в рабочем браузере пока не заявлены.


## C-078 — публикация и повторный экспорт из приложения, 20.09.2026

PR #120 объединён: `25a52c05a7dca9d80bf8b4e59b146c868d2f55e7`.
Safety run 35501080045 на `df1092bd6c352c0a93e9630b42104caa94d37867`: success,
294 Node, 11 pretest, 81 browser; SQL, A1 fault injection и isolated migration replay прошли.
Pages run 35501391231: build/deploy/report success. Публичные reestr.html,
draft-quality.js, result-docx.js и sw.js побайтно совпали с проверенным пакетом.

В рабочем браузере открыта та же ручная заявка MGMT-02. Изменены только её
ориентиры и служебная запись приложения Б, уточнена формулировка минимума 10,
источники переставлены перед приложениями штатными кнопками. После перезагрузки
сохранены все восемь разделов, точные тексты и порядок. Бесплатная проверка:
автоматических блокеров/замечаний 0/0; распознано «Не менее 10 источников».
Ручная приёмка в интерфейсе остаётся обязательной и не отмечена выполненной.

Точный скачанный `MGMT_02_C078_app_export.docx`: 189904 байта, SHA-256
`d12a5963185c5cabca34a498df5a25c055f130820033ed103028ca5047012846`.
Файл побайтно совпадает с локальным экспортом, отрендеренным в LibreOffice:
31 страница; основной текст 3–28, то есть 26 страниц; источники 29, приложения
30–31; главы 6/15/21; заключение 26; подпись и таблица 4 вместе на странице 23.
Все 31 изображения финального рендера совпали с визуально просмотренным набором.
Семь таблиц сохранены; в седьмой исправлены только две служебные ячейки
о прежней пагинации. Исследовательские числа не менялись.

Граница результата: ручное редактирование, сохранение в том же браузере,
проверка и Word. Серверная генерация/выдача, независимая содержательная приёмка,
проверка в Microsoft Word и антиплагиат этим этапом не закрыты. MGMT-02 — учебный
синтетический кейс (пять синтетических и пять реальных источников). Платных
запусков и передачи студенту не было; историческая заявка №6 не редактировалась.

## C-080 — повторная отправка, 21.09.2026
R3/R9 → index.html, reestr.html, studkab-requests, shared/source-minimum,
20260921050532_c080_request_resubmission.sql. Ветка от main 89a812c.
Локально целевой набор 53/53; окончательный полный Node-набор 308/308,
отдельный обязательный attachment pretest 11/11.
Дополнительно проверены обработка отказа серверного сохранения, перенос изменения
в реестр без потери заметок/документа и удаление нового журнала при C-079.
Добавлен browser-сценарий повторной отправки и замены файла; CI/браузерная и
производственная приёмка ещё не подтверждены. Установка не выполнялась.
Границы и порядок публикации: docs/C080_REQUEST_RESUBMISSION.md.

### C-080 — CI и потеря ответа загрузки
Safety 35564269750: Node, SQL safety и A1 прошли; replay остановился после
применения миграций на устаревшем ожидании 22 таблиц вместо 23. Список обновлён
с явной проверкой новой таблицы и прав update RPC; проверки RLS не ослаблены.
Дополнительно устранено удаление уже сохранённых байтов при потере ответа
INSERT: перед очисткой нужна успешная проверка отсутствия metadata.
Целевой Node/PGlite набор после изменения: 19/19, включая два сетевых отказа.
Браузерная проверка в первом CI пропущена из-за replay, успех не заявлен.

## C-081 — паспорт и читаемость, 21.09.2026
R5/R7/R9/R10 → requirements.mjs, reestr.html, sw.js. Явный общий объём и
помеченные источники из rq/mn; при конфликте заглушка сохраняется. Дополнение
существующего draft отдельной версией только вместо точных стандартных заглушек.
Утверждённые и ручные пункты не перезаписываются, история сохраняется.
Паспорт расположен первым, длинные пункты и исходные сведения раскрываются;
повторный красный список и панель отсутствующей передачи убраны.
Локально: npm test — 311/311 и attachment pretest 13/13; целевой паспорт 9/9.
Локальный browser запуск не выполнил сценарии: отсутствует бинарник Chromium.
Добавлены проверки 390/1440, полного текста, клавиатуры, неизменности данных и
блокировки утверждения. Обязательный CI и публикация пока не подтверждены.
Оригинальность не выдумана, AI-запусков нет. Исходные данные не удалялись.

### C-081 — проверка и публикация
PR #124, head ab9bd7249f9439cd2a6a558f09a14ea685e1181b:
Safety 35602359448 успешно — 311 Node + 13 attachment pretest,
84 browser, SQL safety, A1 и replay миграций. Первый browser-прогон выявил
потерю видимой отметки прежней передачи: исправлено, повторный прогон зелёный.
Снимки компактного/раскрытого паспорта 390/1440 просмотрены; проверены
клавиатура, отсутствие горизонтального переполнения и сохранность полного текста.
Merge f084703363c4982a732518405b8070461df7c125.
Deploy requests 35603002017: установлен v39, requirements.mjs побайтно совпал
с проверенным исходником. Pages 35602998203 успешно опубликован;
после перезагрузки публичной страницы подтверждён новый код компактного паспорта.
Проверка выполнена без платных вызовов и без прямой правки рабочих записей.
Завершение приёмки существующего паспорта: пользователь нажимает «Обновить»
в своей авторизованной заявке; это вызывает штатный passport-ensure.
Результат этого действия пока не подтверждён. Полная приёмка TASK не закрыта.

## C-082 — смысловое разделение требований, 21.09.2026
Предоставленные пользователем скриншоты подтвердили C-081: версия 2, заполненные
объём/источники и сохранённый исходник. Осталось смысловое дублирование методички.
R5/R7/R9/R10 → semanticRequirements/defaultPassport/fillMissingDraft:
явный список разделов отделяется от методических указаний, числовые расхождения
не интерпретируются автоматически. Только точные старые автокопии в draft
заменяются новой версией. Исходная заявка и ручные/утверждённые поля сохраняются.
Оригинальность явно «порог не задан, проверка не проводилась»; обязательность
и блокировка утверждения сохранены, тестовая надпись не даёт исключения.
Целевые проверки: 12/12 Node; добавлены browser 390/1440 с полным исходником
и недоступностью утверждения. CI и публикация этой версии пока не подтверждены.

### C-082 — CI, публикация и применение
PR #126, head 6d792cfc2ac2c44f3067cd7c084d48a969aaac6f:
Safety 35605308267 успешно (314 Node, 13 attachment pretest, 86 browser,
SQL safety, A1, replay). Снимки 390/1440 просмотрены, полный исходник доступен.
Merge c771d6ccba1e9b5b5e274e0d70f798655b7c13db.
Deploy requests 35606089841 и Pages 35606088932 успешно.
Requests v40: requirements.mjs побайтно совпал с проверенным исходником.
Для согласованной тестовой заявки создан draft v3 штатной версионной RPC:
перед записью проверены неизменность payload/items/fingerprint, последняя версия
и принадлежность автора действующему исполнителю; запрос заблокирован на время
операции. Изменены только STRUCTURE/METHODOLOGY/ANTIPLAGIARISM, без утверждения.
Повторное независимое чтение подтвердило равенство исходной заявки и v2 прежним
значениям, точное соответствие v3 подготовленным пунктам и сохранение трёх версий.
Платные вызовы не выполнялись. Порог оригинальности и проверка не выдуманы;
утверждение остаётся заблокированным. Пользовательский экран после загрузки v3
ещё не подтверждён; полная содержательная приёмка работ не закрыта.

## C-083 — внешний Word, реализация
R3/R5/R8/R9 → ограниченный разбор DOCX, отдельный результат без замены редактора,
точные байты и новый контекст по хешу файла, прежний протокол/паспорт/права.
Локально npm test: 318/318, pretest вложений: 13/13. После добавления отдельного
сценария маршрута запущены external-word + request-workflow: 7/7.
Проверена неизменность исходного MGMT02 Word при чтении, извлечено 47515 символов.
Браузерные сценарии добавлены, но локально не выполнены: загрузка Chromium
завершилась сетевой ошибкой. Содержательная проверка и антивирус не подменяются
ограниченной структурной проверкой DOCX.
GitHub: создана только пустая feature-ветка c083-external-word от main c771d6c.
Автоматическая проверка разрешений отклонила create_tree: требуется явное
разрешение пользователя на отправку кода в innaodincova-finpro/studkab.
Код не загружен; PR/CI, публикация и сквозная приёмка не выполнены.
Тестовая заявка не изменена, Word студенту не передан. Утверждение паспорта
и протокол проверки сохраняются обязательными.

C-083: пользователь явно разрешил отправку кода 21.09.2026. Изменения загружены
в feature-ветку, commit a2e5d6beaa5e5493e25151508bdc745b9d175722.
Draft PR #128: https://github.com/innaodincova-finpro/studkab/pull/128
Safety run 35613802704 запущен; публикации и передачи результата не было.

C-083 CI завершён успешно: run 35613802704, job 106379272479, head a2e5d6be.
319 Node-тестов, 13 attachment pretest, 90 browser-тестов; SQL safety, A1
и replay миграций успешно. Рабочая публикация и сквозная приёмка не выполнены.

C-083 опубликован по явному разрешению пользователя: PR #128 merged,
merge 7c216919beda82825fc6831c78974c92087214ee. Pages run 35614932660 и
Deploy requests run 35614934618 — success. Requests v41 ACTIVE, изменённые
results.mjs и shared/external-word.mjs побайтно совпадают с проверенным кодом.
Публичные reestr.html и results-ui.js побайтно совпали с локальными.
Производственная передача студенту не выполнялась; паспорт тестовой заявки
не утверждался, содержательная приёмка не закрыта.

## C-084 — уточнения и серверное утверждение, локальная реализация
R3/R5/R7/R8/R9/R10 → clarifications.js, Edge clarifications.mjs, миграция C084,
редактор паспорта: отдельный вопрос/ответ, основание, явная проверка и answer_ids.
SQL не разрешает утверждение пропущенных/непроверенных требований, старой версии,
неотвеченных вопросов и ответов без привязки к проверенному пункту. Повторы не дублируются.
Локально npm test 325/325 + pretest 13/13; SQL PGlite и Edge с проверкой ролей.
Browser 390/1440 и редактор добавлены, локально не выполнены из-за загрузки Chromium.
Протокол и порядок SQL → Edge → frontend: docs/C084_REQUIREMENT_CLARIFICATIONS.md.
Рабочая установка, browser CI и производственная приёмка не подтверждены. Полный
обмен подтверждающими файлами и внешние уведомления не реализованы этим изменением.

C084: создание коммита GitHub отклонено автоматической проверкой разрешений.
Коммит в GitHub и PR не созданы; установка в рабочее приложение не выполнена.
Для продолжения запрашивается разрешение только на черновой PR в innaodincova-finpro/studkab.
Браузерные проверки остаются невыполненными: Chromium отсутствует, загрузка завершилась timeout.

## C085 — исправление прав C084, подготовка
R3/R8/R9: рабочая read-only проверка подтвердила SQLSTATE 42501 в проверке автора.
Добавлена миграция SELECT(id,email) для service_role и тест исходного отказа.
Существующие сценарии вопроса, ответа, повторов и утверждения переведены на
service_role. Результаты проверок и публикация фиксируются отдельно ниже.

C085 локально: npm test 326/326, pretest вложений 13/13, без пропусков.
Целевые SQL-проверки 3/3 под service_role. Исходный отказ воспроизведён до
применения миграции; после применения проверки сохранения и доступа пройдены.
CI, установка миграции и повторный живой браузерный сценарий ещё не выполнены.

## C-086 — паспорт в запросе подготовки, 22.09.2026
R3/R5/R7/R8/R9 → draft-quality.js passportContext/context/sectionRules,
reestr.html cache v13, sw v74. Актуальный утверждённый паспорт передаётся
в sectionPrompt с revision/id/текстами/основаниями. inputs и fingerprint
исходных материалов не изменяются; draft/stale не используют прежнее утверждение.
Рекомендации следуют количеству в задании, аналитическая глава не навязывает
финансовые показатели. Тест исполняет фактические buildPrompt и sectionPrompt
из реестра на педагогике, менеджменте и истории; проверяет текст, версии,
основания, отсутствие мутации и повторное получение изменённого условия.
Локально: npm test — 327/327, pretest вложений — 13/13, без пропусков;
git diff --check — чисто. Main сверена: fa7b65d6da79f1d35751614f162675e033bf1035,
исходное дерево локальной работы совпадает с main. Платных запросов нет.
Установка/CI/реальная приёмка качества ещё не подтверждены. Ориентиры страниц
и оставшиеся критерии общего выпуска этим изменением не закрываются.
