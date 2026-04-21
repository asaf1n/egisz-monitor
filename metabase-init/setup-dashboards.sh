#!/bin/bash

# Metabase Complete Provisioning Script
# Creates collections, saved questions, and dashboards from scratch

set -e

METABASE_URL="${METABASE_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@egisz-monitor.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
DB_NAME="${DB_NAME:-egisz_monitor}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Wait for Metabase
log_info "Waiting for Metabase at $METABASE_URL..."
for i in {1..30}; do
    if curl -s "${METABASE_URL}/api/health" > /dev/null 2>&1; then
        log_info "Metabase is ready"
        break
    fi
    echo "Waiting... ($i/30)"
    sleep 2
done

# Get or create session
log_info "Setting up Metabase admin user..."
SETUP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${METABASE_URL}/api/setup" \
  -H "Content-Type: application/json" \
  -d "{
    \"token\": \"\",
    \"user\": {
      \"first_name\": \"Admin\",
      \"last_name\": \"User\",
      \"email\": \"${ADMIN_EMAIL}\",
      \"password\": \"${ADMIN_PASSWORD}\"
    },
    \"database\": {
      \"engine\": \"postgres\",
      \"name\": \"${DB_NAME}\",
      \"details\": {
        \"host\": \"db\",
        \"port\": 5432,
        \"dbname\": \"${DB_NAME}\",
        \"user\": \"egisz\",
        \"password\": \"egisz\",
        \"ssl\": false,
        \"tunnel-enabled\": false,
        \"advanced-options\": false
      }
    },
    \"prefs\": {
      \"site_name\": \"EGISZ Monitor\",
      \"site_locale\": \"ru\"
    }
  }" 2>&1)

