# EGISZ Monitor

Внутрикорпоративная система мониторинга обмена с ЕГИСЗ: извлечение логов из Firebird, нормализация и хранение в PostgreSQL, аналитика и дашборды через Metabase.

См. также [AGENTS.md](./AGENTS.md) как журнал архитектурных изменений.

## Назначение системы
- Централизованный контроль интеграционных обменов с ЕГИСЗ.
- Разделение мониторинга на контуры:
  - бизнес/продукт (`Статистика отправки`)
  - технический анализ (`Технические метрики`)
- Быстрый операционный доступ к статусу ETL и ключевым отчетам.

## Технологический стек
- Backend: Node.js, TypeScript, Express, `node-firebird`, `pg`, `xml2js`.
- Frontend: React 18, Vite, TypeScript, Recharts.
- DWH/OLAP слой: PostgreSQL 15.
- Source: Firebird (журнал `EXCHANGELOG`, сообщения `EGISZ_MESSAGES`).
- BI: Metabase + публичный nginx-прокси.
- Инфраструктура: Docker, Docker Compose, PowerShell.

## Архитектура компонентов
- `db` — PostgreSQL с runtime-схемой и таблицами аналитики.
- `backend` — API + ETL (извлечение, парсинг, классификация, загрузка).
- `frontend` — панель администрирования и мониторинга.
- `metabase` — BI UI и построение отчетов.
- `metabase-public` — публичный read-only слой дашбордов.

## Доступы и точки входа

### URL (локальное окружение)
- Frontend: `http://localhost:8812`
- Backend health: `http://localhost:3000/health`
- Backend API root: `http://localhost:3000/api/...`
- Metabase Admin UI: `http://localhost:3001`
- Metabase Public: `http://localhost:3002`

### Учетные данные Metabase (по умолчанию)
- Email: `admin@egisz-monitor.local`
- Password: `ChangeMeNow123!`

### Порты по умолчанию
- PostgreSQL: `5432`
- Backend: `3000`
- Frontend: `8812`
- Metabase: `3001`
- Metabase Public: `3002`

## Быстрый старт

### 1) Подготовка окружения
1. Скопировать `.env.example` в `.env` в корне репозитория.
2. Проверить параметры подключения к Firebird (`FIREBIRD_HOST`, `FIREBIRD_PORT`, `FIREBIRD_ALIAS`, `FIREBIRD_USER`, `FIREBIRD_PASSWORD`).

### 2) Запуск dev-стека
```powershell
.\start.ps1 -Action deploy
```

Эквивалент вручную:
```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

### 3) Запуск production-стека
```powershell
.\start.ps1 -Action prod
```

Эквивалент вручную:
```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

### 4) Проверка состояния
```powershell
docker compose ps
docker compose logs -f backend
```

