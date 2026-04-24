# Kubernetes: PostgreSQL для EGISZ Monitor Corp

## Развёртывание

1. Создайте секрет с учётными данными (не коммитьте в git):

   ```bash
   cp k8s/postgres/postgres-secret.example.yaml k8s/postgres/postgres-secret.yaml
   # отредактируйте POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
   ```

2. Примените манифесты:

   ```bash
   kubectl apply -f k8s/postgres/namespace.yaml
   kubectl apply -f k8s/postgres/postgres-secret.yaml
   kubectl apply -f k8s/postgres/postgres-statefulset.yaml
   kubectl apply -f k8s/postgres/postgres-service.yaml
   ```

   Либо без Kustomize — только перечисленные файлы.

3. Дождитесь готовности пода:

   ```bash
   kubectl -n egisz-corp rollout status statefulset/postgres
   kubectl -n egisz-corp get pods -l app.kubernetes.io/name=postgres
   ```

## Подключение к PostgreSQL

### Из пода ETL / Airflow / config-ui в том же кластере

На странице конфигурации (или в `egisz_corp.yaml`) укажите:

| Поле | Значение |
|------|----------|
| host | `postgres.egisz-corp.svc.cluster.local` (или коротко `postgres.egisz-corp`) |
| port | `5432` |
| database | как в `POSTGRES_DB` секрета |
| user / password | из секрета |

### С рабочей машины (Windows), Metabase на хосте

По умолчанию сервис `ClusterIP` **недоступен** снаружи кластера. Варианты:

1. **Port-forward** (для админки и первичной настройки):

   ```bash
   kubectl -n egisz-corp port-forward svc/postgres 5432:5432
   ```

   Тогда на Windows в конфиге: `host=127.0.0.1`, `port=5432`.

2. Отдельный **Service type LoadBalancer** или **Ingress** для PostgreSQL — обычно не рекомендуется в проде; предпочтительно Metabase внутри кластера или VPN + внутренний DNS.

## Схема DWH после поднятия БД

Из каталога пакета (или образа с установленным `egisz-monitor-corp`):

```bash
export EGISZ_CORP_CONFIG=/path/to/egisz_corp.yaml
egisz-corp apply-schema
```

## Firebird с Windows-клиента и страница конфигурации

Поля **host / port / database** на странице — те же, что для **TCP-подключения** к серверу Firebird (как в DBeaver / FlameRobin / isql).

- **Проверить Firebird** выполняется **на той машине/в том поде**, где запущен Flask (`egisz-corp config-ui`). Это не проверка с вашего ПК напрямую: если UI в Kubernetes, до БД Firebird должен дойти **под** (маршрутизация, firewall, `FB_HOST` доступен из кластера).
- С **Windows** вы можете независимо проверить те же параметры в **DBeaver**: хост = `fb_host`, порт = `fb_port`, база = alias или путь **на сервере Firebird**, как в конфиге.

Подробности — блок «Подключение Firebird» на веб-странице конфигурации.
