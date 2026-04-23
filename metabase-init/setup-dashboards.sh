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
BUSINESS_COLLECTION_NAME="1. Статистика отправки"
TECH_COLLECTION_NAME="2. Технические метрики"
BUSINESS_DASHBOARD_NAME="Бизнес-мониторинг"
TECH_DASHBOARD_NAME="Технический анализ"

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

for collection_id in $(api_request GET "/api/collection" | jq -r '.[] | select(.name | test("^EGISZ")) | .id' | sort -nr); do
  delete_collection_tree "${collection_id}"
done

authenticate
APP_DB_ID="$(ensure_app_database)"

ROOT_COLLECTION_ID="$(create_collection "${ROOT_COLLECTION_NAME}" "Коллекция дашбордов EGISZ: бизнес/продукт и технический мониторинг" "#509EE3")"
BUSINESS_COLLECTION_ID="$(create_collection "${BUSINESS_COLLECTION_NAME}" "Управленческая и продуктовая аналитика" "#84BB4C" "${ROOT_COLLECTION_ID}")"
TECH_COLLECTION_ID="$(create_collection "${TECH_COLLECTION_NAME}" "Диагностика и эксплуатационный мониторинг" "#ED6E6E" "${ROOT_COLLECTION_ID}")"

SERVICE_PENETRATION_ID="$(create_card \
  "Проникновение сервиса" \
  "Доля активных клиник за 30 дней от общего зарегистрированного пула" \
  "${BUSINESS_COLLECTION_ID}" \
  "WITH total AS (SELECT COUNT(DISTINCT dc.jid)::bigint AS total_registered FROM public.dim_clinics dc WHERE dc.jid IS NOT NULL AND dc.mo_uid <> 'ghost-log-group-9901'), active AS (SELECT COUNT(DISTINCT ua.jid)::bigint AS active_30d FROM public.v_unified_analytics ua WHERE ua.jid IS NOT NULL AND ua.transaction_date >= NOW() - INTERVAL '30 days') SELECT total.total_registered AS \"Всего зарегистрированных клиник\", active.active_30d AS \"Активные клиники (30д)\", COALESCE(ROUND(100.0 * active.active_30d / NULLIF(total.total_registered, 0), 2), 0) AS \"Проникновение сервиса, %\" FROM total CROSS JOIN active;" \
  "table")"

DOC_SUCCESS_ID="$(create_card \
  "Успешность по типам документов" \
  "Success/Error по KIND (document_type)" \
  "${BUSINESS_COLLECTION_ID}" \
  "SELECT COALESCE(NULLIF(TRIM(ua.document_type), ''), NULLIF(TRIM(ua.service_kind), ''), 'Не указан') AS \"KIND\", COUNT(*)::bigint AS \"Всего\", COUNT(*) FILTER (WHERE ua.is_success)::bigint AS \"Успешно\", COUNT(*) FILTER (WHERE ua.is_error)::bigint AS \"Ошибки\", COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0), 2), 0) AS \"Успешность, %\", COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE ua.is_error) / NULLIF(COUNT(*), 0), 2), 0) AS \"Ошибки, %\" FROM public.v_unified_analytics ua WHERE ua.transaction_date >= NOW() - INTERVAL '30 days' GROUP BY COALESCE(NULLIF(TRIM(ua.document_type), ''), NULLIF(TRIM(ua.service_kind), ''), 'Не указан') ORDER BY \"Всего\" DESC;" \
  "bar")"

TOP_CLINICS_ID="$(create_card \
  "Динамика по ЮЛ" \
  "Топ-активные клиники по объему транзакций за 30 дней" \
  "${BUSINESS_COLLECTION_ID}" \
  "SELECT ua.jid AS \"JID\", ua.clinic_display_name AS \"Клиника\", COUNT(*)::bigint AS \"Транзакций\", COUNT(*) FILTER (WHERE ua.is_success)::bigint AS \"Успешно\", COUNT(*) FILTER (WHERE ua.is_error)::bigint AS \"Ошибки\" FROM public.v_unified_analytics ua WHERE ua.jid IS NOT NULL AND ua.transaction_date >= NOW() - INTERVAL '30 days' GROUP BY ua.jid, ua.clinic_display_name ORDER BY \"Транзакций\" DESC, ua.clinic_display_name ASC LIMIT 30;" \
  "bar")"