## Переменные окружения (ключевые)
- PostgreSQL: `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `POSTGRES_SCHEMA`.
- Firebird connection: `FIREBIRD_HOST`, `FIREBIRD_PORT`, `FIREBIRD_ALIAS`, `FIREBIRD_USER`, `FIREBIRD_PASSWORD`, `FIREBIRD_PAGE_SIZE`.
- ETL tuning:
  - `FIREBIRD_ETL_PAGE_SIZE` (дефолт `200`)
  - `FIREBIRD_ATTACH_TIMEOUT_MS` (дефолт `8000`)
  - `FIREBIRD_QUERY_TIMEOUT_MS` (дефолт `12000`)
  - `FIREBIRD_ETL_QUERY_TIMEOUT_MS` (дефолт `30000`)
- Backend: `BACKEND_PORT`.
- Frontend: `FRONTEND_PORT`, `VITE_API_BASE_URL`.
- Metabase: `METABASE_PORT`, `METABASE_PUBLIC_PORT`, `METABASE_ADMIN_EMAIL`, `METABASE_ADMIN_PASSWORD`.

## API (основные endpoints)
- `GET /health`
- `GET /api/database/check`
- `GET /api/config/firebird`
- `POST /api/config/test-firebird`
- `POST /api/config/save-firebird`
- `GET /api/config/clinic-directory-issues`
- `POST /api/reports/run-etl`
- `GET /api/reports/etl-status`
- `GET /api/reports/sync-status`
- `GET /api/reports/kpi`
- `GET /api/reports/errors-pie`
- `GET /api/reports/status-heatmap`
- `GET /api/reports/hourly-trend`
- `GET /api/reports/clinic-errors`
- `GET /api/reports/service-health`
- `GET /api/reports/costly-clinics`
- `GET /api/reports/vpn-node-status`
- `GET /api/reports/system-health`

## Логика ETL и парсинга (актуальная)

### 1) Source extraction (Firebird)
Базовый source query в backend intentionally плоский, без тяжелой бизнес-логики:
- источник: `EXCHANGELOG` + `LEFT JOIN EGISZ_MESSAGES` по `MSGID`
- сортировка: `ORDER BY e.LOGID DESC`
- pagination: `FIRST/SKIP` инжектируется в runtime

Цель: быстрый fetch сырых строк из Firebird без тяжелых join-конструкций.

### 2) Правила статуса и ошибок
При нормализации строк ETL применяются правила:
- Сетевая ошибка:
  - если `LOGSTATE = 3`, статус трактуется как `error`
  - текст ошибки берется из `LOGTEXT`
- Если не сетевая ошибка, анализируется `MSGTEXT`:
  - XML-сценарий (SOAP):
    - `<ns2:status>success</ns2:status>` -> `success`
    - `<ns2:status>error</ns2:status>` -> `error`
    - код ошибки: `<ns2:code>`
    - сообщение ошибки: `<ns2:message>` (может быть длинным)
  - Raw text-сценарий:
    - детектируются инфраструктурные паттерны `Socket error`, `Host not found`, `CA_INACCESSIBILITY`

### 3) JID/KIND и fallback
- Source SQL остается плоским и отдает сырые поля из `EXCHANGELOG + EGISZ_MESSAGES` без CASE/парсинга в Firebird.
- `JID` извлекается строго из `row.JID`; если значение отсутствует, в backend используется `0` и запись помечается как несопоставленная.
- `MO_UID` (OID) извлекается независимо от `JID`: `row.MO_UID` или XML-тег `<ns2:organization>`.
- `local_uid` извлекается как metadata из `row.DOCUMENTID` или XML-тега `<ns2:localUid>`.
- `reply_to` извлекается из `row.REPLYTO` или XML-тега `<To>`.
- `DOCUMENTID` не участвует в логике определения клиники и не используется как ключ связи таблиц прокси-базы.

### 4) Категоризация ошибок в backend
Backend присваивает категорию одной из групп:
- `Infrastructure`
- `FRMR_Error`
- `Validation_Error`
- `Success`

### 5) Запись в PostgreSQL
Факт-таблица хранит:
- `status`
- `error_category`
- `error_code`
- `error_message`
- `error_text`
- `local_uid`
- `reply_to`

Это обеспечивает совместимость отчетов и более детальную диагностику инцидентов.

## Таблицы и поля интеграции (по proxy_tables.txt)

### EXCHANGELOG (основной журнал обмена)
- Ключевые поля: `LOGID`, `LOGDATE`, `LOGTYPE`, `LOGSTATE`, `LOGMODE`, `MSGID`.
- Поля контента: `MSGTEXT` (XML/текст ответа), `LOGTEXT` (сетевые/технические сообщения).
- Транспортные поля: `METHOD`, `URI`, `ACTION`, `PARENTLOGID`, `GRPID`.
- Служебные даты: `CREATEDATE`, `MODIFYDATE`.
- Индексы для ETL-критичны: `IDX_EXCHANGELOG_LOGID`, `EXCHANGELOG_MSGID`, `EXCHANGELOG_LOGDATE`.

### EGISZ_MESSAGES (метаданные сообщения)
- Ключевые поля: `EGMID`, `MSGID`.
- Метаданные: `REPLYTO`, `CREATEDATE`, `DOCUMENTID`.
- Важно: `DOCUMENTID` сохраняется как metadata (`local_uid`) и не считается каноническим ключом связи с `EGISZ_LICENSES`.
- Для backend-парсинга `REPLYTO` сохраняется дополнительно в `fact_transactions.reply_to`.

### EGISZ_LICENSES (справочник лицензий/организаций)
- Поля: `ID`, `SERVICE_TYPE`, `JID`, `MO_UID`, `MO_DOMEN`, `BDATE`, `FDATE`, `KIND`, `MODIFYDATE`.
- Предметные связи:
  - `MO_DOMEN` сопоставляется с `EGISZ_MESSAGES.REPLYTO`
  - `JID` является внутренним идентификатором клиники
  - `KIND` / `SERVICE_TYPE` задают семантику отправленного СЭМД
- Текущая стратегия: для ускорения extraction таблица не участвует в дефолтном source query Firebird; корректное обогащение должно выполняться после извлечения сырых событий через доменное/JID-сопоставление.

### JPERSONS (справочник ЮЛ)
- Ключевые поля для интеграционного контекста: `JID`, `JNAME`, `FIR_OID` и др.
- Используется как справочник юридических лиц после получения `JID` из связки `REPLYTO/MO_DOMEN -> EGISZ_LICENSES.JID`.

### Контроль отсутствия несуществующих полей
- Также зафиксировано предметное ограничение: `EGISZ_MESSAGES.DOCUMENTID -> EGISZ_LICENSES.ID` не является валидной канонической связью для текущей базы proxy-сервиса.
- В коде source query бизнес-парсинг исключен и перенесен в Backend/TypeScript.

## Модель данных PostgreSQL
Ключевые таблицы:
- `dim_clinics`
- `dim_services`
- `fact_transactions`
- `egisz_errors`
- `dim_error_costs`
- `app_config`

Базовый bootstrap-скрипт: `postgres/init/001_schema.sql`.
Runtime-эволюция схемы выполняется backend-сервисом (`ensureSchema()`).

## Производительность и критерии
Целевой критерий ETL extraction:
- первая страница (`FIRST 200`) должна загружаться < 1 секунды на корректно индексированном источнике.

Практический контроль:
1. Проверить индексы на `EXCHANGELOG(LOGID)` и `EXCHANGELOG(MSGID)`.
2. Проверить индекс на `EGISZ_MESSAGES(MSGID)`.
3. Проверить `PLAN`/`EXPLAIN` для source query.

## Операционные команды
```powershell
# статус контейнеров
docker compose ps

