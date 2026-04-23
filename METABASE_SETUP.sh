#!/bin/bash
# Metabase Persistence Setup - Quick Reference

cat << 'EOF'
╔════════════════════════════════════════════════════════════════════════════╗
║              Metabase PostgreSQL Persistence - Setup Guide                 ║
╚════════════════════════════════════════════════════════════════════════════╝

✓ CONFIGURATION COMPLETE

The following changes have been applied:

1. PostgreSQL Database Service (docker-compose.yml)
   ├─ shared_buffers: 256MB → 512MB
   ├─ max_connections: 200 → 300
   ├─ idle_in_transaction_session_timeout: 0 (ETL-friendly)
   ├─ statement_timeout: 0 (no query time limits)
   └─ Healthcheck: Enhanced timeout (15s/10s/8x/20s)

2. Metabase Service (docker-compose.yml)
   ├─ Backend: H2 → PostgreSQL (persistent)
   ├─ Database: metabase_db (isolated)
   ├─ Connection pooling: 10 max, 5 min idle
   ├─ Query timeout: 3600s (1 hour)
   └─ Healthcheck: Extended startup (180s)

3. Database Initialization (postgres/init/02-metabase.sql)
   ├─ Creates metabase user
   ├─ Creates metabase_db
   ├─ Sets up permissions
   └─ Disables timeouts for ETL

4. Environment Configuration (.env.example)
   ├─ MB_DB_NAME=metabase_db
   ├─ MB_DB_USER=metabase
   ├─ Optional connection pooling parameters
   └─ Query timeout documentation

═══════════════════════════════════════════════════════════════════════════════

DEPLOYMENT STEPS:

1. Start the stack:
   $ docker-compose up -d

2. Verify database readiness:
   $ docker exec egisz-monitor-db pg_isready -U metabase -d metabase_db
   accepting connections

3. Check Metabase initialization (takes ~2-3 minutes):
   $ docker logs -f egisz-monitor-metabase

4. Verify Metabase tables exist:
   $ docker exec egisz-monitor-db psql -U metabase -d metabase_db -c "\dt"

5. Access Metabase:
   http://localhost:3001

═══════════════════════════════════════════════════════════════════════════════

VERIFICATION CHECKLIST:

  [ ] Docker Compose validates without errors
      $ docker-compose config --quiet

  [ ] All services start successfully
      $ docker-compose ps

  [ ] PostgreSQL healthcheck passes
      $ docker exec egisz-monitor-db pg_isready -U metabase -d metabase_db

  [ ] Metabase is accessible and healthy
      $ curl http://localhost:3001/api/health

  [ ] Metabase metadata tables exist
      $ docker exec egisz-monitor-db psql -U metabase -d metabase_db -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"

  [ ] Long ETL queries don't timeout
      $ docker logs egisz-monitor-metabase | grep -i "timeout" (should be empty)

═══════════════════════════════════════════════════════════════════════════════

KEY ENVIRONMENT VARIABLES (in .env):

MB_DB_NAME=metabase_db
MB_DB_USER=metabase
MB_DB_PASS=metabase

# Optional ETL tuning (uncomment if needed):
# MB_DB_POOL_SIZE=15                  # Increase for more concurrent connections
# MB_DB_CONNECTION_TIMEOUT_MS=120000  # 2-minute timeout for slow networks
# MB_QUERY_TIMEOUT_SECONDS=7200       # 2-hour timeout for very long queries

═══════════════════════════════════════════════════════════════════════════════

MONITORING COMMANDS:

Check active connections:
  $ docker exec egisz-monitor-db psql -U metabase -d metabase_db \
    -c "SELECT count(*) as active_connections FROM pg_stat_activity;"

Monitor slow queries (>5 seconds):
  $ docker logs egisz-monitor-db | grep -i "duration"

Check connection pool usage:
  $ docker exec egisz-monitor-db psql -U metabase -d metabase_db \
    -c "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;"

View Metabase database size:
  $ docker exec egisz-monitor-db psql -U metabase -d metabase_db \
    -c "SELECT pg_size_pretty(pg_database_size('metabase_db'));"

═══════════════════════════════════════════════════════════════════════════════

TROUBLESHOOTING:

Metabase won't start:
  $ docker logs egisz-monitor-metabase | grep -i error
  → Check if PostgreSQL is ready: pg_isready output should say "accepting connections"

Connection pool exhausted:
  → Increase MB_DB_POOL_SIZE in .env (default: 10, try: 15-20)

Slow ETL/Query timeouts:
  → Increase shared_buffers in docker-compose.yml (currently 512MB, try 1GB)
  → Check logs: docker logs egisz-monitor-db | grep "slow"

Database won't initialize:
  → Check init script: docker logs egisz-monitor-db | grep "metabase"
  → Re-initialize: docker volume rm egisz_postgres_data && docker-compose up -d db

═══════════════════════════════════════════════════════════════════════════════

BACKUP & RECOVERY:

Backup Metabase database:
  $ docker exec egisz-monitor-db pg_dump -U metabase metabase_db > metabase_backup.sql

Restore from backup:
  $ docker exec -i egisz-monitor-db psql -U metabase metabase_db < metabase_backup.sql

Backup entire PostgreSQL data volume:
  $ docker run --rm -v egisz_postgres_data:/data -v $(pwd):/backup \
    alpine tar czf /backup/postgres_data_backup.tar.gz -C /data .

═══════════════════════════════════════════════════════════════════════════════

FILES MODIFIED:

✓ docker-compose.yml
  - Enhanced PostgreSQL configuration
  - Metabase PostgreSQL backend setup
  - Extended healthchecks for ETL tolerance

✓ postgres/init/02-metabase.sql (NEW)
  - Metabase database initialization

✓ .env.example
  - Documented Metabase persistence configuration

✓ METABASE_PERSISTENCE_SETUP.md
  - Comprehensive technical documentation

═══════════════════════════════════════════════════════════════════════════════

For detailed configuration and troubleshooting, see:
  → METABASE_PERSISTENCE_SETUP.md

EOF
