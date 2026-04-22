#!/bin/bash
set -euo pipefail

METABASE_URL="${METABASE_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@egisz-monitor.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMeNow123!}"
DB_NAME="${DB_NAME:-egisz_monitor}"
DB_USER="${DB_USER:-egisz}"
DB_PASSWORD="${DB_PASSWORD:-egisz}"
DB_DISPLAY_NAME="${DB_DISPLAY_NAME:-EGISZ Reports}"

ROOT_COLLECTION_NAME="EGISZ Мониторинг"
MAIN_DASHBOARD_NAME="🟢 Главный мониторинг"
ERROR_DASHBOARD_NAME="🔴 Аналитика ошибок"
CLINIC_DASHBOARD_NAME="🏥 Клинический анализ"
SERVICE_DASHBOARD_NAME="⚙️ Сервисный анализ"

log_info() {
  echo "[dashboards] $1" >&2
}

api_request() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local response

  if [ -n "${payload}" ]; then
    response="$(curl -sS -w $'\n%{http_code}' -X "${method}" "${METABASE_URL}${path}" \
      -H "Content-Type: application/json" \
      -H "X-Metabase-Session: ${SESSION_TOKEN}" \
      -d "${payload}")"
  else
    response="$(curl -sS -w $'\n%{http_code}' -X "${method}" "${METABASE_URL}${path}" \
      -H "X-Metabase-Session: ${SESSION_TOKEN}")"
  fi

  HTTP_CODE="$(echo "${response}" | tail -n1)"
  RESPONSE_BODY="$(echo "${response}" | sed '$d')"

  if [[ ! "${HTTP_CODE}" =~ ^2 ]]; then
    echo "Metabase API ${method} ${path} failed with HTTP ${HTTP_CODE}" >&2
    echo "${RESPONSE_BODY}" >&2
    return 1
  fi

  printf '%s' "${RESPONSE_BODY}"
}

authenticate() {
  SESSION_TOKEN="$(curl -sS -X POST "${METABASE_URL}/api/session" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" | jq -r '.id')"

  if [ -z "${SESSION_TOKEN}" ] || [ "${SESSION_TOKEN}" = "null" ]; then
    echo "Failed to authenticate in Metabase" >&2
    exit 1
  fi
}

delete_collection_tree() {
  local collection_id="$1"
  local children_json child_ids dashboard_ids card_ids

  children_json="$(api_request GET "/api/collection/${collection_id}/items")"

  child_ids="$(echo "${children_json}" | jq -r '.data[]? | select(.model == "collection") | .id')"
  for child_id in ${child_ids}; do
    delete_collection_tree "${child_id}"
  done

  dashboard_ids="$(echo "${children_json}" | jq -r '.data[]? | select(.model == "dashboard") | .id')"
  for dashboard_id in ${dashboard_ids}; do
    api_request DELETE "/api/dashboard/${dashboard_id}" >/dev/null
  done

  card_ids="$(echo "${children_json}" | jq -r '.data[]? | select(.model == "card") | .id')"
  for card_id in ${card_ids}; do
    api_request DELETE "/api/card/${card_id}" >/dev/null
  done

  api_request PUT "/api/collection/${collection_id}" '{"archived":true}' >/dev/null
  api_request DELETE "/api/collection/${collection_id}" >/dev/null
}

delete_demo_content() {
  local collections_json dashboards_json databases_json example_ids dashboard_ids sample_ids

  collections_json="$(api_request GET "/api/collection")"
  example_ids="$(echo "${collections_json}" | jq -r '.[] | select(.name == "Examples") | .id')"
  for example_id in ${example_ids}; do
    delete_collection_tree "${example_id}"
  done

  dashboards_json="$(api_request GET "/api/dashboard")"
  dashboard_ids="$(echo "${dashboards_json}" | jq -r '.[] | select(.name == "E-commerce Insights") | .id')"
  for dashboard_id in ${dashboard_ids}; do
    api_request DELETE "/api/dashboard/${dashboard_id}" >/dev/null
  done

  databases_json="$(api_request GET "/api/database")"
  sample_ids="$(echo "${databases_json}" | jq -r '.data[] | select(.is_sample == true or .name == "Sample Database") | .id')"
  for sample_id in ${sample_ids}; do
    api_request DELETE "/api/database/${sample_id}" >/dev/null
  done
}

