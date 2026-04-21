#!/bin/bash

set -euo pipefail

METABASE_URL="${METABASE_URL:-http://localhost:3000}"
METABASE_ADMIN_EMAIL="${METABASE_ADMIN_EMAIL:-admin@egisz-monitor.local}"
METABASE_ADMIN_PASSWORD="${METABASE_ADMIN_PASSWORD:-}"
APP_DATABASE_NAME="${APP_DATABASE_NAME:-egisz_monitor}"
APP_DATABASE_USER="${APP_DATABASE_USER:-egisz}"
APP_DATABASE_PASSWORD="${APP_DATABASE_PASSWORD:-egisz}"
COLLECTION_NAME="ЕГИСЗ: Мониторинг интеграции"
MAIN_DASHBOARD_FILE="main_dashboard.json"
PROVISION_MARKER="/tmp/.metabase-provisioned"
PUBLIC_DASHBOARD_UUID_FILE="/shared/main-dashboard-public-uuid"

log() {
  echo "[metabase-init] $1" >&2
}

api_get() {
  local path="$1"
  local session_token="${2:-}"

  if [ -n "${session_token}" ]; then
    curl -fsS "${METABASE_URL}${path}" -H "X-Metabase-Session: ${session_token}"
  else
    curl -fsS "${METABASE_URL}${path}"
  fi
}

api_post() {
  local path="$1"
  local payload="$2"
  local session_token="${3:-}"

  if [ -n "${session_token}" ]; then
    curl -fsS -X POST "${METABASE_URL}${path}" \
      -H "Content-Type: application/json" \
      -H "X-Metabase-Session: ${session_token}" \
      -d "${payload}"
  else
    curl -fsS -X POST "${METABASE_URL}${path}" \
      -H "Content-Type: application/json" \
      -d "${payload}"
  fi
}

api_delete() {
  local path="$1"
  local session_token="$2"

  curl -fsS -X DELETE "${METABASE_URL}${path}" \
    -H "X-Metabase-Session: ${session_token}" >/dev/null
}

api_put() {
  local path="$1"
  local payload="$2"
  local session_token="$3"

  curl -fsS -X PUT "${METABASE_URL}${path}" \
    -H "Content-Type: application/json" \
    -H "X-Metabase-Session: ${session_token}" \
      -d "${payload}"
}

attach_dashcard_via_db() {
  local dashboard_id="$1"
  local card_id="$2"
  local card_payload="$3"

  local size_x
  local size_y
  local row_value
  local col_value

  size_x="$(printf '%s' "${card_payload}" | jq -r '.sizeX // 4')"
  size_y="$(printf '%s' "${card_payload}" | jq -r '.sizeY // 4')"
  row_value="$(printf '%s' "${card_payload}" | jq -r '.row // 0')"
  col_value="$(printf '%s' "${card_payload}" | jq -r '.col // 0')"

  PGPASSWORD="${MB_DB_PASS:-metabase}" psql \
    -h "${MB_DB_HOST:-db}" \
    -p "${MB_DB_PORT:-5432}" \
    -U "${MB_DB_USER:-metabase}" \
    -d "${MB_DB_DBNAME:-metabase}" \
    -v ON_ERROR_STOP=1 \
    -c "INSERT INTO report_dashboardcard (size_x, size_y, row, col, card_id, dashboard_id, parameter_mappings, visualization_settings) VALUES (${size_x}, ${size_y}, ${row_value}, ${col_value}, ${card_id}, ${dashboard_id}, '[]', '{}');" \
    >/dev/null
}

wait_for_metabase() {
  log "Waiting for Metabase health endpoint..."

  for _ in $(seq 1 120); do
    if curl -fsS "${METABASE_URL}/api/health" >/dev/null 2>&1; then
      return 0
    fi

    sleep 2
  done

  log "Metabase health check did not become ready in time"
  return 1
}

get_setup_token() {
  api_get "/api/session/properties" | jq -r '."setup-token" // empty'
}

