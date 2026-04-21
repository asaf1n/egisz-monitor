import { Request, Response, Router } from "express";

import { EtlService } from "../services/etl.service";
import { PostgresService } from "../services/postgres.service";

interface KpiRow {
  total_submissions: string;
  success_rate: string;
  unique_errors: string;
}

interface ErrorPieRow {
  category: string;
  count: string;
}

interface StatusHeatmapRow {
  mo_uid: string;
  semd_type: string;
  last_activity_at: Date | string | null;
  status: "green" | "yellow" | "red";
}

interface TrendRow {
  hour_bucket: Date | string;
  success_count: string;
  error_count: string;
}

interface ClinicErrorRow {
  mo_uid: string;
  total_count: string;
  error_count: string;
  success_rate: string;
  last_error_at: Date | string | null;
}

interface ServiceHealthRow {
  semd_type: string;
  total_count: string;
  success_count: string;
  error_count: string;
  success_rate: string;
  last_exchange_at: Date | string | null;
}

export class ReportsController {
  constructor(
    private readonly etlService: EtlService,
    private readonly postgresService: PostgresService
  ) {}

  runEtl = async (_request: Request, response: Response): Promise<void> => {
    try {
      const result = await this.etlService.run();
      response.status(200).json(result);
    } catch (error) {
      const details = error instanceof Error ? error.message : "Unknown ETL error";

      if (details.includes("ETL is already running")) {
        response.status(409).json({
          message: "ETL execution is already in progress",
          details
        });
        return;
      }

      response.status(500).json({
        message: "ETL execution failed",
        details
      });
    }
  };

  getKpi = async (_request: Request, response: Response): Promise<void> => {
    try {
      const result = await this.postgresService.query<KpiRow>(this.buildKpiQuery());
      const row = result.rows[0];

      response.status(200).json({
        totalSubmissions: Number(row?.total_submissions ?? 0),
        successRate: Number(row?.success_rate ?? 0),
        uniqueErrors: Number(row?.unique_errors ?? 0)
      });
    } catch (error) {
      response.status(500).json({
        message: "Failed to load KPI report",
        details: error instanceof Error ? error.message : "Unknown reporting error"
      });
    }
  };

  getErrorsPie = async (_request: Request, response: Response): Promise<void> => {
    try {
      const result = await this.postgresService.query<ErrorPieRow>(this.buildErrorsPieQuery());

      response.status(200).json(
        result.rows.map((row) => ({
          category: row.category,
          count: Number(row.count)
        }))
      );
    } catch (error) {
      response.status(500).json({
        message: "Failed to load errors pie report",
        details: error instanceof Error ? error.message : "Unknown reporting error"
      });
    }
  };

  getStatusHeatmap = async (_request: Request, response: Response): Promise<void> => {
    try {
      const result = await this.postgresService.query<StatusHeatmapRow>(this.buildStatusHeatmapQuery());

      response.status(200).json(
        result.rows.map((row) => ({
          moUid: row.mo_uid,
          semdType: row.semd_type,
          lastActivityAt: row.last_activity_at,
          status: row.status
        }))
      );
    } catch (error) {
      response.status(500).json({
        message: "Failed to load status heatmap report",
        details: error instanceof Error ? error.message : "Unknown reporting error"
      });
    }
  };

  getHourlyTrend = async (_request: Request, response: Response): Promise<void> => {
    try {
      const result = await this.postgresService.query<TrendRow>(this.buildHourlyTrendQuery());

      response.status(200).json(
        result.rows.map((row) => ({
          hourBucket: row.hour_bucket,
          successCount: Number(row.success_count),
          errorCount: Number(row.error_count)
        }))
      );
    } catch (error) {
      response.status(500).json({
        message: "Failed to load hourly trend report",
        details: error instanceof Error ? error.message : "Unknown reporting error"
      });
    }
  };

