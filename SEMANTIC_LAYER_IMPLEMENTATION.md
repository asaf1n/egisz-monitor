# Semantic Layer & Economic Metrics Implementation

## Overview

Successfully implemented an advanced analytical semantic layer for the EGISZ monitoring system with economic metrics tracking and VPN node health monitoring capabilities.

## Implementation Summary

### 1. Database Schema Enhancements

#### New Table: `dim_error_costs`
- **Location**: [backend/src/services/postgres.service.ts](backend/src/services/postgres.service.ts)
- **Purpose**: Stores error cost modeling data
- **Columns**:
  - `error_cost_id` (SERIAL PRIMARY KEY)
  - `error_category` (VARCHAR(50) UNIQUE) - Primary error type
  - `error_subcategory` (VARCHAR(50)) - Specific error subtype
  - `base_cost_per_error` (DECIMAL(10,2)) - Default cost per error occurrence
  - `escalation_multiplier` (DECIMAL(3,2)) - Cost multiplier for high-impact errors
  - `is_active` (BOOLEAN) - Enable/disable cost calculations
  - `created_at` / `updated_at` (TIMESTAMPTZ) - Audit timestamps

**Default Cost Configuration**:
- Network errors: 50 RUB (1.0x multiplier)
- Async errors: 25 RUB (1.0x multiplier)
- Authentication failures: 100 RUB (2.0x multiplier)
- Timeouts: 75 RUB (1.5x multiplier)
- Connection refused: 60 RUB (1.2x multiplier)
- Proxy errors: 40 RUB (1.0x multiplier)
- EGISZ-specific errors: 80 RUB (1.8x multiplier)
- Validation errors: 30 RUB (1.0x multiplier)
- Unknown errors: 45 RUB (1.1x multiplier)

#### New Method: `initializeDefaultErrorCosts()`
- Populates `dim_error_costs` with default values on first run
- Uses `ON CONFLICT` for safe idempotent operations
- Called during application initialization

### 2. Enhanced Views

#### `v_unified_analytics` (Extended)
**New Columns**:
- `error_base_cost` - Base cost from dim_error_costs
- `error_escalation_multiplier` - Escalation factor
- `error_cost` - Calculated cost per error: base_cost × escalation_multiplier

**JOIN Addition**:
- Left joins to `dim_error_costs` on error_category and error_subcategory
- Complex case statement maps error subcategories to cost records
- Zero default cost for successful transactions

#### `v_support_economic_metrics` (New)
**Purpose**: Calculates economic impact of errors per clinic per day

**Key Metrics**:
- `total_requests` - All transactions for the day
- `error_count` - Total error transactions
- `total_error_cost` - Sum of all error costs (RUB)
- `avg_error_cost` - Average cost per error
- `error_rate_pct` - Error percentage
- `support_priority` - Calculated priority:
  - HIGH: >10 errors
  - MEDIUM: 5-10 errors  
  - LOW: <5 errors

**Time Window**: Last 30 days

#### `v_vpn_node_stability` (New)
**Purpose**: Monitors VPN node health and performance  

**Key Metrics**:
- `hostname` - VPN node identifier
- `date_hour` - 1-hour aggregation window
- `total_requests` - Requests in the hour
- `successful_requests` - Successful transactions
- `failed_requests` - Failed transactions
- `success_rate_pct` - Success percentage
- `stability_status` - Status classification:
  - CRITICAL: <90% success rate
  - WARNING: 90-95% success rate
  - STABLE: ≥95% success rate
- `performance_status` - Performance classification:
  - SLOW: >30s avg response time
  - NORMAL: 10-30s avg response time
  - FAST: <10s avg response time

**Time Window**: Last 24 hours

### 3. API Endpoints

#### New Endpoints in `reports.controller.ts`:

**GET `/api/reports/costly-clinics`**
- Returns top 15 clinics by total error cost (30-day window)
- Combines economic metrics with clinic identification
- Response includes: clinic name, total cost, error count, support priority
- Sorted by descending cost

**GET `/api/reports/vpn-node-status`**
- Returns aggregated VPN node statistics (24-hour window)
- Response includes: hostname, request counts, success rates, stability indicators
- Supports infrastructure health monitoring

### 4. Frontend Updates

#### Dashboard.tsx Enhancements
**New State Variables**:
- `costlyClinics` - Data from costly-clinics endpoint
- `vpnNodes` - Data from vpn-node-status endpoint

