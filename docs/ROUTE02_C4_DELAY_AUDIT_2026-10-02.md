# STUDKAB — аудит задержки ROUTE-02-C4, 02.10.2026

## Актуальное дополнение после публикации

Пакет опубликован: PR205/bcc21d9, дерево e9a36a04938b026df490b760ed9e8955506d9667.
CI36964990828 success: 194 browser, 653 Node, SQL safety, native registered
concurrency, остальные native/A1 и replay. Документы PR202/be7d0fb: CI36965025398
success. Автоматический блок публикации снят после явного разрешения владельца.
Ни merge, ни production-установка, ни реальная смысловая приёмка не выполнены.

Дополнительный цикл unknown → отдельно опубликованный follow-up → sufficient
проверен локально: 1/1 pass; включён в registered-analysis.test.mjs. CI этого
тестового дополнения отслеживается отдельно. Нижележащие записи и SHA256 —
исторический снимок пакета до публикации, а не текущие хеши изменяемых документов.

## Установлено до публикации

Последняя опубликованная версия PR205/e71f6ce успешно завершила CI36956789382.
После неё подготовлена локальная доработка whole-kit review и оценки ответов.
Она найдена в сохранённой рабочей папке проекта вместе с журналами; прежнее
утверждение ассистента об их недоступности было ошибочным.

В раннем route02-kit-current.log тест пытался изменить завершённый результат
и получил TERMINAL_INTAKE_ANALYSIS от защиты неизменяемости. Последующие
адресные прогоны проходят. Это не доказательство сбоя рабочего приложения.
Задержка опубликованного результата: новая доработка не опубликована;
в переписке зафиксирован отказ автоматического контроля публикации обновлённых
документов, требующий отдельного разрешения на полное публичное содержимое.

## Фактическая повторная проверка найденного кода

- Полный последовательный Node/PGlite: 653/653, fail/cancelled/skipped 0,
  длительность 310293 ms; журнал /tmp/studkab-c4-complete-0650.log.
- Адресные registered-analysis и registered-kit-review: 29/29,
  fail/cancelled/skipped 0; /tmp/studkab-c4-audit-0648.log.
- Browser focused: 6/6, телефон 390 и компьютер 1440;
  /tmp/studkab-c4-browser-recovered.log. Первый повторный запуск не мог найти
  ожидаемый browser executable; восстановлен доступ к существующему Chromium
  через отдельный временный browser cache, без изменения конфигурации проекта.
- Vite build: pass; /tmp/studkab-c4-build-0650.log.
- История миграций/change-process: 5/5; git diff --check и JS/Python syntax pass.

Это локальные технические проверки, с синтетическим поставщиком, без оплаты,
публикации, merge, productionDDL или предметной приёмки модели.
Нативные независимые PostgreSQL-транзакции, полный browser/SQL/replay CI нового
head остаются обязательными после публикации. Локально PostgreSQL отсутствует.
Этап C целиком и выпуск приложения не объявляются завершёнными.

## Следующий конкретный переход

Публикация подготовленного пакета в публичный innaodincova-finpro/studkab,
обновление draft PR205, единый штатный CI. До merge все обязательные проверки
должны пройти. Установка и приёмка сохраняют отдельные статусы.
Разрешение публикации не разрешает оплачивать синтетические проверки,
увеличивать бюджет или обходить допуск качества.

## Полный состав подготовленного пакета

24 файла до добавления этого отчёта; вместе с отчётом — 25 файлов.
Секреты, node_modules, dist, supabase/.temp и test-results в пакет не входят.

- .github/workflows/safety.yml — SHA256 ff3c950bb71dc19ae8210833f06284c2569bc9ccc29bd42221ffb8432d248e89
- CHANGE_CONTROL.md — SHA256 a06eecb70778c594c49e46f897cc5d53fda1114c8570b89b3ad03b5ba064f664
- EXECUTOR_ASSISTANT_SPEC_1_1.md — SHA256 c76c52d7be1d1496adae16bce6d58880d24fdb2177cea7e32c33a806d9e8e89a
- MVP_RELEASE_BASELINE.md — SHA256 ca111aff7b9e5a06d0302d04d329b438db50e4646f578725272f215f92e18f38
- PUSH.md — SHA256 de78a4dc59a9a8f931a8982f6c3c54c6aac34efa6b761d433dc919b3f397f6a3
- QUALITY_RELEASE_PLAN.md — SHA256 d14a3374d31f7f9b8dd3b134702b140a5356c5c25f02454272ebe6a628cb7ff5
- REQUEST_WORKFLOW_SPEC.md — SHA256 8c5d33ab0ee6fff84bc2c877bd0e8d9ba285cf952973c533741b4f737565416e
- TASK.md — SHA256 3aeed60ebaa20b24f5b47f803c4f393de0c4850d3745158a5e5848cbe0c73e44
- TELEGRAM.md — SHA256 28c5427b925decff706c83ef9b96640c8159a14b75be3ba2c6ff070953cac37f
- TRACEABILITY.md — SHA256 f24084d97cf5111a885203978a49d0e8ecb44d9b385097362d3a359b3cac2ff8
- docs/DOCUMENT_FIRST_INTAKE_PLAN.md — SHA256 c2604c46e0fb3c734c6e5c6321fa54ac5593e1da27c9e46f5c7fd36592cb60c2
- package.json — SHA256 7d3aea0e10326c9394b82c1b1f6cb912ad062e40351c8350f8e8f1d9ad52bbb3
- registered-study.js — SHA256 4f9bb1f2597500043ba544352108b48ce5c9374508992b1d9f1c808d6c25bb4e
- supabase/functions/studkab-generation/intake-runner.mjs — SHA256 39a0746b1bdb9584a30e41656da285a0c9eb83f9377077e29ac1ce6b4104459f
- supabase/functions/studkab-generation/registered-analysis.mjs — SHA256 2c52422e05699c7606bfe9a99da596d00c9d1a9e5a396e15eb8f9c08b9e87479
- supabase/migrations/manifest.json — SHA256 9c1d94419308e472682277d9847ce6d80ae58e9acc3ad48718ef24b2c0ea167e
- tests/browser/registered-study.spec.cjs — SHA256 22eaafe88c61154e4f4302434f39fcc5c1ce83588a5227149171229fe2cfbd00
- tests/registered-analysis.test.mjs — SHA256 ca1375f3d107a5417de149dad2e08b6138eec284b31e1017235cd7c3212f8971
- tests/supabase-replay.sql — SHA256 ec9a29e75141a7c95c3ba9302ef2aafbfcc71e90ecab4a0f96dec510ba6c212e
- docs/APPROVED_REQUEST_ROUTE_2026-10-01.md — SHA256 9103ab6c16da3676ede288c4b4929c91dca56cb32ddd8a56ff9a269826b7c7f6
- supabase/functions/_shared/registered-review.mjs — SHA256 0ba0a333be39ddc2ec31e597264abdc0fe73c2da5a6a96bf27d5cca63e70f8ee
- supabase/migrations/20261002031300_route02_kit_review.sql — SHA256 0edc16ea62b59a0ad3bd3371ae4e913931070dadc9bc6e3119549ccec9dc4c39
- tests/registered-kit-review.test.mjs — SHA256 1eb4f3aeee0cbe3a1bf78cfc1425d53a6bed72be53b3973882c2fb813777c8b3
- tests/registered-study-concurrency.py — SHA256 a90b0d69620cb8d1551d675264d514290909c5f119d30f073cde3b8e4c085f84
- docs/ROUTE02_C4_DELAY_AUDIT_2026-10-02.md — настоящий отчёт.
