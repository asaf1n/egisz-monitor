# EGISZ Monitor

Система мониторинга и BI-аналитики интеграций ЕГИСЗ. Проект извлекает данные из Firebird, сохраняет их в PostgreSQL, строит аналитику и визуализацию через Metabase.

## Технологический стек
- Backend: Node.js, TypeScript, Express, tsx
- Frontend: React, Vite, Tailwind CSS
- Database: PostgreSQL 15 (аналитическое хранилище), Firebird (источник логов)
- BI: Metabase
- Инфраструктура: Docker, Docker Compose, Nginx-прокси, PowerShell

## Что реализовано
- ETL из Firebird в PostgreSQL с загрузкой фактов и нормализацией клиник
- Web API: `/health`, `/api/config/*`, `/api/reports/*`
- React-панель управления для мониторинга и конфигурации
- Metabase и публичный Metabase-прокси для доступа к дашбордам
- Инициализация PostgreSQL через `postgres/init`

## Быстрый старт
1. Скопируйте root `.env.example` в `.env` и настройте параметры окружения.
2. Запустите стек разработки:
   ```powershell
   .\start.ps1 -Action deploy
   ```
3. Для продакшн-стека используйте:
   ```powershell
   .\start.ps1 -Action prod
   ```

> В режиме разработки используется `docker-compose.yml` вместе с `docker-compose.dev.yml`.

## Доступы
- Панель управления frontend: http://localhost:8812
- Metabase Admin UI: http://localhost:3001
- Публичный Metabase: http://localhost:3002
- Backend healthcheck: http://localhost:3000/health

### Metabase
- Email: `admin@egisz-monitor.local`
- Password: `ChangeMeNow123!`

## Конфигурация
Основные значения по умолчанию заданы в `.env.example`:
- PostgreSQL: `DB_NAME=egisz_monitor`, `DB_USER=egisz`, `DB_PASSWORD=egisz`, `DB_PORT=5432`
- Firebird: `FIREBIRD_HOST=host.docker.internal`, `FIREBIRD_PORT=3050`, `FIREBIRD_ALIAS=proxy_egisz`, `FIREBIRD_USER=sysdba`, `FIREBIRD_PASSWORD=masterkey`, `FIREBIRD_PAGE_SIZE=4096`
- Backend: `BACKEND_PORT=3000`
- Frontend: `FRONTEND_PORT=8812`, `VITE_API_BASE_URL=http://localhost/api`
- Metabase: `METABASE_PORT=3001`, `METABASE_PUBLIC_PORT=3002`

## Компоненты
- `db` — PostgreSQL 15 container с инициализацией из `postgres/init`
- `backend` — Express API и ETL-сервис, который загружает данные из Firebird и наполняет PostgreSQL
- `frontend` — React/Vite приложение панели управления
- `metabase` — Metabase BI-сервер с подключением к PostgreSQL
- `metabase-public` — nginx-прокси публичного Metabase-дashboards

## API
Backend предоставляет:
- `GET /health`
- `GET /api/database/check`
- `GET /api/config/firebird`
- `GET /api/config/clinic-directory-issues`
- `POST /api/config/test-firebird`
- `POST /api/config/save-firebird`
- `GET /api/reports/*` и `POST /api/reports/run-etl`

## Структура данных
Аналитическая модель определяется в `postgres/init/001_schema.sql`:
- `dim_clinics` — справочник клиник и MO
- `dim_services` — справочник сервисов
- `fact_transactions` — факты обращений, успешные и ошибочные транзакции
- `egisz_errors` — нормализованные ошибки с привязкой к клинике
- `app_config` — runtime-конфигурация приложения

## Сборка и запуск без PowerShell
```powershell
cd c:\Users\artem\egisz-monitor
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```
Для production-стека:
```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

## Полезные команды
- `docker compose build`
- `docker compose up -d`
- `docker compose ps`
- `docker compose logs -f backend`
- `docker compose logs -f frontend`
- `docker compose logs -f metabase`

## Примечания
- Публичный Metabase доступен без аутентификации через `metabase-public`.
- Backend внутри контейнера использует `host.docker.internal` для доступа к внешнему Firebird.
- `frontend` ожидает API на порту `3000` по умолчанию через `VITE_API_BASE_URL`.
