# STUDKAB — соответствие GitHub и production

Срез: 2026-09-12. Production: Supabase `dcpthwmuiodrjepifzsd`
(проект «Точка дня», регион `eu-west-1`, PostgreSQL 17.6.1).
Исходный production commit для сверки GitHub: `ddb3703208c4155b59c1a50212ca7189dda69c8e`.
Ветка исправления зависит от PR №44 и не меняет production.

## Edge Functions

| Функция | Production | JWT | Файлы после исправления | Результат |
|---|---:|---|---:|---|
| studkab-push | v13 | false, собственная авторизация | 2/2 | точное совпадение |
| studkab-telegram | v14 | false, webhook/setup guards | 2/2 | точное совпадение |
| studkab-requests | v16 | false, собственная Auth-проверка | 4/4 | точное совпадение |
| studkab-cloud-check | v12 | true | 1/1 | исходник восстановлен из production |
| studkab-generation | v17 | true | 5/5 | точное совпадение, включая окончание файла |
| studkab-generation-api | v19 | true | 3/3 | точное совпадение, включая деление по 2000 |

Production bundle SHA-256:

| Функция | SHA-256 |
|---|---|
| studkab-push | `76cf70ea77c94a39b486a3742c3bf141f780ee965ad3a7724f2260e10bbefe1c` |
| studkab-telegram | `70a5e696c59deeddc263555e86133ff1e383170c5726560ad0a5dde4fe9d82c9` |
| studkab-requests | `d142b47875be9ca4c6201a76e8516f53e6ac20c59382e615828f074152f103b8` |
| studkab-cloud-check | `51c33409dea9c457f2813931ed3b49b7c7341d89b86066f4a36ebcf70cea3620` |
| studkab-generation | `fd11c267b3de5e08d91fa3f0359eb89a19e37d2c6850896930dea46a62cbf5a3` |
| studkab-generation-api | `fcd2774129b06f118a8929155235544ef8396f221c87beaf6a86013258edcd23` |

## Исправленные расхождения

| Файл | Было в GitHub | Production | Исправление |
|---|---|---|---|
| `studkab-generation-api/plan.mjs` | `Math.ceil(target/6000)` | `Math.ceil(target/2000)` | восстановлен production-код |
| `studkab-cloud-check/index.ts` | отсутствовал | v12, HTTP 410 disabled check | добавлен точный исходник |
| два `index.ts` generation | лишний завершающий LF | без LF | побайтово выровнены |
| `tests/generation-api.test.mjs` | закреплял границу 6000 | production 2000 | ожидания изменены на 2000/2001 |

## Миграции — блокер Этапа 4

В production зарегистрировано 17 миграций. В исходном GitHub `main` найдено
3 SQL-файла. Имена и версии также не полностью совпадают: например production
содержит `20260912094701_studkab_versioned_delivery`, а файл GitHub имеет имя
`20260912091822_studkab_versioned_delivery.sql`.

Этот PR не восстанавливает историю миграций и не применяет SQL. Повторно применять
production-миграции запрещено. Полное сопоставление и восстановление файлов относится
к Этапу 4 и выполняется сначала на чистой тестовой среде.

## Границы доказательства

Точное совпадение исходных файлов означает воспроизводимость текущего кода Edge
Functions, но не подтверждает корректность бизнес-логики, секретов окружения,
расписаний, схемы или пользовательскую приёмку. Значения секретов не читались и
не записывались. База, cron, бюджет и production-функции не изменялись.

## Проверка и откат

Проверки:

- повторное сравнение: 17/17 уникальных production-файлов совпали точно;
- тесты границ 2000 и 2001 знак пройдены;
- полный `npm test`: 132/132 пройдено, 0 ошибок;
- Safety workflow PR проверяется отдельно;
- отсутствие посторонних файлов и `git diff --check`.

Откат: закрыть PR или отменить его commits. Production не требует отката, поскольку
на этом этапе он не изменялся.
