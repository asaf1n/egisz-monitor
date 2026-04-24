# AGENTS.md — egisz-monitor-corp

Инструкции для ИИ-агентов и людей, которые продолжают работу в этом репозитории.

## Назначение

Автономный корпоративный прототип: ETL Firebird → PostgreSQL, Metabase с провижинингом, Flask UI (конфиг + синхронизация), Airflow DAG, деплой в **Kubernetes** (`namespace: egisz-corp`). Не смешивать с монолитом `egisz-monitor`; переносить код осознанно и только при необходимости.

## Как безопасно менять код

- Минимальные диффы под задачу; не рефакторить «заодно».
- Секреты не коммитить: `postgres-credentials.yaml`, `metabase-admin-secret.yaml`, `config/egisz_corp.yaml` — в `.gitignore` или только примеры (`*.example.yaml`).
- После правок SQL или ETL — `python -m pytest`.

## Ключевые пути

| Область | Файлы |
|---------|--------|
| ETL | `egisz_monitor_corp/etl.py`, `parser.py`, `pg_warehouse.py`, `fb_client.py` |
| CLI / UI | `egisz_monitor_corp/cli.py`, `config_app.py`, `sync_routes.py` |
| Схема БД | `sql/001_schema.sql`, `sql/002_etl_state.sql` |
| Metabase | `metabase/provision.sh`, `metabase/setup-dashboards.sh`, `metabase_dashboards/*.json`, `metabase/Dockerfile` |
| K8s | `k8s/postgres/*`, `k8s/metabase.yaml`, `k8s/web.yaml`, `k8s/jobs/*`, `k8s/airflow/*` |
| Точка входа | `start.ps1` (по умолчанию k8s `deploy`; локально — `-Action dev`) |

## Деплой

1. Собрать образы: `docker build` как в `start.ps1` (`egisz-corp-web`, `egisz-corp-metabase`).
2. Применить Postgres + секреты.
3. Дождаться готовности Postgres → Job `egisz-corp-pg-bootstrap-metabase` → Job `egisz-corp-apply-dwh-schema` (нужен Secret `egisz-corp-web-config`).
4. Metabase + corp-web.

Metabase использует `MB_DB_*` на БД **`metabase_app`**; витрина для карт — `POSTGRES_DB` из `postgres-credentials`.

## Журнал изменений (для агентов)

| Дата | Изменение |
|------|-----------|
| 2026-04-24 | Добавлены K8s: Metabase Deployment/Service, corp-web, Jobs (`metabase_app`, `apply-schema`), объединённый `start.ps1` (k8s по умолчанию + `dev*` для Compose). |
| 2026-04-24 | Metabase: внутренняя БД Postgres (`MB_DB_*`), исправлена проверка счётчика таблиц в `provision.sh` (trim / нечисловые значения). |
| 2026-04-24 | Flask: `sync_routes.py`, обновлён `config_app.py` (синхронизация, `ensure_ascii=False` для JSON). |
| 2026-04-24 | Добавлены `metabase/`, `metabase_dashboards/`, `docker/web/Dockerfile`, `config/egisz_corp.k8s.example.yaml`, README/AGENTS, `config/egisz_corp.yaml` убран из индекса git. |

При существенных правках **дописывайте строку** в таблицу выше (дата ISO, кратко что и зачем).
