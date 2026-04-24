# egisz-monitor-corp

Автономный корпоративный контур: **Firebird → PostgreSQL (витрина) → Metabase**, планировщик **Apache Airflow**, веб-страница **подключения и синхронизации** (Flask). Репозиторий независим от черновика `egisz-monitor`; общие идеи (источники таблиц, парсер логов) перенесены в этот пакет целиком.

## Стек

| Компонент | Назначение |
|-----------|------------|
| **Python-пакет** `egisz_monitor_corp` | ETL, CLI, разбор `LOGTEXT`, загрузка в Postgres |
| **PostgreSQL** | Витрина (`fact_*`, `v_egisz_transactions_enriched`, `stg_parse_errors`, `etl_state`) + БД **`metabase_app`** для внутренних метаданных Metabase |
| **Metabase OSS** | Дашборды из `metabase_dashboards/*.json`, провижининг через `metabase/provision.sh` |
| **Flask (`config_app`)** | Форма FB/PG, тесты подключений, **фоновая синхронизация** (`/api/sync/start`, `/api/sync/status`) |
| **Apache Airflow** | DAG `airflow/dags/egisz_corp_etl_dag.py` — расписание `egisz-corp sync` (опционально, Helm) |
| **Kubernetes** | Namespace `egisz-corp`, манифесты в `k8s/` |

## Быстрый старт (Kubernetes)

Требования: **Docker**, **kubectl**, доступный кластер (Docker Desktop Kubernetes / minikube / корпоративный кластер).

1. Секрет витрины Postgres (имя Secret в манифестах — `postgres-credentials`):

   ```powershell
   copy k8s\postgres\postgres-secret.example.yaml k8s\postgres\postgres-credentials.yaml
   ```

   Отредактируйте `POSTGRES_PASSWORD` (и при необходимости пользователя/БД).

2. Секрет администратора Metabase:

   ```powershell
   copy k8s\metabase-admin-secret.example.yaml k8s\metabase-admin-secret.yaml
   ```

3. Конфиг приложения для подов (Firebird + Postgres внутри кластера). Возьмите за основу `config/egisz_corp.k8s.example.yaml`, сохраните как локальный файл **вне git** (например `config/egisz_corp.k8s.yaml`) и создайте Secret:

   ```powershell
   kubectl -n egisz-corp create secret generic egisz-corp-web-config --from-file=egisz_corp.yaml=config\egisz_corp.k8s.yaml --dry-run=client -o yaml | kubectl apply -f -
   ```

4. Полный деплой и сводка по сервисам:

   ```powershell
   .\start.ps1
   ```

   Только справка: `.\start.ps1 -Action help`  
   С Airflow (нужен **Helm**): `.\start.ps1 -WithAirflow`

`start.ps1` по умолчанию: **сборка образов** `egisz-corp-web` и `egisz-corp-metabase`, применение Postgres, ожидание готовности, Jobs **создания `metabase_app`** и **`egisz-corp apply-schema`**, затем Deployment **Metabase** и **corp-web**, в консоль — **port-forward команды** и DNS-имена сервисов.

## Локальная разработка (без Kubernetes)

Для быстрой отладки на одной машине: Postgres в **Docker Compose**, Python в **venv**.

```powershell
.\start.ps1 -Action dev
.\start.ps1 -Action dev-ui
```

Порт витрины на хосте по умолчанию **5433** (см. `.env.example`), чтобы не конфликтовать с другим Postgres.

## Логика парсинга (кратко)

1. **Источник Firebird**: журнал обмена (`EXCHANGELOG` / связанные таблицы — см. `egisz_monitor_corp/etl.py`, `sql_util.py`), в т.ч. `LOGTEXT` (SOAP/транспорт).
2. **Парсер** `egisz_monitor_corp/parser.py`: извлечение идентификаторов, семантика ошибок, нормализация полей для витрины.
3. **Водяной знак**: в `etl_state` хранится курсор по **`LOGID`** (инкрементальная выгрузка).
4. **PostgreSQL**: UPSERT в `fact_egisz_transactions`, staging ошибок, представление `v_egisz_transactions_enriched` для Metabase.

Подробнее о полях и отличиях от других витрин — комментарии в `sql/001_schema.sql` и в коде ETL.

## Реквизиты подключения (для сотрудников)