ensure_app_database() {
  local databases_json db_id payload

  databases_json="$(api_request GET "/api/database")"
  db_id="$(echo "${databases_json}" | jq -r --arg dbName "${DB_NAME}" --arg display "${DB_DISPLAY_NAME}" '
    [
      .data[]
      | select(
          (.name == $display)
          or (.name == $dbName)
          or (.details.dbname? == $dbName)
        )
    ]
    | sort_by(.id)
    | last
    | .id // empty
  ')"

  if [ -n "${db_id}" ]; then
    printf '%s' "${db_id}"
    return 0
  fi

  payload="$(jq -n \
    --arg name "${DB_DISPLAY_NAME}" \
    --arg dbname "${DB_NAME}" \
    --arg user "${DB_USER}" \
    --arg password "${DB_PASSWORD}" \
    '{
      engine: "postgres",
      name: $name,
      details: {
        host: "db",
        port: 5432,
        dbname: $dbname,
        user: $user,
        password: $password,
        ssl: false,
        "tunnel-enabled": false,
        "advanced-options": false
      },
      is_full_sync: true,
      is_on_demand: false,
      auto_run_queries: true
    }')"

  db_id="$(api_request POST "/api/database" "${payload}" | jq -r '.id // empty')"

  if [ -z "${db_id}" ]; then
    echo "Failed to register application database" >&2
    exit 1
  fi

  api_request POST "/api/database/${db_id}/sync_schema" "{}" >/dev/null || true
  printf '%s' "${db_id}"
}

create_collection() {
  local name="$1"
  local description="$2"
  local color="$3"
  local parent_id="${4:-}"
  local payload

  if [ -n "${parent_id}" ]; then
    payload="$(jq -n \
      --arg name "${name}" \
      --arg description "${description}" \
      --arg color "${color}" \
      --argjson parentId "${parent_id}" \
      '{name: $name, description: $description, color: $color, parent_id: $parentId}')"
  else
    payload="$(jq -n \
      --arg name "${name}" \
      --arg description "${description}" \
      --arg color "${color}" \
      '{name: $name, description: $description, color: $color}')"
  fi

  api_request POST "/api/collection" "${payload}" | jq -r '.id'
}

create_card() {
  local name="$1"
  local description="$2"
  local collection_id="$3"
  local query="$4"
  local display="$5"
  local payload

  payload="$(jq -n \
    --arg name "${name}" \
    --arg description "${description}" \
    --arg query "${query}" \
    --arg display "${display}" \
    --argjson collectionId "${collection_id}" \
    --argjson databaseId "${APP_DB_ID}" \
    '{
      name: $name,
      description: $description,
      collection_id: $collectionId,
      dataset_query: {
        type: "native",
        native: { query: $query },
        database: $databaseId
      },
      display: $display,
      visualization_settings: {}
    }')"

  api_request POST "/api/card" "${payload}" | jq -r '.id'
}

create_dashboard() {
  local name="$1"
  local description="$2"
  local collection_id="$3"
  local dashcards_json="$4"
  local payload

  payload="$(jq -n \
    --arg name "${name}" \
    --arg description "${description}" \
    --argjson collectionId "${collection_id}" \
    --argjson dashcards "${dashcards_json}" \
    '{
      name: $name,
      description: $description,
      collection_id: $collectionId,
      cacheables: [],
      dashcards: $dashcards
    }')"

  api_request POST "/api/dashboard" "${payload}" | jq -r '.id'
}

log_info "Waiting for Metabase at ${METABASE_URL}..."
until curl --silent --fail "${METABASE_URL}/api/health" >/dev/null; do
  sleep 3
done

authenticate
delete_demo_content

for collection_id in $(api_request GET "/api/collection" | jq -r --arg root "${ROOT_COLLECTION_NAME}" '.[] | select(.name == $root) | .id' | sort -nr); do
  delete_collection_tree "${collection_id}"
done

authenticate
APP_DB_ID="$(ensure_app_database)"

