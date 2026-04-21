# egisz-monitor

MVP-платформа для проактивного мониторинга интеграции МИС с сервисами ЕГИСЗ/РЭМД. Помогает 2-й линии поддержки находить зависшие очереди документов, анализировать причины отказов, контролировать SLA обмена и работать с данными без ручных SQL-запросов к боевой БД клиник.

## Что входит

- ETL-пайплайн на `Node.js`/`TypeScript`: читает данные из `Firebird`, парсит XML-ответы ЕГИСЗ, классифицирует ошибки и идемпотентно загружает очищенные данные в `PostgreSQL 15`.
- Хранилище данных на схеме `Star Schema`: `fact_transactions`, `dim_clinics`, `dim_services`.
- React-дашборд для оперативного мониторинга: KPI, ошибки, активность клиник, стабильность сервисов и ручной запуск синхронизации.
- Веб-конфигуратор подключения к Firebird без редактирования `.env`.
- BI-слой на `Metabase`, подключенный к PostgreSQL-витринам `view_daily_summary`, `view_error_analysis`, `view_clinic_sla`.

## Стек

- Инфраструктура: `Docker`, `Docker Compose`
- Источник данных: `Firebird`
- DWH: `PostgreSQL 15`
- Backend: `Node.js`, `TypeScript`, `Express`
- Frontend: `React`, `Vite`, `Tailwind CSS`, `Recharts`, `Nginx`
- BI: `Metabase`

## Развертывание

- ОС: Linux или Windows Server с `WSL2`
- Docker: `Docker Engine 20.10+`, `Docker Compose 2.0+`
- Минимум для MVP: `2 CPU`, `4 GB RAM`, `10 GB` диска
- Внешние порты: `8812` или `80` для UI, `3000` для backend API, `3001` для Metabase
- Критичный сетевой доступ: backend-контейнер должен видеть сервер `Firebird` по `TCP 3050`

## Особенности Windows

Если Docker и Firebird работают на одном Windows-хосте:

# DB Config localhost:8812
- в настройках подключения используйте `host.docker.internal` вместо `localhost`
- откройте порт `3050` в Windows Firewall

# Metabase localhost:3001
- Connection string: оставить пустым
- Display name: `reports_db`
- Host: `db`
- Port: `5432`
- Database name: `egisz_monitor`
- Username: `egisz`
- Password: `egisz`
- Schemas: `public` или `All`
- SSL: `off`
- SSH tunnel: `off`

Важно: поле `Connection string` лучше вообще очистить, чтобы Metabase не подставлял значения криво.