# backend логи
docker compose logs -f backend

# frontend логи
docker compose logs -f frontend

# metabase логи
docker compose logs -f metabase

# пересборка и перезапуск
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

## Типовые инциденты и диагностика
- ETL завис на `0 processed`:
  - проверить `GET /api/reports/etl-status`
  - проверить backend-логи по page fetch
  - проверить таймауты и доступность Firebird
- Frontend показывает подключение, но отчетов нет:
  - проверить `GET /api/database/check`
  - проверить `GET /api/reports/sync-status`
- Изменения SQL/init не видны:
  - init-скрипты `postgres/init/*.sql` выполняются только на первом init volume
  - для существующего volume rely на runtime-миграции backend

## Безопасность и эксплуатационные замечания
- Значения учетных данных по умолчанию обязательны к замене в корпоративном контуре.
- `host.docker.internal` используется backend-контейнером для доступа к внешнему Firebird.
- Public Metabase (`:3002`) предназначен для публикации дашбордов; доступ должен контролироваться на уровне периметра.

## Внутренние ссылки
- Архитектурный манифест: [AGENTS.md](./AGENTS.md)
- Схема DWH: `postgres/init/001_schema.sql`
- Runtime схема/вьюхи: `backend/src/services/postgres.service.ts`
- Source query: `backend/src/utils/validation.ts`
- ETL parsing: `backend/src/services/etl.service.ts`