ROOT_COLLECTION_ID="$(create_collection "${ROOT_COLLECTION_NAME}" "Главная коллекция дашбордов и отчетов EGISZ" "#509EE3")"
OP_METRICS_ID="$(create_collection "1. Операционные метрики" "KPI и операционные показатели" "#84BB4C" "${ROOT_COLLECTION_ID}")"
ERROR_ANALYSIS_ID="$(create_collection "2. Аналитика ошибок" "Анализ ошибок и инцидентов" "#ED6E6E" "${ROOT_COLLECTION_ID}")"
CLINIC_ANALYSIS_ID="$(create_collection "3. Клинический анализ" "Анализ работы клиник" "#F9CF48" "${ROOT_COLLECTION_ID}")"
SERVICE_ANALYSIS_ID="$(create_collection "4. Сервисный анализ" "Анализ сервисов и типов СЭМД" "#9CC177" "${ROOT_COLLECTION_ID}")"

KPI_ID="$(create_card \
  "KPI за последние 24 часа" \
  "Общий обзор успешности обменов" \
  "${OP_METRICS_ID}" \
  "SELECT COUNT(*)::bigint AS \"Общее\", COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE ua.status = 'success') / NULLIF(COUNT(*), 0), 2), 0) AS \"Успешность %\", COUNT(DISTINCT NULLIF(TRIM(ua.error_text), ''))::bigint AS \"Уникальные ошибки\" FROM public.v_unified_analytics AS ua WHERE ua.transaction_date >= NOW() - INTERVAL '24 hours';" \
  "table")"

ERROR_DIST_ID="$(create_card \
  "Распределение ошибок (24ч)" \
  "Анализ типов ошибок" \
  "${OP_METRICS_ID}" \
  "SELECT COALESCE(NULLIF(TRIM(ua.error_category_ru), ''), 'Неизвестная') AS \"Категория\", COUNT(*)::bigint AS \"Количество\" FROM public.v_unified_analytics AS ua WHERE ua.is_error AND ua.transaction_date >= NOW() - INTERVAL '24 hours' GROUP BY COALESCE(NULLIF(TRIM(ua.error_category_ru), ''), 'Неизвестная') ORDER BY \"Количество\" DESC;" \
  "pie")"

HOURLY_TREND_ID="$(create_card \
  "Почасовой тренд (24ч)" \
  "Мониторинг активности по часам" \
  "${OP_METRICS_ID}" \
  "WITH series AS (SELECT generate_series(date_trunc('hour', NOW() - INTERVAL '23 hours'), date_trunc('hour', NOW()), INTERVAL '1 hour') AS hour_bucket), aggregated AS (SELECT date_trunc('hour', ua.transaction_date) AS hour_bucket, COUNT(*) FILTER (WHERE ua.is_success)::bigint AS success_count, COUNT(*) FILTER (WHERE ua.is_error)::bigint AS error_count FROM public.v_unified_analytics AS ua WHERE ua.transaction_date >= NOW() - INTERVAL '24 hours' GROUP BY date_trunc('hour', ua.transaction_date)) SELECT s.hour_bucket AS \"Время\", COALESCE(a.success_count, 0)::bigint AS \"Успехи\", COALESCE(a.error_count, 0)::bigint AS \"Ошибки\" FROM series AS s LEFT JOIN aggregated AS a ON a.hour_bucket = s.hour_bucket ORDER BY s.hour_bucket ASC;" \
  "line")"

TOP_ERRORS_ID="$(create_card \
  "Топ ошибок (30 дней)" \
  "Наиболее распространенные проблемы" \
  "${ERROR_ANALYSIS_ID}" \
  "SELECT ua.error_text AS \"Текст ошибки\", COUNT(*)::bigint AS \"Частота\", COUNT(DISTINCT ua.clinic_id)::bigint AS \"Клиник\", MAX(ua.transaction_date) AS \"Последняя\" FROM public.v_unified_analytics AS ua WHERE ua.is_error AND ua.transaction_date >= NOW() - INTERVAL '30 days' GROUP BY ua.error_text ORDER BY \"Частота\" DESC LIMIT 50;" \
  "table")"

ERROR_FINGERPRINTS_ID="$(create_card \
  "Отпечатки ошибок" \
  "Категоризированные группы ошибок" \
  "${ERROR_ANALYSIS_ID}" \
  "SELECT ef.error_category_ru AS \"Категория\", ef.error_subcategory AS \"Подкатегория\", ef.total_occurrences AS \"Всего\", ef.affected_clinics AS \"Клиник\", ef.first_seen_at AS \"Впервые\", ef.last_seen_at AS \"Последняя\" FROM public.v_error_fingerprints AS ef WHERE ef.total_occurrences > 0 ORDER BY ef.total_occurrences DESC LIMIT 100;" \
  "table")"