### Firebird (источник)

| Параметр | Где задаётся | Примечание |
|----------|--------------|------------|
| host, port | `egisz_corp.yaml` → секция `firebird`, веб-форма | TCP к серверу Firebird (часто порт **3050**). |
| database | там же | Alias или **путь на сервере Firebird**, не путь на ПК разработчика. |
| user / password | там же | Учётная запись на сервере FB. |
| charset | там же | Рекомендуется **UTF8** для корректной кириллицы. |
| Клиент для Python | образ **corp-web** / локальный venv | На Windows нужна библиотека клиента Firebird (`FB_CLIENT_LIBRARY` или `PATH`) — см. комментарии в `docker/web/Dockerfile`. |

Проверка: `egisz-corp test-fb` или кнопка «Проверить Firebird» в UI.

### PostgreSQL (витрина)

| Контур | Host | Port | Database / user | Пароль |
|--------|------|------|-----------------|--------|
| **Внутри кластера** | `postgres.egisz-corp.svc.cluster.local` | 5432 | Из Secret `postgres-credentials`: ключи `POSTGRES_DB`, `POSTGRES_USER` | `POSTGRES_PASSWORD` |
| **С рабочей машины** | `127.0.0.1` при `kubectl -n egisz-corp port-forward svc/postgres 5432:5432` | 5432 | те же | те же |
| **Локальный Compose** | `127.0.0.1` | `CORP_DB_PORT` из `.env` (часто 5433) | `POSTGRES_*` из `.env` | из `.env` |

Секрет для подов приложения (`egisz_corp.yaml` внутри) должен содержать **те же** параметры Postgres, что и витрина (для k8s — host сервиса, не localhost).

### Metabase

| Параметр | Значение |
|----------|----------|
| URL в кластере | `http://metabase.egisz-corp.svc.cluster.local:3000` |
| Port-forward | `kubectl -n egisz-corp port-forward svc/metabase 3001:3000` → браузер `http://127.0.0.1:3001` |
| Админ | Email/password из Secret `metabase-admin` |
| Внутренняя БД приложения | PostgreSQL, БД **`metabase_app`** (та же инстанция, отдельная БД) |
| Источник данных «EGISZ Corp DWH» | БД из `POSTGRES_DB` Secret `postgres-credentials` |

### Веб (corp-web)

| Параметр | Значение |
|----------|----------|
| Сервис | `corp-web.egisz-corp.svc.cluster.local:8080` |
| Port-forward | `kubectl -n egisz-corp port-forward svc/corp-web 8080:8080` |
| Конфиг | Secret `egisz-corp-web-config`, ключ `egisz_corp.yaml` → монтируется в `/app/config/egisz_corp.yaml`, переменная `EGISZ_CORP_CONFIG` |

### Airflow (опционально)

См. `k8s/README.md`: Secret метаданных SQLAlchemy, Job создания БД `airflow`, Helm values `k8s/airflow/values-corp.example.yaml`, образ `k8s/airflow/Dockerfile`.

## Проверки после деплоя

1. **Синхронизация**: в UI «Запустить синхронизацию» или `kubectl -n egisz-corp exec deploy/corp-web -- egisz-corp sync` (нужен доступ пода к Firebird).
2. **Metabase**: вход под админом, коллекция **EGISZ Corp Monitoring**, дашборды с суффиксом **(Corp)**.
3. **Шрифты / UTF-8**: страница UI с `charset=utf-8`; в Metabase при setup задан `site_locale: ru`. Проверьте кириллицу в названиях дашбордов и в данных.

## Тесты и качество кода

```powershell
cd egisz-monitor-corp
python -m pip install -e ".[dev]"
python -m pytest
```

## Структура репозитория

- `egisz_monitor_corp/` — код ETL, Flask, FB/PG.
- `sql/` — схема витрины и `etl_state`.
- `airflow/dags/` — DAG.
- `metabase/`, `metabase_dashboards/` — образ и JSON для Metabase.
- `k8s/` — Postgres, Metabase, web, Jobs, примеры секретов, Airflow.
- `start.ps1` — единая точка входа (k8s по умолчанию, `dev*` для Compose).

Публичный репозиторий (целевой): [https://github.com/asaf1n/egisz-monitor-corp](https://github.com/asaf1n/egisz-monitor-corp).
