# egisz-monitor

Локальная система мониторинга обмена с ЕГИСЗ. Приложение загружает журналы обмена из Firebird, нормализует данные в PostgreSQL, строит единый аналитический слой для dashboard и Metabase и поддерживает runtime-миграции схемы.

## Что входит в проект

- `backend` — Node.js / TypeScript API, ETL и runtime-миграции PostgreSQL
- `frontend` — React / Vite интерфейс dashboard и настроек
- `db` — PostgreSQL 15
- `metabase` — BI-интерфейс для ad-hoc аналитики и отчётов

## Быстрый старт

### 1. Требования

Нужно установить:

- Docker Desktop
- Docker Compose
- Node.js 20+ и npm

### 2. Настройка окружения

Создайте `.env` в корне проекта:

```powershell
Copy-Item .env.example .env
```

Минимальные значения для локального старта:

```env
DB_HOST=db
DB_PORT=5432
DB_NAME=egisz_monitor
DB_USER=egisz
DB_PASSWORD=egisz

MB_DB_HOST=db
MB_DB_PORT=5432
MB_DB_NAME=metabase
MB_DB_USER=metabase
MB_DB_PASS=metabase
```

### 3. Данные Firebird для начала работы

В проекте уже предусмотрены локальные стартовые значения. Они подходят для типового запуска в Docker на Windows, если Firebird доступен с хоста:

```text
host: host.docker.internal
port: 3050
alias: proxy_egisz
user: sysdba
password: masterkey
```

Эти значения:

- автоматически подставляются как дефолтные;
- доступны на странице `Настройки`;
- могут быть изменены и сохранены через интерфейс.

### 4. Запуск

Запустите проект:

```powershell
docker compose up -d --build
```

После запуска сервисы будут доступны:

- Control panel: `http://localhost:8812`
- Backend health: `http://localhost:3000/health`
- Metabase full UI: `http://localhost:3001`
- Public dashboards: `http://localhost:3002`
- PostgreSQL: `localhost:5432`

## Первый вход и рабочий сценарий

### 1. Проверка Firebird

Откройте `http://localhost:8812/`.

Проверьте:

- `host`
- `port`
- `alias`
- `user`
- `password`

Дальше:

1. Нажмите `Проверить соединение`
2. Если соединение успешно, нажмите `Сохранить`

### 2. Первый ETL

Откройте `http://localhost:8812/`.

На стартовой странице доступны:

- кнопка `Обновить данные`
- динамический статус ETL с индикацией этапов
- настройки подключения Firebird
- переход на `/dashboard`

Нажмите `Обновить данные`.

ETL выполняется в фоне. В верхней строке статуса отображаются:

- текущее состояние ETL;
- этап выполнения;
- краткое текстовое сообщение;
- время запуска.

Этапы ETL:

- `extracting` — синхронизация ЮЛ
- `parsing` — синхронизация и парсинг сообщений
- `loading` — загрузка данных в хранилище
- `completed` — завершено
- `failed` — ошибка

## Локальные учётные данные

### PostgreSQL

Для локальной работы по умолчанию используются:

```text
user: egisz
password: egisz
database: egisz_monitor
port: 5432
```

### Внутренняя база Metabase

Для внутренней базы Metabase по умолчанию используются:

```text
user: metabase
password: metabase
database: metabase
port: 5432
```

## Что делать, если `pgdata` уже существует

Если volume PostgreSQL был создан раньше, новые значения из `.env` не переопределят уже существующих пользователей.

Типовые симптомы:

- `password authentication failed for user "egisz"`
- `password authentication failed for user "metabase"`

Варианты решения:

1. Вернуть прежние логин и пароль, с которыми изначально создавался volume
2. Пересоздать volume полностью:

```powershell
docker compose down -v
docker compose up -d --build
```

## Архитектура данных

### Основные таблицы

- `dim_clinics`
- `dim_services`
- `fact_transactions`
- `egisz_errors`
- `app_config`

### Основная аналитическая витрина

Основной semantic layer:

```text
public.v_unified_analytics
```