run_initial_setup() {
  local setup_token
  setup_token="$(get_setup_token)"

  if [ -z "${setup_token}" ]; then
    log "Metabase is already initialized"
    return 0
  fi

  log "Running Metabase initial setup"

  local setup_payload
  setup_payload=$(cat <<EOF
{
  "token": "${setup_token}",
  "user": {
    "first_name": "EGISZ",
    "last_name": "Admin",
    "email": "${METABASE_ADMIN_EMAIL}",
    "password": "${METABASE_ADMIN_PASSWORD}",
    "site_name": "EGISZ Monitor"
  },
  "database": {
    "engine": "postgres",
    "name": "${APP_DATABASE_NAME}",
    "details": {
      "host": "db",
      "port": 5432,
      "dbname": "${APP_DATABASE_NAME}",
      "user": "${APP_DATABASE_USER}",
      "password": "${APP_DATABASE_PASSWORD}",
      "ssl": false,
      "tunnel-enabled": false,
      "advanced-options": false
    }
  },
  "invite": null,
  "prefs": {
    "site_name": "EGISZ Monitor",
    "site_locale": "ru"
  }
}
EOF
)

  local setup_status
  setup_status="$(curl -sS -o /tmp/metabase-setup-response.json -w "%{http_code}" \
    -X POST "${METABASE_URL}/api/setup" \
    -H "Content-Type: application/json" \
    -d "${setup_payload}")"

  if [ "${setup_status}" = "200" ] || [ "${setup_status}" = "403" ]; then
    if [ "${setup_status}" = "403" ]; then
      log "Metabase user already exists or setup is unavailable, continuing with login flow"
    fi
    return 0
  fi

  log "Metabase setup returned HTTP ${setup_status}"
  cat /tmp/metabase-setup-response.json >&2
  return 1
}

create_session() {
  local session_payload
  session_payload=$(cat <<EOF
{
  "username": "${METABASE_ADMIN_EMAIL}",
  "password": "${METABASE_ADMIN_PASSWORD}"
}
EOF
)

  api_post "/api/session" "${session_payload}" | jq -r '.id // empty'
}

get_database_id_by_name() {
  local session_token="$1"
  local database_name="$2"

  api_get "/api/database" "${session_token}" \
    | jq -r --arg name "${database_name}" '.data // . | map(select(.name == $name)) | .[0].id // empty'
}

ensure_application_database() {
  local session_token="$1"
  local database_id
  local database_payload

  database_id="$(get_database_id_by_name "${session_token}" "REPORTS_DB")"

  if [ -n "${database_id}" ]; then
    printf '%s' "${database_id}"
    return 0
  fi

  log "Creating application database REPORTS_DB"
  database_payload=$(cat <<EOF
{
  "engine": "postgres",
  "name": "REPORTS_DB",
  "details": {
    "host": "db",
    "port": 5432,
    "dbname": "${APP_DATABASE_NAME}",
    "user": "${APP_DATABASE_USER}",
    "password": "${APP_DATABASE_PASSWORD}",
    "ssl": false,
    "tunnel-enabled": false,
    "advanced-options": false
  },
  "is_full_sync": true
}
EOF
)

  api_post "/api/database" "${database_payload}" "${session_token}" | jq -r '.id // empty'
}

delete_sample_database() {
  local session_token="$1"
  local sample_database_id

  sample_database_id="$(get_database_id_by_name "${session_token}" "Sample Database")"

  if [ -n "${sample_database_id}" ]; then
    log "Removing Sample Database"
    api_delete "/api/database/${sample_database_id}" "${session_token}" || true
  fi
}

get_collection_id_by_name() {
  local session_token="$1"
  local collection_name="$2"

  api_get "/api/collection" "${session_token}" \
    | jq -r --arg name "${collection_name}" 'map(select(.name == $name)) | .[0].id // empty'
}

ensure_collection() {
  local session_token="$1"
  local collection_id
  local collection_payload

  collection_id="$(get_collection_id_by_name "${session_token}" "${COLLECTION_NAME}")"

  if [ -n "${collection_id}" ]; then
    printf '%s' "${collection_id}"
    return 0
  fi

  collection_payload=$(cat <<EOF
{
  "name": "${COLLECTION_NAME}",
  "description": "Боевые дашборды мониторинга EGISZ",
  "color": "#2F6B4F"
}
EOF
)

  api_post "/api/collection" "${collection_payload}" "${session_token}" | jq -r '.id // empty'
}

