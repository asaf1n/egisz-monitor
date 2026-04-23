## Metabase Persistence & ETL Optimization Configuration

### Overview
This configuration migrates Metabase from the internal H2 database to PostgreSQL persistence and optimizes the environment for long-running ETL operations.

---

## Key Changes

### 1. PostgreSQL Database Service Enhancements

**File:** `docker-compose.yml` → `db` service

#### Resource Optimization
- Increased `shared_buffers` from 256MB to 512MB for better caching
- Increased `max_connections` from 200 to 300 to support concurrent ETL and Metabase operations
- Added `POSTGRES_INITDB_ARGS` for initialization-time connection limits

#### ETL-Friendly Configuration
- `idle_in_transaction_session_timeout: 0` — Prevents timeout of long-running ETL transactions
- `statement_timeout: 0` — Allows queries to run without time limits
- `log_statement: mod` — Logs modified statements for monitoring
- `log_min_duration_statement: 5000` — Logs slow queries (>5 seconds) for analysis

#### Enhanced Healthcheck
- **Extended timeouts:** interval 15s, timeout 10s, retries 8, start_period 20s (was 10s/5s/5s/10s)
- **Dual-check:** Verifies both EGISZ database AND Metabase database readiness
- Prevents premature service startup before both databases initialize

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-egisz} -d ${DB_NAME:-egisz_monitor} && pg_isready -U ${MB_DB_USER:-metabase} -d ${MB_DB_NAME:-metabase_db}"]
  interval: 15s
  timeout: 10s
  retries: 8
  start_period: 20s
```

---

### 2. Metabase PostgreSQL Backend Configuration

**File:** `docker-compose.yml` → `metabase` service

#### Database Persistence
- `MB_DB_TYPE: postgres` — Switched from embedded H2 to PostgreSQL
- `MB_DB_HOST: db` — Points to PostgreSQL service
- `MB_DB_DBNAME: metabase_db` — Dedicated database for Metabase metadata
- `MB_DB_USER: metabase` — Isolated database user
- `MB_DB_PASS: ${MB_DB_PASS:-metabase}` — Environment-variable controlled password

#### Connection Pooling for ETL Workloads
```yaml
MB_DB_POOL_SIZE: 10                    # Max connections in pool
MB_DB_INIT_POOL_SIZE: 5                # Initial connections
MB_DB_MIN_IDLE_CONNECTIONS: 5          # Minimum idle connections
MB_DB_CONNECTION_TIMEOUT_MS: 60000     # 60-second connection timeout
```
These parameters ensure stable concurrent connections during heavy ETL activity.

#### Query Performance Tuning
```yaml
MB_QUERY_TIMEOUT_SECONDS: 3600         # 1-hour query timeout (0 = unlimited)
MB_QUERY_CACHE_TTL_RATIO: 10           # Cache multiplier for better caching
```

#### Healthcheck Optimization for ETL
- Extended from `start_period: 120s` to `180s` (3 minutes) to allow Metabase to initialize with PostgreSQL backend
- `interval: 45s`, `timeout: 15s`, `retries: 5` for more tolerant health checks during long-running operations

---

### 3. Metabase Database Initialization Script

**File:** `postgres/init/02-metabase.sql` (NEW)

This SQL script runs during PostgreSQL initialization:

```sql
-- Creates metabase user (idempotent)
-- Creates metabase_db database
-- Grants necessary permissions
-- Disables timeout settings for ETL-friendly operation:
  ALTER DATABASE metabase_db SET idle_in_transaction_session_timeout = 0;
  ALTER DATABASE metabase_db SET statement_timeout = 0;
```

This ensures that:
- Metabase has a dedicated, isolated database
- User permissions are set up automatically
- No timeouts interrupt long-running operations

---

### 4. Environment Configuration

**File:** `.env.example` (UPDATED)

Added explicit documentation:
```env
# Metabase PostgreSQL Backend Configuration
MB_DB_NAME=metabase_db
MB_DB_USER=metabase
MB_DB_PASS=metabase

# Optional: Metabase Connection Pooling (for ETL optimization)
# MB_DB_POOL_SIZE=10
# MB_DB_INIT_POOL_SIZE=5
# MB_DB_CONNECTION_TIMEOUT_MS=60000

# Optional: Metabase Query Timeout (seconds, 0 = unlimited)
# MB_QUERY_TIMEOUT_SECONDS=3600
```

---

## Service Dependencies & Startup Order

```
PostgreSQL (db)
├── Waits for: health check pass (both egisz_monitor & metabase_db ready)
│
├─→ Backend (backend)
│   └── Waits for: db.service_healthy
│       └─→ Frontend (frontend)
│           └── Waits for: backend.service_healthy
│
└─→ Metabase (metabase)
    └── Waits for: db.service_healthy
        └─→ Metabase Public (metabase-public)
            └── Waits for: metabase.service_healthy
