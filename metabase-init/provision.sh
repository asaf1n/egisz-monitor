#!/bin/bash
set -euo pipefail

MB_URL="${MB_URL:-http://metabase:3000}"
ADMIN_EMAIL="${METABASE_ADMIN_EMAIL:-${METABASE_ADMIN_USER:-}}"
ADMIN_PASSWORD="${METABASE_ADMIN_PASSWORD:-}"
APP_DB_NAME="${APP_DATABASE_NAME:-egisz_monitor}"
APP_DB_DISPLAY_NAME="${APP_DATABASE_DISPLAY_NAME:-EGISZ Reports}"
APP_DB_USER="${APP_DATABASE_USER:-egisz}"
APP_DB_PASSWORD="${APP_DATABASE_PASSWORD:-egisz}"
SITE_NAME="${METABASE_SITE_NAME:-EGISZ Monitor}"
PUBLIC_UUID_FILE="${METABASE_PUBLIC_UUID_FILE:-/shared/main-dashboard-public-uuid}"

log_info() {
  echo "[provision] $1"
}

if [ -z "${ADMIN_EMAIL}" ] || [ -z "${ADMIN_PASSWORD}" ]; then
  echo "Metabase admin credentials are not configured"
  exit 1
fi

log_info "Waiting for Metabase API at ${MB_URL}..."
until curl --output /dev/null --silent --fail "${MB_URL}/api/health"; do
  printf '.'
  sleep 5
done
echo

PROPERTIES="$(curl -s "${MB_URL}/api/session/properties")"
HAS_USER_SETUP="$(echo "${PROPERTIES}" | jq -r '."has-user-setup"')"

if [ "${HAS_USER_SETUP}" != "true" ]; then
  SETUP_TOKEN="$(echo "${PROPERTIES}" | jq -r '."setup-token"')"

  if [ -z "${SETUP_TOKEN}" ] || [ "${SETUP_TOKEN}" = "null" ]; then
    echo "Metabase setup token is missing"
    exit 1
  fi

  log_info "Bootstrapping Metabase admin user..."
  SETUP_PAYLOAD="$(jq -n \
    --arg token "${SETUP_TOKEN}" \
    --arg email "${ADMIN_EMAIL}" \
    --arg password "${ADMIN_PASSWORD}" \
    --arg siteName "${SITE_NAME}" \
    --arg dbName "${APP_DB_DISPLAY_NAME}" \
    --arg dbRealName "${APP_DB_NAME}" \
    --arg dbUser "${APP_DB_USER}" \
    --arg dbPassword "${APP_DB_PASSWORD}" \
    '{
      token: $token,
      user: {
        first_name: "EGISZ",
        last_name: "Admin",
        email: $email,
        password: $password
      },
      database: {
        engine: "postgres",
        name: $dbName,
        details: {
          host: "db",
          port: 5432,
          dbname: $dbRealName,
          user: $dbUser,
          password: $dbPassword,
          ssl: false,
          "tunnel-enabled": false,
          "advanced-options": false
        }
      },
      prefs: {
        site_name: $siteName,
        site_locale: "ru"
      }
    }')"

  RESPONSE="$(curl -s -w '\n%{http_code}' -X POST "${MB_URL}/api/setup" \
    -H "Content-Type: application/json" \
    -d "${SETUP_PAYLOAD}")"

  HTTP_CODE="$(echo "${RESPONSE}" | tail -n1)"
  BODY="$(echo "${RESPONSE}" | sed '$d')"

  if [ "${HTTP_CODE}" != "200" ]; then
    echo "Metabase setup failed with HTTP ${HTTP_CODE}"
    echo "${BODY}"
    exit 1
  fi
fi

if [ -x /app/setup-dashboards.sh ]; then
  log_info "Running dashboard provisioning..."
  ADMIN_EMAIL="${ADMIN_EMAIL}" \
  ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  DB_NAME="${APP_DB_NAME}" \
  DB_DISPLAY_NAME="${APP_DB_DISPLAY_NAME}" \
  DB_USER="${APP_DB_USER}" \
  DB_PASSWORD="${APP_DB_PASSWORD}" \
  METABASE_URL="${MB_URL}" \
  /app/setup-dashboards.sh
fi

log_info "Authenticating in Metabase..."
SESSION_TOKEN="$(curl -s -X POST "${MB_URL}/api/session" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" | jq -r '.id')"

if [ -z "${SESSION_TOKEN}" ] || [ "${SESSION_TOKEN}" = "null" ]; then
  echo "Failed to authenticate in Metabase"
  exit 1
fi

DASHBOARD_ID="$(curl -s "${MB_URL}/api/dashboard" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" | jq -r '[.[] | select(.name == "🟢 Главный мониторинг")] | sort_by(.id) | last | .id // empty')"

if [ -n "${DASHBOARD_ID}" ]; then
  PUBLIC_UUID="$(curl -s "${MB_URL}/api/dashboard/${DASHBOARD_ID}" \
    -H "X-Metabase-Session: ${SESSION_TOKEN}" | jq -r '.public_uuid // empty')"

  if [ -z "${PUBLIC_UUID}" ] || [ "${PUBLIC_UUID}" = "null" ]; then
    PUBLIC_UUID="$(curl -s -X POST "${MB_URL}/api/dashboard/${DASHBOARD_ID}/public_link" \
      -H "Content-Type: application/json" \
      -H "X-Metabase-Session: ${SESSION_TOKEN}" \
      -d '{}' | jq -r '.uuid // empty')"
  fi

  if [ -n "${PUBLIC_UUID}" ] && [ "${PUBLIC_UUID}" != "null" ]; then
    mkdir -p "$(dirname "${PUBLIC_UUID_FILE}")"
    printf '%s' "${PUBLIC_UUID}" > "${PUBLIC_UUID_FILE}"
    log_info "Published dashboard UUID: ${PUBLIC_UUID}"
  fi
fi

log_info "Metabase provisioning finished successfully"