CLINIC_RELIABILITY_ID="$(create_card \
  "Надежность клиник" \
  "Идентификация проблемных клиник" \
  "${CLINIC_ANALYSIS_ID}" \
  "SELECT COALESCE(NULLIF(TRIM(ua.jname), ''), ua.clinic_display_name) AS \"Клиника\", ua.mo_uid AS \"UID МО\", COUNT(*)::bigint AS \"Запросов\", COUNT(*) FILTER (WHERE ua.is_error)::bigint AS \"Ошибок\", ROUND(100.0 * COUNT(*) FILTER (WHERE ua.is_error) / NULLIF(COUNT(*), 0), 2) AS \"Ошибок %\" FROM public.v_unified_analytics AS ua WHERE ua.transaction_date >= NOW() - INTERVAL '7 days' GROUP BY COALESCE(NULLIF(TRIM(ua.jname), ''), ua.clinic_display_name), ua.mo_uid HAVING COUNT(*) FILTER (WHERE ua.is_error) > 0 ORDER BY \"Ошибок\" DESC LIMIT 20;" \
  "table")"

SERVICE_HEALTH_ID="$(create_card \
  "Здоровье сервисов" \
  "Мониторинг производительности сервисов" \
  "${SERVICE_ANALYSIS_ID}" \
  "SELECT ua.service_display_name AS \"Сервис\", COUNT(*)::bigint AS \"Всего\", COUNT(*) FILTER (WHERE ua.is_success)::bigint AS \"Успешных\", COUNT(*) FILTER (WHERE ua.is_error)::bigint AS \"Ошибок\", ROUND(100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0), 2) AS \"Успешность %\" FROM public.v_unified_analytics AS ua WHERE ua.transaction_date >= NOW() - INTERVAL '7 days' GROUP BY ua.service_display_name ORDER BY \"Ошибок\" DESC;" \
  "table")"

MAIN_DASHBOARD_ID="$(create_dashboard \
  "${MAIN_DASHBOARD_NAME}" \
  "Объединенный дашборд ключевых метрик EGISZ" \
  "${OP_METRICS_ID}" \
  "[{\"card_id\": ${KPI_ID}, \"sizeX\": 12, \"sizeY\": 2, \"row\": 0, \"col\": 0}, {\"card_id\": ${ERROR_DIST_ID}, \"sizeX\": 6, \"sizeY\": 3, \"row\": 2, \"col\": 0}, {\"card_id\": ${HOURLY_TREND_ID}, \"sizeX\": 6, \"sizeY\": 3, \"row\": 2, \"col\": 6}]")"

ERROR_DASHBOARD_ID="$(create_dashboard \
  "${ERROR_DASHBOARD_NAME}" \
  "Детальный разбор всех типов ошибок" \
  "${ERROR_ANALYSIS_ID}" \
  "[{\"card_id\": ${TOP_ERRORS_ID}, \"sizeX\": 12, \"sizeY\": 4, \"row\": 0, \"col\": 0}, {\"card_id\": ${ERROR_FINGERPRINTS_ID}, \"sizeX\": 12, \"sizeY\": 4, \"row\": 4, \"col\": 0}]")"

CLINIC_DASHBOARD_ID="$(create_dashboard \
  "${CLINIC_DASHBOARD_NAME}" \
  "Мониторинг работы медицинских организаций" \
  "${CLINIC_ANALYSIS_ID}" \
  "[{\"card_id\": ${CLINIC_RELIABILITY_ID}, \"sizeX\": 12, \"sizeY\": 4, \"row\": 0, \"col\": 0}]")"

SERVICE_DASHBOARD_ID="$(create_dashboard \
  "${SERVICE_DASHBOARD_NAME}" \
  "Анализ сервисов и типов СЭМД" \
  "${SERVICE_ANALYSIS_ID}" \
  "[{\"card_id\": ${SERVICE_HEALTH_ID}, \"sizeX\": 12, \"sizeY\": 4, \"row\": 0, \"col\": 0}]")"

log_info "Database: ${APP_DB_ID}"
log_info "Root collection: ${ROOT_COLLECTION_ID}"
log_info "Dashboards: ${MAIN_DASHBOARD_ID}, ${ERROR_DASHBOARD_ID}, ${CLINIC_DASHBOARD_ID}, ${SERVICE_DASHBOARD_ID}"