HTTP_CODE=$(echo "$SETUP_RESPONSE" | tail -n1)
SETUP_BODY=$(echo "$SETUP_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    log_info "Metabase setup completed"
elif echo "$SETUP_BODY" | grep -q "already been initialized"; then
    log_warn "Metabase already initialized"
else
    log_warn "Setup response: $HTTP_CODE"
fi

# Login and get session
log_info "Authenticating as admin..."
SESSION_RESPONSE=$(curl -s -X POST "${METABASE_URL}/api/session" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"${ADMIN_EMAIL}\", \"password\": \"${ADMIN_PASSWORD}\"}")

SESSION_TOKEN=$(echo "$SESSION_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$SESSION_TOKEN" ]; then
    log_error "Failed to get session token"
    echo "Response: $SESSION_RESPONSE"
    exit 1
fi

log_info "Session token obtained"

# Get database ID
log_info "Getting database ID..."
DB_RESPONSE=$(curl -s "${METABASE_URL}/api/database" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}")

DB_ID=$(echo "$DB_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -z "$DB_ID" ]; then
    log_error "Failed to get database ID"
    exit 1
fi

log_info "Database ID: $DB_ID"

# Create Main Collection
log_info "Creating main collection 'EGISZ Мониторинг'..."
MAIN_COLLECTION=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d '{
    "name": "EGISZ Мониторинг",
    "description": "Главная коллекция дашбордов и отчётов",
    "color": "#509EE3"
  }')

MAIN_COLLECTION_ID=$(echo "$MAIN_COLLECTION" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -z "$MAIN_COLLECTION_ID" ]; then
    log_error "Failed to create main collection"
    exit 1
fi

log_info "Main collection created with ID: $MAIN_COLLECTION_ID"

# Create Subcollections
log_info "Creating subcollections..."

OP_METRICS=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{\"name\": \"1. Операционные метрики\", \"description\": \"KPI и операционные показатели\", \"color\": \"#84BB4C\", \"parent_id\": $MAIN_COLLECTION_ID}")
OP_METRICS_ID=$(echo "$OP_METRICS" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

ERROR_ANALYSIS=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{\"name\": \"2. Аналитика ошибок\", \"description\": \"Анализ ошибок и инцидентов\", \"color\": \"#ED6E6E\", \"parent_id\": $MAIN_COLLECTION_ID}")
ERROR_ANALYSIS_ID=$(echo "$ERROR_ANALYSIS" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

CLINIC_ANALYSIS=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{\"name\": \"3. Клинический анализ\", \"description\": \"Анализ работы клиник\", \"color\": \"#F9CF48\", \"parent_id\": $MAIN_COLLECTION_ID}")
CLINIC_ANALYSIS_ID=$(echo "$CLINIC_ANALYSIS" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

SERVICE_ANALYSIS=$(curl -s -X POST "${METABASE_URL}/api/collection" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{\"name\": \"4. Сервисный анализ\", \"description\": \"Анализ сервисов и типов СЭМД\", \"color\": \"#9CC177\", \"parent_id\": $MAIN_COLLECTION_ID}")
SERVICE_ANALYSIS_ID=$(echo "$SERVICE_ANALYSIS" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

log_info "Subcollections created"
log_info "  - Операционные метрики: $OP_METRICS_ID"
log_info "  - Аналитика ошибок: $ERROR_ANALYSIS_ID"
log_info "  - Клинический анализ: $CLINIC_ANALYSIS_ID"
log_info "  - Сервисный анализ: $SERVICE_ANALYSIS_ID"

# Create Saved Questions (Operational Metrics)
log_info "Creating saved questions..."

# KPI за 24 часа
KPI_QUESTION=$(curl -s -X POST "${METABASE_URL}/api/card" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"KPI за последние 24 часа\",
    \"description\": \"Общий обзор успешности обменов\",
    \"collection_id\": $OP_METRICS_ID,
    \"dataset_query\": {
      \"type\": \"native\",
      \"native\": {
        \"query\": \"SELECT COUNT(*)::bigint AS 'Общее', COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE ua.status = 'success') / NULLIF(COUNT(*), 0), 2), 0) AS 'Успешность %', COUNT(DISTINCT NULLIF(TRIM(ua.error_text), ''))::bigint AS 'Уникальные ошибки' FROM public.v_unified_analytics AS ua WHERE ua.transaction_date >= NOW() - INTERVAL '24 hours';\"
      },
      \"database\": $DB_ID
    },
    \"display\": \"table\",
    \"visualization_settings\": {}
  }")
KPI_ID=$(echo "$KPI_QUESTION" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# Распределение ошибок
ERROR_DIST=$(curl -s -X POST "${METABASE_URL}/api/card" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Распределение ошибок (24ч)\",
    \"description\": \"Анализ типов ошибок\",
    \"collection_id\": $OP_METRICS_ID,
    \"dataset_query\": {
      \"type\": \"native\",
      \"native\": {
        \"query\": \"SELECT COALESCE(NULLIF(TRIM(ua.error_category_ru), ''), 'Неизвестная') AS 'Категория', COUNT(*)::bigint AS 'Количество' FROM public.v_unified_analytics AS ua WHERE ua.is_error AND ua.transaction_date >= NOW() - INTERVAL '24 hours' GROUP BY COALESCE(NULLIF(TRIM(ua.error_category_ru), ''), 'Неизвестная') ORDER BY 'Количество' DESC;\"
      },
      \"database\": $DB_ID
    },
    \"display\": \"pie\",
    \"visualization_settings\": {}
  }")
ERROR_DIST_ID=$(echo "$ERROR_DIST" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# Почасовой тренд
HOURLY_TREND=$(curl -s -X POST "${METABASE_URL}/api/card" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Почасовой тренд (24ч)\",
    \"description\": \"Мониторинг активности по часам\",
    \"collection_id\": $OP_METRICS_ID,
    \"dataset_query\": {
      \"type\": \"native\",
      \"native\": {
        \"query\": \"WITH series AS (SELECT generate_series(date_trunc('hour', NOW() - INTERVAL '23 hours'), date_trunc('hour', NOW()), INTERVAL '1 hour') AS hour_bucket), aggregated AS (SELECT date_trunc('hour', ua.transaction_date) AS hour_bucket, COUNT(*) FILTER (WHERE ua.is_success)::bigint AS success_count, COUNT(*) FILTER (WHERE ua.is_error)::bigint AS error_count FROM public.v_unified_analytics AS ua WHERE ua.transaction_date >= NOW() - INTERVAL '24 hours' GROUP BY date_trunc('hour', ua.transaction_date)) SELECT s.hour_bucket AS 'Время', COALESCE(a.success_count, 0)::bigint AS 'Успехи', COALESCE(a.error_count, 0)::bigint AS 'Ошибки' FROM series AS s LEFT JOIN aggregated AS a ON a.hour_bucket = s.hour_bucket ORDER BY s.hour_bucket ASC;\"
      },
      \"database\": $DB_ID
    },
    \"display\": \"line\",
    \"visualization_settings\": {}
  }")
HOURLY_TREND_ID=$(echo "$HOURLY_TREND" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# Надёжность клиник
CLINIC_RELIABILITY=$(curl -s -X POST "${METABASE_URL}/api/card" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Надёжность клиник (топ проблемные)\",
    \"description\": \"Идентификация проблемных клиник\",
    \"collection_id\": $CLINIC_ANALYSIS_ID,
    \"dataset_query\": {
      \"type\": \"native\",
      \"native\": {
        \"query\": \"SELECT COALESCE(NULLIF(TRIM(ua.jname), ''), ua.clinic_display_name) AS 'Клиника', ua.mo_uid AS 'UID МО', COUNT(*)::bigint AS 'Запросов', COUNT(*) FILTER (WHERE ua.is_error)::bigint AS 'Ошибок', ROUND(100.0 * COUNT(*) FILTER (WHERE ua.is_error) / NULLIF(COUNT(*), 0), 2) AS 'Ошибок %' FROM public.v_unified_analytics AS ua WHERE ua.transaction_date >= NOW() - INTERVAL '7 days' GROUP BY COALESCE(NULLIF(TRIM(ua.jname), ''), ua.clinic_display_name), ua.mo_uid HAVING COUNT(*) FILTER (WHERE ua.is_error) > 0 ORDER BY 'Ошибок' DESC LIMIT 20;\"
      },
      \"database\": $DB_ID
    },
    \"display\": \"table\",
    \"visualization_settings\": {}
  }")
CLINIC_RELIABILITY_ID=$(echo "$CLINIC_RELIABILITY" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# Здоровье сервисов
SERVICE_HEALTH=$(curl -s -X POST "${METABASE_URL}/api/card" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Здоровье сервисов\",
    \"description\": \"Мониторинг производительности сервисов\",
    \"collection_id\": $SERVICE_ANALYSIS_ID,
    \"dataset_query\": {
      \"type\": \"native\",
      \"native\": {
        \"query\": \"SELECT ua.service_display_name AS 'Сервис', COUNT(*)::bigint AS 'Всего', COUNT(*) FILTER (WHERE ua.is_success)::bigint AS 'Успешных', COUNT(*) FILTER (WHERE ua.is_error)::bigint AS 'Ошибок', ROUND(100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0), 2) AS 'Успешность %' FROM public.v_unified_analytics AS ua WHERE ua.transaction_date >= NOW() - INTERVAL '7 days' GROUP BY ua.service_display_name ORDER BY 'Ошибок' DESC;\"
      },
      \"database\": $DB_ID
    },
    \"display\": \"table\",
    \"visualization_settings\": {}
  }")