  getClinicErrors = async (_request: Request, response: Response): Promise<void> => {
    try {
      const result = await this.postgresService.query<ClinicErrorRow>(this.buildClinicErrorsQuery());

      response.status(200).json(
        result.rows.map((row) => ({
          moUid: row.mo_uid,
          totalCount: Number(row.total_count),
          errorCount: Number(row.error_count),
          successRate: Number(row.success_rate),
          lastErrorAt: row.last_error_at
        }))
      );
    } catch (error) {
      response.status(500).json({
        message: "Failed to load clinic error report",
        details: error instanceof Error ? error.message : "Unknown reporting error"
      });
    }
  };

  getServiceHealth = async (_request: Request, response: Response): Promise<void> => {
    try {
      const result = await this.postgresService.query<ServiceHealthRow>(this.buildServiceHealthQuery());

      response.status(200).json(
        result.rows.map((row) => ({
          semdType: row.semd_type,
          totalCount: Number(row.total_count),
          successCount: Number(row.success_count),
          errorCount: Number(row.error_count),
          successRate: Number(row.success_rate),
          lastExchangeAt: row.last_exchange_at
        }))
      );
    } catch (error) {
      response.status(500).json({
        message: "Failed to load service health report",
        details: error instanceof Error ? error.message : "Unknown reporting error"
      });
    }
  };

  private buildKpiQuery(): string {
    const factTransactions = this.postgresService.getQualifiedTableName("fact_transactions");

    return `
      SELECT
        COUNT(*)::BIGINT AS total_submissions,
        COALESCE(
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE ft.status = 'success') / NULLIF(COUNT(*), 0),
            2
          ),
          0
        ) AS success_rate,
        COUNT(DISTINCT NULLIF(TRIM(ft.error_text), ''))::BIGINT AS unique_errors
      FROM ${factTransactions} ft
      WHERE ft.transaction_date >= NOW() - INTERVAL '24 hours'
    `;
  }

  private buildErrorsPieQuery(): string {
    const factTransactions = this.postgresService.getQualifiedTableName("fact_transactions");

    return `
      SELECT
        COALESCE(NULLIF(TRIM(ft.error_category), ''), 'Неизвестная') AS category,
        COUNT(*)::BIGINT AS count
      FROM ${factTransactions} ft
      WHERE ft.status = 'error'
        AND ft.transaction_date >= NOW() - INTERVAL '24 hours'
      GROUP BY COALESCE(NULLIF(TRIM(ft.error_category), ''), 'Неизвестная')
      ORDER BY count DESC, category ASC
    `;
  }

  private buildStatusHeatmapQuery(): string {
    const factTransactions = this.postgresService.getQualifiedTableName("fact_transactions");
    const clinics = this.postgresService.getQualifiedTableName("dim_clinics");
    const services = this.postgresService.getQualifiedTableName("dim_services");

    return `
      WITH latest_activity AS (
        SELECT
          dc.mo_uid,
          COALESCE(ds.description, ds.service_type::TEXT, ds.kind::TEXT) AS semd_type,
          MAX(ft.transaction_date) AS last_activity_at
        FROM ${factTransactions} ft
        INNER JOIN ${clinics} dc ON dc.clinic_id = ft.clinic_id
        INNER JOIN ${services} ds ON ds.service_id = ft.service_id
        GROUP BY
          dc.mo_uid,
          COALESCE(ds.description, ds.service_type::TEXT, ds.kind::TEXT)
      )
      SELECT
        la.mo_uid,
        la.semd_type,
        la.last_activity_at,
        CASE
          WHEN la.last_activity_at IS NULL THEN 'red'
          WHEN la.last_activity_at >= NOW() - INTERVAL '1 hour' THEN 'green'
          WHEN la.last_activity_at >= NOW() - INTERVAL '24 hours' THEN 'yellow'
          ELSE 'red'
        END AS status
      FROM latest_activity la
      ORDER BY la.mo_uid ASC, la.semd_type ASC
    `;
  }

