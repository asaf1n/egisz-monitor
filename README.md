# egisz-monitor

Локальная платформа мониторинга интеграции МИС с сервисами ЕГИСЗ/РЭМД. Backend загружает журналы обмена из Firebird, нормализует их в PostgreSQL и формирует единый аналитический слой для dashboard и Metabase.

## Состав

- Backend на `Node.js` / `TypeScript` с ETL и runtime-миграциями PostgreSQL
- PostgreSQL 15 с таблицами `dim_clinics`, `dim_services`, `fact_transactions`, `egisz_errors`
- Frontend на `React` / `Vite`
- Metabase для ad-hoc аналитики и продуктовых отчётов

## Локальный запуск

1. Скопируйте [`.env.example`](/C:/Users/artem/egisz-monitor/.env.example) в `.env`.
2. Для локальной работы используйте стандартные значения:
   - `DB_USER=egisz`
   - `DB_PASSWORD=egisz`
   - `MB_DB_USER=metabase`
   - `MB_DB_PASS=metabase`
3. Запустите `docker compose up -d --build` или `./start.ps1`.

Важно для существующего `pgdata`:

- переменные окружения не переопределяют уже созданных пользователей PostgreSQL;
- если volume был инициализирован с другими учётными данными, `backend` и `metabase` будут получать `password authentication failed`;
- в локальной среде проще либо вернуть прежние логин/пароль в `.env`, либо пересоздать volume `pgdata`.

## Единый аналитический слой

Основная витрина: `public.v_unified_analytics`.

Она объединяет:

- факты обмена из `fact_transactions`;
- нормализованные ошибки из `egisz_errors`;
- атрибуты клиники из `dim_clinics`, включая `jname`, `mo_domen`, `is_verified`;
- атрибуты сервисов из `dim_services`;
- русифицированную категорию ошибки `error_category_ru`;
- вычисляемое отображаемое имя клиники через `COALESCE(c.jname, e.hostname)`.

Это базовый источник данных и для backend dashboard, и для Metabase. Отдельная BI-логика поверх сырых таблиц не требуется.

## Нормализация справочника клиник

Backend использует единое canonical hostname normalization:

- все hostname приводятся к нижнему регистру;
- `http://`, `https://`, завершающие `/` и стандартные порты удаляются;
- и в ETL, и в `dim_clinics.mo_domen` используется один и тот же канонический формат.

Если при ETL hostname найден в логе, но отсутствует в справочнике клиник, backend создаёт временную запись:

- `jname = 'Неизвестная клиника (<hostname>)'`
- `is_verified = false`

Это позволяет сохранить FK-связи, не терять ошибки и затем выполнить ручное сопоставление.

Экран настроек (`/settings`) показывает список неверифицированных клиник, требующих сопоставления.

## ETL и UX статуса

Запуск ETL теперь работает в фоновом режиме:

- `POST /api/reports/run-etl` сразу возвращает статус запуска;
- `GET /api/reports/etl-status` отдаёт текущее состояние;
- dashboard показывает строку состояния ETL с кратким текстом и текущим этапом:
  - `extracting`
  - `parsing`
  - `loading`
  - `completed`
  - `failed`

Это устраняет 504 на длинных синхронизациях и даёт оператору понятный прогресс.

## SLA и Metabase

Для расчёта SLA используется формула:

```text
SLA = count(success_requests) / count(total_requests) * 100
```

Витрина `v_clinic_hourly_sla` рассчитывает SLA только по валидным транзакциям из `v_unified_analytics`.

Готовые SQL-запросы для Metabase находятся в:

- [postgres/metabase/001_operational_metrics.sql](/C:/Users/artem/egisz-monitor/postgres/metabase/001_operational_metrics.sql)
- [postgres/metabase/002_semantic_layer_metrics.sql](/C:/Users/artem/egisz-monitor/postgres/metabase/002_semantic_layer_metrics.sql)

Для ручного массового сопоставления ghost clinics с верифицированными записями используйте:

- [postgres/scripts/map_unknown_clinics.sql](/C:/Users/artem/egisz-monitor/postgres/scripts/map_unknown_clinics.sql)

## Диагностика PostgreSQL

Backend отдельно распознаёт ошибки авторизации PostgreSQL и возвращает подсказки в:

- `/api/database/check`
- `/api/config/firebird`

Типовые причины:

- неверный пароль пользователя `egisz` для существующего `pgdata`;
- неверный пароль пользователя `metabase` для внутренней базы Metabase;
- старт на старом volume, где инициализационные SQL-скрипты больше не выполняются повторно.