SERVICE_HEALTH_ID=$(echo "$SERVICE_HEALTH" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# Топ ошибок
TOP_ERRORS=$(curl -s -X POST "${METABASE_URL}/api/card" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Топ ошибок (30 дней)\",
    \"description\": \"Наиболее распространённые проблемы\",
    \"collection_id\": $ERROR_ANALYSIS_ID,
    \"dataset_query\": {
      \"type\": \"native\",
      \"native\": {
        \"query\": \"SELECT ua.error_text AS 'Текст ошибки', COUNT(*)::bigint AS 'Частота', COUNT(DISTINCT ua.clinic_id)::bigint AS 'Клиник', MAX(ua.transaction_date) AS 'Последняя' FROM public.v_unified_analytics AS ua WHERE ua.is_error AND ua.transaction_date >= NOW() - INTERVAL '30 days' GROUP BY ua.error_text ORDER BY 'Частота' DESC LIMIT 50;\"
      },
      \"database\": $DB_ID
    },
    \"display\": \"table\",
    \"visualization_settings\": {}
  }")
TOP_ERRORS_ID=$(echo "$TOP_ERRORS" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# Отпечатки ошибок
ERROR_FINGERPRINTS=$(curl -s -X POST "${METABASE_URL}/api/card" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"Отпечатки ошибок\",
    \"description\": \"Категоризированные группы ошибок\",
    \"collection_id\": $ERROR_ANALYSIS_ID,
    \"dataset_query\": {
      \"type\": \"native\",
      \"native\": {
        \"query\": \"SELECT ef.error_category_ru AS 'Категория', ef.error_subcategory AS 'Подкатегория', ef.total_occurrences AS 'Всего', ef.affected_clinics AS 'Клиник', ef.first_seen_at AS 'Впервые', ef.last_seen_at AS 'Последняя' FROM public.v_error_fingerprints AS ef WHERE ef.total_occurrences > 0 ORDER BY ef.total_occurrences DESC LIMIT 100;\"
      },
      \"database\": $DB_ID
    },
    \"display\": \"table\",
    \"visualization_settings\": {}
  }")
