#!/bin/bash

# Metabase provisioning script
# This script creates default collections and imports dashboards

set -e

METABASE_URL="http://localhost:3000"
ADMIN_EMAIL="admin@egisz-monitor.local"
ADMIN_PASSWORD="admin123"

echo "Waiting for Metabase to be ready..."
until curl -s "${METABASE_URL}/api/health" > /dev/null; do
  echo "Waiting for Metabase..."
  sleep 5
done

echo "Metabase is ready. Starting provisioning..."

# Setup admin user
echo "Setting up admin user..."
curl -X POST "${METABASE_URL}/api/setup" \
  -H "Content-Type: application/json" \
  -d "{
    \"token\": \"\",
    \"user\": {
      \"first_name\": \"Admin\",
      \"last_name\": \"User\",
      \"email\": \"${ADMIN_EMAIL}\",
      \"password\": \"${ADMIN_PASSWORD}\",
      \"site_name\": \"EGISZ Monitor\"
    },
    \"database\": {
      \"engine\": \"postgres\",
      \"name\": \"egisz_monitor\",
      \"details\": {
        \"host\": \"db\",
        \"port\": 5432,
        \"dbname\": \"egisz_monitor\",
        \"user\": \"egisz\",
        \"password\": \"egisz\"
      }
    },
    \"invite\": null,
    \"prefs\": {
      \"site_name\": \"EGISZ Monitor\",
      \"site_locale\": \"ru\"
    }
  }" || echo "Setup might already be completed"

# Login to get session token
echo "Logging in to get session token..."
SESSION_RESPONSE=$(curl -s -X POST "${METABASE_URL}/api/session" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"${ADMIN_EMAIL}\", \"password\": \"${ADMIN_PASSWORD}\"}")

SESSION_TOKEN=$(echo $SESSION_RESPONSE | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SESSION_TOKEN" ]; then
  echo "Failed to get session token"
  exit 1
fi

echo "Session token obtained: ${SESSION_TOKEN}"

# Create main collection
echo "Creating main collection 'EGISZ Мониторинг'..."
COLLECTION_RESPONSE=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d '{
    "name": "EGISZ Мониторинг",
    "description": "Коллекция дашбордов для мониторинга системы EGISZ",
    "color": "#509EE3"
  }')

COLLECTION_ID=$(echo $COLLECTION_RESPONSE | grep -o '"id":[0-9]*' | cut -d':' -f2)

if [ -z "$COLLECTION_ID" ]; then
  echo "Failed to create collection, trying to find existing one..."
  COLLECTIONS=$(curl -s "${METABASE_URL}/api/collection" \
    -H "X-Metabase-Session: ${SESSION_TOKEN}")
  COLLECTION_ID=$(echo $COLLECTIONS | grep -o '"id":[0-9]*,"name":"EGISZ Мониторинг"' | head -1 | grep -o '"id":[0-9]*' | cut -d':' -f2)
fi

echo "Collection ID: ${COLLECTION_ID}"

# Create subcollections
echo "Creating subcollection 'Операционные метрики'..."
OP_METRICS_RESPONSE=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Операционные метрики\",
    \"description\": \"KPI и операционные показатели\",
    \"color\": \"#84BB4C\",
    \"parent_id\": ${COLLECTION_ID}
  }")

OP_METRICS_ID=$(echo $OP_METRICS_RESPONSE | grep -o '"id":[0-9]*' | cut -d':' -f2)

echo "Creating subcollection 'Аналитика ошибок'..."
ERROR_ANALYTICS_RESPONSE=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Аналитика ошибок\",
    \"description\": \"Анализ ошибок и инцидентов\",
    \"color\": \"#ED6E6E\",
    \"parent_id\": ${COLLECTION_ID}
  }")

ERROR_ANALYTICS_ID=$(echo $ERROR_ANALYTICS_RESPONSE | grep -o '"id":[0-9]*' | cut -d':' -f2)

echo "Creating subcollection 'Клинический анализ'..."
CLINIC_ANALYSIS_RESPONSE=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Клинический анализ\",
    \"description\": \"Анализ работы медицинских организаций\",
    \"color\": \"#F9CF48\",
    \"parent_id\": ${COLLECTION_ID}
  }")

CLINIC_ANALYSIS_ID=$(echo $CLINIC_ANALYSIS_RESPONSE | grep -o '"id":[0-9]*' | cut -d':' -f2)

echo "Creating subcollection 'Сервисный анализ'..."
SERVICE_ANALYSIS_RESPONSE=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Сервисный анализ\",
    \"description\": \"Анализ сервисов и типов СЭМД\",
    \"color\": \"#9CC177\",
    \"parent_id\": ${COLLECTION_ID}
  }")

SERVICE_ANALYSIS_ID=$(echo $SERVICE_ANALYSIS_RESPONSE | grep -o '"id":[0-9]*' | cut -d':' -f2)

# Import dashboards
echo "Importing dashboards..."

# Import main dashboard
if [ -f "/app/metabase_dashboards/main_dashboard.json" ]; then
  echo "Importing main dashboard..."
  DASHBOARD_DATA=$(cat /app/metabase_dashboards/main_dashboard.json | sed "s/\"collection_id\": null/\"collection_id\": ${OP_METRICS_ID}/")
  curl -X POST "${METABASE_URL}/api/dashboard" \
    -H "Content-Type: application/json" \
    -H "X-Metabase-Session: ${SESSION_TOKEN}" \
    -d "$DASHBOARD_DATA" || echo "Failed to import main dashboard"
fi

# Import error analysis dashboard
if [ -f "/app/metabase_dashboards/error_analysis_dashboard.json" ]; then
  echo "Importing error analysis dashboard..."
  DASHBOARD_DATA=$(cat /app/metabase_dashboards/error_analysis_dashboard.json | sed "s/\"collection_id\": null/\"collection_id\": ${ERROR_ANALYTICS_ID}/")
  curl -X POST "${METABASE_URL}/api/dashboard" \
    -H "Content-Type: application/json" \
    -H "X-Metabase-Session: ${SESSION_TOKEN}" \
    -d "$DASHBOARD_DATA" || echo "Failed to import error analysis dashboard"
fi

# Import clinic analysis dashboard
if [ -f "/app/metabase_dashboards/clinic_analysis_dashboard.json" ]; then
  echo "Importing clinic analysis dashboard..."
  DASHBOARD_DATA=$(cat /app/metabase_dashboards/clinic_analysis_dashboard.json | sed "s/\"collection_id\": null/\"collection_id\": ${CLINIC_ANALYSIS_ID}/")
  curl -X POST "${METABASE_URL}/api/dashboard" \
    -H "Content-Type: application/json" \
    -H "X-Metabase-Session: ${SESSION_TOKEN}" \
    -d "$DASHBOARD_DATA" || echo "Failed to import clinic analysis dashboard"
fi

# Import service analysis dashboard
if [ -f "/app/metabase_dashboards/service_analysis_dashboard.json" ]; then
  echo "Importing service analysis dashboard..."
  DASHBOARD_DATA=$(cat /app/metabase_dashboards/service_analysis_dashboard.json | sed "s/\"collection_id\": null/\"collection_id\": ${SERVICE_ANALYSIS_ID}/")
  curl -X POST "${METABASE_URL}/api/dashboard" \
    -H "Content-Type: application/json" \
    -H "X-Metabase-Session: ${SESSION_TOKEN}" \
    -d "$DASHBOARD_DATA" || echo "Failed to import service analysis dashboard"
fi

echo "Provisioning completed successfully!"
echo "Access Metabase at: ${METABASE_URL}"
echo "Admin credentials: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"