dashboard_items() {
  local session_token="$1"
  local collection_id="$2"

  api_get "/api/collection/${collection_id}/items" "${session_token}"
}

dashboard_exists() {
  local session_token="$1"
  local collection_id="$2"
  local dashboard_name="$3"

  dashboard_items "${session_token}" "${collection_id}" \
    | jq -e --arg name "${dashboard_name}" '.data | any(.name == $name)' >/dev/null
}

get_dashboard_id() {
  local session_token="$1"
  local collection_id="$2"
  local dashboard_name="$3"

  dashboard_items "${session_token}" "${collection_id}" \
    | jq -r --arg name "${dashboard_name}" '.data | map(select(.name == $name and .model == "dashboard")) | .[0].id // empty'
}

get_dashboard_dashcard_count() {
  local session_token="$1"
  local dashboard_id="$2"

  api_get "/api/dashboard/${dashboard_id}" "${session_token}" | jq '.dashcards | length'
}

delete_cards_by_names() {
  local session_token="$1"
  local collection_id="$2"
  local dashboard_file="$3"

  while IFS= read -r card_name; do
    [ -n "${card_name}" ] || continue

    while IFS= read -r card_id; do
      [ -n "${card_id}" ] || continue
      api_delete "/api/card/${card_id}" "${session_token}" || true
    done < <(
      dashboard_items "${session_token}" "${collection_id}" \
        | jq -r --arg name "${card_name}" '.data | map(select(.model == "card" and .name == $name)) | .[].id'
    )
  done < <(jq -r '.cards[].name // empty' "${dashboard_file}")
}

create_card() {
  local session_token="$1"
  local collection_id="$2"
  local database_id="$3"
  local card_payload="$4"
  local payload

  payload="$(
    jq -n \
      --argjson collection_id "${collection_id}" \
      --argjson database_id "${database_id}" \
      --argjson card "${card_payload}" \
      '{
      name: $card.name,
      description: ($card.description // ""),
      display: $card.display,
      visualization_settings: ($card.visualization_settings // {}),
      collection_id: $collection_id,
      dataset_query: (
        $card.dataset_query
        | if .type == "native" then .database = $database_id else . end
      )
    }'
  )"

  api_post "/api/card" "${payload}" "${session_token}" | jq -r '.id // empty'
}

create_dashboard_from_file() {
  local session_token="$1"
  local collection_id="$2"
  local database_id="$3"
  local dashboard_file="$4"

  local dashboard_payload
  local dashboard_id

  dashboard_payload="$(
    jq -n \
      --argjson collection_id "${collection_id}" \
      --argjson source "$(cat "${dashboard_file}")" \
      '{
        name: $source.name,
        description: ($source.description // ""),
        collection_id: $collection_id,
        parameters: ($source.parameters // []),
        auto_apply_filters: true
      }'
  )"

  dashboard_id="$(api_post "/api/dashboard" "${dashboard_payload}" "${session_token}" | jq -r '.id // empty')"

  if [ -z "${dashboard_id}" ]; then
    log "Failed to create dashboard from ${dashboard_file}"
    exit 1
  fi

  delete_cards_by_names "${session_token}" "${collection_id}" "${dashboard_file}"

  while IFS= read -r card_payload; do
    local card_id

    card_id="$(create_card "${session_token}" "${collection_id}" "${database_id}" "${card_payload}")"

    if [ -z "${card_id}" ]; then
      log "Failed to create a card for $(extract_dashboard_name "${dashboard_file}")"
      exit 1
    fi

    attach_dashcard_via_db "${dashboard_id}" "${card_id}" "${card_payload}"
  done < <(jq -c '.cards[]' "${dashboard_file}")

  printf '%s' "${dashboard_id}"
}

extract_dashboard_name() {
  local dashboard_file="$1"

  jq -r '.name // empty' "${dashboard_file}"
}