ERROR_FINGERPRINTS_ID=$(echo "$ERROR_FINGERPRINTS" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

log_info "Saved questions created"
log_info "  - KPI: $KPI_ID"
log_info "  - Ошибки: $ERROR_DIST_ID"
log_info "  - Тренд: $HOURLY_TREND_ID"

# Create Dashboards
log_info "Creating dashboards..."

# Main Dashboard
MAIN_DASHBOARD=$(curl -s -X POST "${METABASE_URL}/api/dashboard" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"🟢 Главный мониторинг\",
    \"description\": \"Объединённый дашборд ключевых метрик EGISZ\",
    \"collection_id\": $OP_METRICS_ID,
    \"cacheables\": [],
    \"dashcards\": [
      {\"card_id\": $KPI_ID, \"sizeX\": 12, \"sizeY\": 2, \"row\": 0, \"col\": 0},
      {\"card_id\": $ERROR_DIST_ID, \"sizeX\": 6, \"sizeY\": 3, \"row\": 2, \"col\": 0},
      {\"card_id\": $HOURLY_TREND_ID, \"sizeX\": 6, \"sizeY\": 3, \"row\": 2, \"col\": 6}
    ]
  }")
MAIN_DASHBOARD_ID=$(echo "$MAIN_DASHBOARD" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# Error Analysis Dashboard
ERROR_DASHBOARD=$(curl -s -X POST "${METABASE_URL}/api/dashboard" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"🔴 Аналитика ошибок\",
    \"description\": \"Детальный разбор всех типов ошибок\",
    \"collection_id\": $ERROR_ANALYSIS_ID,
    \"cacheables\": [],
    \"dashcards\": [
      {\"card_id\": $TOP_ERRORS_ID, \"sizeX\": 12, \"sizeY\": 4, \"row\": 0, \"col\": 0},
      {\"card_id\": $ERROR_FINGERPRINTS_ID, \"sizeX\": 12, \"sizeY\": 4, \"row\": 4, \"col\": 0}
    ]
  }")
ERROR_DASHBOARD_ID=$(echo "$ERROR_DASHBOARD" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# Clinic Analysis Dashboard
CLINIC_DASHBOARD=$(curl -s -X POST "${METABASE_URL}/api/dashboard" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"🏥 Клинический анализ\",
    \"description\": \"Мониторинг работы медицинских организаций\",
    \"collection_id\": $CLINIC_ANALYSIS_ID,
    \"cacheables\": [],
    \"dashcards\": [
      {\"card_id\": $CLINIC_RELIABILITY_ID, \"sizeX\": 12, \"sizeY\": 4, \"row\": 0, \"col\": 0}
    ]
  }")
CLINIC_DASHBOARD_ID=$(echo "$CLINIC_DASHBOARD" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# Service Analysis Dashboard
SERVICE_DASHBOARD=$(curl -s -X POST "${METABASE_URL}/api/dashboard" \
  -H "Content-Type: application/json" \
  -H "X-Metabase-Session: ${SESSION_TOKEN}" \
  -d "{
    \"name\": \"⚙️ Сервисный анализ\",
    \"description\": \"Анализ сервисов и типов СЭМД\",
    \"collection_id\": $SERVICE_ANALYSIS_ID,
    \"cacheables\": [],
    \"dashcards\": [
      {\"card_id\": $SERVICE_HEALTH_ID, \"sizeX\": 12, \"sizeY\": 4, \"row\": 0, \"col\": 0}
    ]
  }")
SERVICE_DASHBOARD_ID=$(echo "$SERVICE_DASHBOARD" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

log_info "Dashboards created"
log_info "  - Главный мониторинг: $MAIN_DASHBOARD_ID"
log_info "  - Аналитика ошибок: $ERROR_DASHBOARD_ID"
log_info "  - Клинический анализ: $CLINIC_DASHBOARD_ID"
log_info "  - Сервисный анализ: $SERVICE_DASHBOARD_ID"

log_info "=========================================="
log_info "✅ Provisioning completed successfully!"
log_info "=========================================="
log_info "Access Metabase at: $METABASE_URL"
log_info "Admin credentials: $ADMIN_EMAIL / $ADMIN_PASSWORD"
log_info ""
log_info "Collections created:"
log_info "  📁 EGISZ Мониторинг"
log_info "     └─ 1. Операционные метрики (ID: $OP_METRICS_ID)"
log_info "     └─ 2. Аналитика ошибок (ID: $ERROR_ANALYSIS_ID)"
log_info "     └─ 3. Клинический анализ (ID: $CLINIC_ANALYSIS_ID)"
log_info "     └─ 4. Сервисный анализ (ID: $SERVICE_ANALYSIS_ID)"
log_info ""
log_info "Dashboards created:"
log_info "  🟢 Главный мониторинг (ID: $MAIN_DASHBOARD_ID)"
log_info "  🔴 Аналитика ошибок (ID: $ERROR_DASHBOARD_ID)"
log_info "  🏥 Клинический анализ (ID: $CLINIC_DASHBOARD_ID)"
log_info "  ⚙️ Сервисный анализ (ID: $SERVICE_DASHBOARD_ID)"

exit 0