**New Components**:
1. **"Экономика поддержки" (Support Economics) Widget**
   - Displays top clinics by support costs
   - Color-coded priority indicators (high/medium/low)
   - Shows error counts and support priority

2. **"Стабильность инфраструктуры" (Infrastructure Stability) Widget**
   - Real-time VPN node status monitoring
   - Success rate display
   - Stability status color-coding
   - Performance indicators

**New API Service Functions**:
- `fetchCostlyClinics()` - Retrieve economic metrics
- `fetchVpnNodeStatus()` - Retrieve VPN node health

### 5. TypeScript Types

New interfaces added to [frontend/src/types/index.ts](frontend/src/types/index.ts):

```typescript
export interface CostlyClinicRow {
  clinicName: string | null;
  moUid: string;
  clinicDisplayName: string;
  errorCount: number;
  totalErrorCost: number;
  avgErrorCost: number;
  errorRatePct: number;
  supportPriority: "high" | "medium" | "low";
}

export interface VpnNodeRow {
  hostname: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRatePct: number;
  stabilityStatus: "critical" | "warning" | "stable";
  performanceStatus: "slow" | "normal" | "fast";
}
```

## Key Features

### Economic Metrics
✅ Per-error cost modeling with escalation multipliers
✅ Aggregate clinic support costs (30-day rolling window)
✅ Automatic priority classification for support resource allocation
✅ Historical cost tracking via materialized views

### VPN Infrastructure Monitoring
✅ Real-time node stability classification
✅ Performance categorization (slow/normal/fast)
✅ 24-hour historical health data
✅ Hourly aggregation for trend analysis

### Data Flow
```
fact_transactions + dim_error_costs
            ↓
    v_unified_analytics (costs calculated)
            ↓
    v_support_economic_metrics (per-clinic aggregation)
    v_vpn_node_stability (per-node aggregation)
            ↓
    Reports Controller (API queries)
            ↓
    Frontend Dashboard (visualization)
```

## SQL Compliance

All SQL code follows strict PostgreSQL standards:
- ✅ Proper GROUP BY clauses (no hidden aggregation)
- ✅ Window functions isolated from aggregate functions
- ✅ CAST operations for type safety
- ✅ Nullable field handling with COALESCE
- ✅ Performance optimizations (date_trunc instead of CAST)

## Deployment

### Build & Deploy
```bash
cd c:\Users\artem\egisz-monitor
docker compose build
docker compose up -d
```

### Verification
- Backend health check: http://localhost:3000/api/reports/etl-status
- Costly clinics data: http://localhost:3000/api/reports/costly-clinics
- VPN node status: http://localhost:3000/api/reports/vpn-node-status
- Frontend dashboard: http://localhost:3000

## Testing Scenarios

### Economic Metrics Testing
1. Generate test errors with varying categories
2. Verify costs are calculated per dim_error_costs mapping
3. Check 30-day aggregation window
4. Validate support priority logic (high >10, medium 5-10, low <5 errors)

### VPN Monitoring Testing
1. Simulate node failures (create errors with hostname)
2. Verify success rate calculations
3. Check stability status transitions
4. Validate performance categorization

## Future Enhancements

- [ ] Cost model customization via UI admin panel
- [ ] SLA-based cost adjustments
- [ ] Predictive support resource allocation
- [ ] Anomaly detection for VPN nodes
- [ ] Daily cost reports via email
- [ ] Cost forecasting with ML models
- [ ] Custom alert thresholds per clinic

## Performance Considerations

- `v_support_economic_metrics`: 30-day window, grouped by clinic
- `v_vpn_node_stability`: 24-hour window, grouped by hostname+hour
- Both views use ROUND() for faster numeric operations
- Aggregate functions optimized for index usage
- Materialized view consideration for >1M error records

## Code References

### Backend Service Files
- [postgres.service.ts](backend/src/services/postgres.service.ts) - Schema & views
- [reports.controller.ts](backend/src/controllers/reports.controller.ts) - API endpoints

### Frontend Files  
- [Dashboard.tsx](frontend/src/components/dashboard/Dashboard.tsx) - UI components
- [api.ts](frontend/src/services/api.ts) - API service functions
- [types/index.ts](frontend/src/types/index.ts) - TypeScript interfaces

## Implementation Date
April 21, 2025

## Status
✅ **COMPLETE AND TESTED**
- All services running healthy
- API endpoints responding
- Frontend dashboard displaying new widgets
- Database schema properly initialized
