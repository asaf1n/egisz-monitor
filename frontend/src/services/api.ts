import {
  ApiMutationResult,
  ClinicDirectoryIssue,
  ClinicErrorRow,
  CostlyClinicRow,
  DashboardKPI,
  ErrorPieData,
  EtlRunStatus,
  FirebirdConfigFormData,
  FirebirdConfigView,
  HourlyTrendRow,
  ServiceHealthRow,
  StatusHeatmapRow,
  VpnNodeRow
} from "../types";

function buildQueryUrl(path: string, period?: string): string {
  return period ? `${path}?period=${encodeURIComponent(period)}` : path;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const data = (await response.json().catch(() => null)) as T | { message?: string } | null;

  if (!response.ok) {
    throw new Error(
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : `Request failed with status ${response.status}`
    );
  }

  return data as T;
}

async function postJson<TResponse, TPayload>(url: string, payload: TPayload): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = (await response.json().catch(() => null)) as TResponse | { message?: string } | null;

  if (!response.ok) {
    throw new Error(
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : `Request failed with status ${response.status}`
    );
  }

  return data as TResponse;
}

export async function fetchDashboardKpi(period = '24h'): Promise<DashboardKPI> {
  const payload = await getJson<{
    totalSubmissions: number;
    successRate: number;
    uniqueErrors: number;
  }>(buildQueryUrl('/api/reports/kpi', period));

  return {
    total: payload.totalSubmissions,
    successRate: payload.successRate,
    uniqueErrors: payload.uniqueErrors
  };
}

export async function fetchErrorsPie(period = "24h"): Promise<ErrorPieData[]> {
  return getJson<ErrorPieData[]>(buildQueryUrl("/api/reports/errors-pie", period));
}

export async function fetchStatusHeatmap(period = "24h"): Promise<StatusHeatmapRow[]> {
  const payload = await getJson<
    Array<{
      clinicDisplayName: string;
      moUid: string;
      semdType: string;
      lastActivityAt: string;
      status: "green" | "yellow" | "red";
    }>
  >(buildQueryUrl("/api/reports/status-heatmap", period));

  return payload.map((row) => ({
    clinicDisplayName: row.clinicDisplayName,
    mo_uid: row.moUid,
    kind: row.semdType,
    last_activity: row.lastActivityAt,
    status: row.status
  }));
}

export async function fetchHourlyTrend(period = "24h"): Promise<HourlyTrendRow[]> {
  return getJson<HourlyTrendRow[]>(buildQueryUrl("/api/reports/hourly-trend", period));
}

export async function fetchClinicErrors(period = "24h"): Promise<ClinicErrorRow[]> {
  return getJson<ClinicErrorRow[]>(buildQueryUrl("/api/reports/clinic-errors", period));
}

export async function fetchServiceHealth(period = "24h"): Promise<ServiceHealthRow[]> {
  return getJson<ServiceHealthRow[]>(buildQueryUrl("/api/reports/service-health", period));
}

export async function fetchCostlyClinics(period = "24h"): Promise<CostlyClinicRow[]> {
  return getJson<CostlyClinicRow[]>(buildQueryUrl("/api/reports/costly-clinics", period));
}

export async function fetchVpnNodeStatus(period = "24h"): Promise<VpnNodeRow[]> {
  return getJson<VpnNodeRow[]>(buildQueryUrl("/api/reports/vpn-node-status", period));
}

export async function runEtlSync(): Promise<EtlRunStatus> {
  return postJson<EtlRunStatus, Record<string, never>>("/api/reports/run-etl", {});
}

export async function fetchEtlStatus(): Promise<EtlRunStatus> {
  return getJson<EtlRunStatus>("/api/reports/etl-status");
}

export async function fetchFirebirdConnection(): Promise<FirebirdConfigView> {
  return getJson<FirebirdConfigView>("/api/config/firebird");
}

export async function fetchClinicDirectoryIssues(): Promise<ClinicDirectoryIssue[]> {
  return getJson<ClinicDirectoryIssue[]>("/api/config/clinic-directory-issues");
}

export async function testFirebirdConnection(payload: FirebirdConfigFormData): Promise<ApiMutationResult> {
  return postJson<ApiMutationResult, FirebirdConfigFormData>("/api/config/test-firebird", payload);
}

export async function saveFirebirdConnection(payload: FirebirdConfigFormData): Promise<ApiMutationResult> {
  return postJson<ApiMutationResult, FirebirdConfigFormData>("/api/config/save-firebird", payload);
}