import_dashboards() {
  local session_token="$1"
  local collection_id="$2"
  local database_id="$3"

  shopt -s nullglob

  for dashboard_file in /app/metabase_dashboards/*.json; do
    local dashboard_name
    local existing_dashboard_id=""
    local existing_dashcard_count=0

    dashboard_name="$(extract_dashboard_name "${dashboard_file}")"

    if [ -z "${dashboard_name}" ]; then
      log "Skipping ${dashboard_file}: dashboard name not found"
      continue
    fi

    if dashboard_exists "${session_token}" "${collection_id}" "${dashboard_name}"; then
      existing_dashboard_id="$(get_dashboard_id "${session_token}" "${collection_id}" "${dashboard_name}")"
      existing_dashcard_count="$(get_dashboard_dashcard_count "${session_token}" "${existing_dashboard_id}")"

      if [ "${existing_dashcard_count}" -gt 0 ]; then
        log "Refreshing dashboard from template: ${dashboard_name}"
      else
        log "Dashboard exists but is empty, recreating: ${dashboard_name}"
      fi

      api_delete "/api/dashboard/${existing_dashboard_id}" "${session_token}" || true
    fi

    log "Importing dashboard ${dashboard_name}"
    create_dashboard_from_file "${session_token}" "${collection_id}" "${database_id}" "${dashboard_file}" >/dev/null
  done
}

ensure_main_dashboard_public_link() {
  local session_token="$1"
  local dashboard_id="$2"
  local public_uuid

  public_uuid="$(api_get "/api/dashboard/${dashboard_id}" "${session_token}" | jq -r '.public_uuid // empty')"

  if [ -z "${public_uuid}" ]; then
    log "Creating public link for main dashboard"
    public_uuid="$(api_post "/api/dashboard/${dashboard_id}/public_link" '{}' "${session_token}" | jq -r '.uuid // empty')"
  fi

  if [ -z "${public_uuid}" ]; then
    log "Failed to create or load public UUID for dashboard ${dashboard_id}"
    exit 1
  fi

  mkdir -p "$(dirname "${PUBLIC_DASHBOARD_UUID_FILE}")"
  printf '%s' "${public_uuid}" > "${PUBLIC_DASHBOARD_UUID_FILE}"
  log "Public dashboard UUID stored"
}

main() {
  if [ "${#METABASE_ADMIN_PASSWORD}" -lt 12 ]; then
    log "METABASE_ADMIN_PASSWORD must contain at least 12 characters"
    exit 1
  fi

  wait_for_metabase
  run_initial_setup

  local session_token=""
  for _ in $(seq 1 20); do
    session_token="$(create_session || true)"
    if [ -n "${session_token}" ]; then
      break
    fi

    sleep 3
  done

  if [ -z "${session_token}" ]; then
    log "Failed to create Metabase session"
    exit 1
  fi

  local database_id
  database_id="$(ensure_application_database "${session_token}")"

  if [ -z "${database_id}" ]; then
    log "Application database REPORTS_DB is not available in Metabase"
    exit 1
  fi

  delete_sample_database "${session_token}"

  local collection_id
  collection_id="$(ensure_collection "${session_token}")"

  if [ -z "${collection_id}" ]; then
    log "Failed to ensure collection ${COLLECTION_NAME}"
    exit 1
  fi

  import_dashboards "${session_token}" "${collection_id}" "${database_id}"

  local main_dashboard_name
  main_dashboard_name="$(extract_dashboard_name "/app/metabase_dashboards/${MAIN_DASHBOARD_FILE}")"

  local main_dashboard_id
  main_dashboard_id="$(get_dashboard_id "${session_token}" "${collection_id}" "${main_dashboard_name}")"

  if [ -z "${main_dashboard_id}" ]; then
    log "Main dashboard ${MAIN_DASHBOARD_FILE} was not imported"
    exit 1
  fi

  ensure_main_dashboard_public_link "${session_token}" "${main_dashboard_id}"
  touch "${PROVISION_MARKER}"
  log "Provisioning complete"
}

main "$@"