ERROR_MATRIX_ID="$(create_card \
  "Матрица ошибок" \
  "Свод ошибок: KIND x категория" \
  "${TECH_COLLECTION_ID}" \
  "SELECT COALESCE(NULLIF(TRIM(ua.document_type), ''), NULLIF(TRIM(ua.service_kind), ''), 'Не указан') AS \"KIND\", COALESCE(NULLIF(TRIM(ua.error_category), ''), 'Прочие ошибки') AS \"Категория ошибки\", COUNT(*)::bigint AS \"Количество\" FROM public.v_unified_analytics ua WHERE ua.is_error AND ua.transaction_date >= NOW() - INTERVAL '30 days' GROUP BY 1, 2 ORDER BY 1 ASC, 3 DESC;" \
  "table")"

AVAIL_HEATMAP_ID="$(create_card \
  "Heatmap доступности" \
  "Плотность ошибок по JID в почасовом разрезе" \
  "${TECH_COLLECTION_ID}" \
  "SELECT date_trunc('hour', ua.transaction_date) AS \"Час\", ua.jid AS \"JID\", COUNT(*) FILTER (WHERE ua.is_error)::bigint AS \"Ошибки\" FROM public.v_unified_analytics ua WHERE ua.jid IS NOT NULL AND ua.transaction_date >= NOW() - INTERVAL '7 days' GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC;" \
  "heatmap")"

TOP_CRITICAL_ID="$(create_card \
  "Топ критических ошибок" \
  "Нормализованные ошибки (clean_error_text) с максимальной частотой" \
  "${TECH_COLLECTION_ID}" \
  "SELECT COALESCE(NULLIF(TRIM(ua.clean_error_text), ''), '[пусто]') AS \"Нормализованный текст\", COALESCE(NULLIF(TRIM(ua.error_category), ''), 'Прочие ошибки') AS \"Категория\", COUNT(*)::bigint AS \"Частота\", COUNT(DISTINCT ua.jid)::bigint AS \"Клиник\", MAX(ua.transaction_date) AS \"Последний инцидент\" FROM public.v_unified_analytics ua WHERE ua.is_error AND ua.transaction_date >= NOW() - INTERVAL '30 days' GROUP BY 1, 2 ORDER BY \"Частота\" DESC, 1 ASC LIMIT 50;" \
  "table")"

BUSINESS_DASHBOARD_ID="$(create_dashboard \
  "${BUSINESS_DASHBOARD_NAME}" \
  "Управленческий и продуктовый контур мониторинга" \
  "${BUSINESS_COLLECTION_ID}" \
  "[{\"card_id\": ${SERVICE_PENETRATION_ID}, \"sizeX\": 8, \"sizeY\": 3, \"row\": 0, \"col\": 0}, {\"card_id\": ${DOC_SUCCESS_ID}, \"sizeX\": 16, \"sizeY\": 3, \"row\": 0, \"col\": 8}, {\"card_id\": ${TOP_CLINICS_ID}, \"sizeX\": 24, \"sizeY\": 5, \"row\": 3, \"col\": 0}]")"

TECH_DASHBOARD_ID="$(create_dashboard \
  "${TECH_DASHBOARD_NAME}" \
  "Технический контур мониторинга и диагностики" \
  "${TECH_COLLECTION_ID}" \
  "[{\"card_id\": ${ERROR_MATRIX_ID}, \"sizeX\": 12, \"sizeY\": 4, \"row\": 0, \"col\": 0}, {\"card_id\": ${AVAIL_HEATMAP_ID}, \"sizeX\": 12, \"sizeY\": 4, \"row\": 0, \"col\": 12}, {\"card_id\": ${TOP_CRITICAL_ID}, \"sizeX\": 24, \"sizeY\": 5, \"row\": 4, \"col\": 0}]")"

log_info "Database: ${APP_DB_ID}"
log_info "Root collection: ${ROOT_COLLECTION_ID}"
log_info "Dashboards: ${BUSINESS_DASHBOARD_ID}, ${TECH_DASHBOARD_ID}"