```

---

## Why These Changes?

### Problem: H2 Database Limitations
- Internal H2 database not suitable for production
- Data loss on container restart
- No persistence across deployments
- Poor concurrency under ETL load

### Solution: PostgreSQL Backend
- Persistent metadata storage
- ACID compliance for reliability
- Connection pooling for concurrent operations
- Shared database infrastructure (no additional database service)

### ETL Optimization
- **Disabled timeouts:** `idle_in_transaction_session_timeout=0` prevents interruption of long-running ETL jobs
- **Extended healthchecks:** Ensures services don't start until database is truly ready
- **Connection pooling:** Manages concurrent connections efficiently during syncs
- **Query timeout:** 3600 seconds (1 hour) allows long-running analytical queries

---

## Testing the Setup

### 1. Bring up the stack
```bash
docker-compose up -d
```

### 2. Verify PostgreSQL is ready
```bash
docker exec egisz-monitor-db pg_isready -U metabase -d metabase_db
# Expected: "accepting connections"
```

### 3. Check Metabase initialization
```bash
docker logs egisz-monitor-metabase | grep -i "init\|database\|postgres"
```

### 4. Verify Metabase database exists
```bash
docker exec egisz-monitor-db psql -U metabase -d metabase_db -c "\dt"
# Should list Metabase tables (report_card, dashboard, etc.)
```

### 5. Access Metabase
```
http://localhost:3001
```

---

## Migration Notes

### Existing Data
If you have an existing Metabase setup:
1. Back up your H2 database (if applicable)
2. Stop Metabase: `docker-compose stop metabase`
3. Pull fresh configuration: `docker-compose pull`
4. Start: `docker-compose up -d`
5. Re-add data sources if needed (only metadata is persisted)

### Backup Strategy
For production, add regular PostgreSQL backups:
```bash
docker exec egisz-monitor-db pg_dump -U metabase metabase_db > backup.sql
```

---

## Configuration Reference

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `MB_DB_TYPE` | postgres | Use PostgreSQL backend |
| `MB_DB_POOL_SIZE` | 10 | Max concurrent connections |
| `MB_DB_CONNECTION_TIMEOUT_MS` | 60000 | Connection timeout (60s) |
| `MB_QUERY_TIMEOUT_SECONDS` | 3600 | Query timeout (1 hour) |
| `idle_in_transaction_session_timeout` | 0 | No timeout for long ETL |
| `statement_timeout` | 0 | No timeout for queries |
| `shared_buffers` | 512MB | Memory for caching (2x increase) |
| `max_connections` | 300 | Connection limit (1.5x increase) |

---

## Troubleshooting

### Metabase won't start
```bash
docker logs egisz-monitor-metabase
# Check for: "unable to connect to database"
# Solution: Verify pg_isready returns success for metabase_db
```

### Slow ETL operations
- Increase `shared_buffers` in PostgreSQL
- Increase `MB_DB_POOL_SIZE` for more concurrent Metabase queries
- Check `log_min_duration_statement` logs for slow queries

### Connection pool exhausted
```bash
docker exec egisz-monitor-db psql -U metabase -d metabase_db -c "SELECT count(*) FROM pg_stat_activity;"
# Solution: Increase `MB_DB_POOL_SIZE` or `max_connections`
```

---

## Files Modified

1. **docker-compose.yml**
   - PostgreSQL: Enhanced configuration, extended healthchecks
   - Metabase: PostgreSQL backend, connection pooling, ETL tuning

2. **postgres/init/02-metabase.sql** (NEW)
   - Database initialization for Metabase persistence

3. **.env.example** (UPDATED)
   - Documented Metabase database configuration
   - Added optional connection pooling parameters

---

## Production Recommendations

1. **Backups:** Set up daily PostgreSQL backups for `metabase_db`
2. **Monitoring:** Track `pg_stat_activity` for connection pool usage
3. **Secrets:** Move `MB_DB_PASS` to a secrets manager (not .env)
4. **Replication:** For HA, consider PostgreSQL replication
5. **Resource Limits:** Add memory/CPU limits to docker-compose services if running in containers

---

## Related Documentation

- [Metabase Database Configuration](https://metabase.com/docs/latest/operations-guide/migrating-from-h2)
- [PostgreSQL Performance Tuning](https://www.postgresql.org/docs/15/runtime-config.html)
- [Docker Compose Service Dependencies](https://docs.docker.com/compose/startup-order/)