Именно он используется:

- backend-дашбордом;
- Metabase;
- витринами SLA и error analytics.

Это сделано для исключения расхождения логики между приложением и BI.

## Нормализация клиник

### Canonical hostname

Все hostname нормализуются к единому виду:

- перевод в нижний регистр;
- удаление `http://` и `https://`;
- удаление завершающих `/`;
- удаление стандартных портов;
- хранение в каноническом виде в `dim_clinics.mo_domen`.

### Ghost clinics

Если hostname найден в логах, но отсутствует в справочнике клиник, система создаёт временную запись:

- `jname = Неизвестная клиника (<hostname>)`
- `is_verified = false`

Это позволяет:

- не ронять FK-связи;
- не терять ошибки и транзакции;
- потом сопоставить такую клинику вручную.

## Работа с неверифицированными клиниками

Страница `Настройки` показывает список клиник, у которых:

- `is_verified = false`

Для массового ручного сопоставления используется скрипт:

- [postgres/scripts/map_unknown_clinics.sql](/C:/Users/artem/egisz-monitor/postgres/scripts/map_unknown_clinics.sql)

Сценарий:

1. Найти временные hostname
2. Подставить соответствующие `jid` и названия клиник
3. Выполнить SQL-скрипт
4. Перезапустить ETL при необходимости

## SLA и аналитика

Расчёт SLA:

```text
SLA = count(success_requests) / count(total_requests) * 100
```

Для SLA используются витрины:

- `v_clinic_hourly_sla`
- `v_service_hourly_health`

Дополнительные витрины:

- `v_error_fingerprints`
- `view_daily_summary`
- `view_error_analysis`
- `view_clinic_sla`

## Metabase

Metabase доступен по адресу:

```text
http://localhost:3001
```

Рекомендуется строить вопросы и дашборды на основе:

- `public.v_unified_analytics`

Готовые SQL-запросы:

- [postgres/metabase/001_operational_metrics.sql](/C:/Users/artem/egisz-monitor/postgres/metabase/001_operational_metrics.sql)
- [postgres/metabase/002_semantic_layer_metrics.sql](/C:/Users/artem/egisz-monitor/postgres/metabase/002_semantic_layer_metrics.sql)

## Полезные API endpoints

### Health и диагностика

- `GET /health`
- `GET /api/database/check`
- `GET /api/config/firebird`
- `GET /api/config/clinic-directory-issues`

### Настройки Firebird

- `POST /api/config/test-firebird`
- `POST /api/config/save-firebird`

### ETL и отчёты

- `POST /api/reports/run-etl`
- `GET /api/reports/etl-status`
- `GET /api/reports/kpi`
- `GET /api/reports/errors-pie`
- `GET /api/reports/hourly-trend`
- `GET /api/reports/clinic-errors`
- `GET /api/reports/service-health`
- `GET /api/reports/status-heatmap`

## Полезные команды

### Пересобрать и поднять проект

```powershell
docker compose up -d --build
```

### Остановить проект

```powershell
docker compose down
```

### Остановить с удалением volume

```powershell
docker compose down -v
```

### Посмотреть логи backend

```powershell
docker compose logs backend --tail=200
```

### Посмотреть логи frontend

```powershell
docker compose logs frontend --tail=200
```

### Посмотреть логи Metabase

```powershell
docker compose logs metabase --tail=200
```

## Проверка после запуска

Минимальная проверка:

1. Открыть `http://localhost:8812/settings`
2. Проверить соединение с Firebird
3. Сохранить настройки
4. Открыть `http://localhost:8812/`
5. Запустить синхронизацию
6. Убедиться, что строка статуса ETL меняет этапы
7. Проверить dashboard
8. При необходимости открыть `http://localhost:3001`

## Примечания

- Все изменения схемы PostgreSQL выполняются через `ensureSchema()` в backend
- Логика аналитических view принадлежит backend, а не init-скриптам
- Для существующего `pgdata` миграции применяются при старте backend
- Если в отчётах видны технические hostname, нужно завершить ручной маппинг ghost clinics