  private buildHourlyTrendQuery(): string {
    const factTransactions = this.postgresService.getQualifiedTableName("fact_transactions");

    return `
      WITH series AS (
        SELECT generate_series(
          date_trunc('hour', NOW() - INTERVAL '23 hours'),
          date_trunc('hour', NOW()),
          INTERVAL '1 hour'
        ) AS hour_bucket
      ),
      aggregated AS (
        SELECT
          date_trunc('hour', ft.transaction_date) AS hour_bucket,
          COUNT(*) FILTER (WHERE ft.status = 'success')::BIGINT AS success_count,
          COUNT(*) FILTER (WHERE ft.status = 'error')::BIGINT AS error_count
        FROM ${factTransactions} ft
        WHERE ft.transaction_date >= NOW() - INTERVAL '24 hours'
        GROUP BY date_trunc('hour', ft.transaction_date)
      )
      SELECT
        s.hour_bucket,
        COALESCE(a.success_count, 0)::BIGINT AS success_count,
        COALESCE(a.error_count, 0)::BIGINT AS error_count
      FROM series s
      LEFT JOIN aggregated a ON a.hour_bucket = s.hour_bucket
      ORDER BY s.hour_bucket ASC
    `;
  }

  private buildClinicErrorsQuery(): string {
    const factTransactions = this.postgresService.getQualifiedTableName("fact_transactions");
    const clinics = this.postgresService.getQualifiedTableName("dim_clinics");

    return `
      SELECT
        dc.mo_uid,
        COUNT(*)::BIGINT AS total_count,
        COUNT(*) FILTER (WHERE ft.status = 'error')::BIGINT AS error_count,
        COALESCE(
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE ft.status = 'success') / NULLIF(COUNT(*), 0),
            2
          ),
          0
        ) AS success_rate,
        MAX(ft.transaction_date) FILTER (WHERE ft.status = 'error') AS last_error_at
      FROM ${factTransactions} ft
      INNER JOIN ${clinics} dc ON dc.clinic_id = ft.clinic_id
      WHERE ft.transaction_date >= NOW() - INTERVAL '7 days'
      GROUP BY dc.mo_uid
      HAVING COUNT(*) FILTER (WHERE ft.status = 'error') > 0
      ORDER BY error_count DESC, last_error_at DESC NULLS LAST, dc.mo_uid ASC
      LIMIT 10
    `;
  }

  private buildServiceHealthQuery(): string {
    const factTransactions = this.postgresService.getQualifiedTableName("fact_transactions");
    const services = this.postgresService.getQualifiedTableName("dim_services");

    return `
      SELECT
        COALESCE(ds.description, ds.service_type::TEXT, ds.kind::TEXT) AS semd_type,
        COUNT(*)::BIGINT AS total_count,
        COUNT(*) FILTER (WHERE ft.status = 'success')::BIGINT AS success_count,
        COUNT(*) FILTER (WHERE ft.status = 'error')::BIGINT AS error_count,
        COALESCE(
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE ft.status = 'success') / NULLIF(COUNT(*), 0),
            2
          ),
          0
        ) AS success_rate,
        MAX(ft.transaction_date) AS last_exchange_at
      FROM ${factTransactions} ft
      INNER JOIN ${services} ds ON ds.service_id = ft.service_id
      WHERE ft.transaction_date >= NOW() - INTERVAL '7 days'
      GROUP BY COALESCE(ds.description, ds.service_type::TEXT, ds.kind::TEXT)
      ORDER BY error_count DESC, success_rate ASC, semd_type ASC
    `;
  }
}

export function createReportsRouter(controller: ReportsController): Router {
  const router = Router();

  router.get("/kpi", controller.getKpi);
  router.get("/errors-pie", controller.getErrorsPie);
  router.get("/status-heatmap", controller.getStatusHeatmap);
  router.get("/hourly-trend", controller.getHourlyTrend);
  router.get("/clinic-errors", controller.getClinicErrors);
  router.get("/service-health", controller.getServiceHealth);
  router.post("/run-etl", controller.runEtl);

  return router;
}
