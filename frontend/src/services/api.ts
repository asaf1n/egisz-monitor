import {
  ApiMutationResult,
  ClinicErrorRow,
  DashboardKPI,
  ErrorPieData,
  EtlRunResult,
  FirebirdConfigFormData,
  FirebirdConfigView,
  HourlyTrendRow,
  ServiceHealthRow,
  StatusHeatmapRow
} from "../types";

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

export async function fetchDashboardKpi(): Promise<DashboardKPI> {
  const payload = await getJson<{
    totalSubmissions: number;
    successRate: number;
    uniqueErrors: number;
  }>("/api/reports/kpi");

  return {
    total: payload.totalSubmissions,
    successRate: payload.successRate,
    uniqueErrors: payload.uniqueErrors
  };
}

export async function fetchErrorsPie(): Promise<ErrorPieData[]> {
  return getJson<ErrorPieData[]>("/api/reports/errors-pie");
}

export async function fetchStatusHeatmap(): Promise<StatusHeatmapRow[]> {
  const payload = await getJson<
    Array<{
      moUid: string;
      semdType: string;
      lastActivityAt: string;
      status: "green" | "yellow" | "red";
    }>
  >("/api/reports/status-heatmap");

  return payload.map((row) => ({
    mo_uid: row.moUid,
    kind: row.semdType,
    last_activity: row.lastActivityAt,
    status: row.status
  }));
}

export async function fetchHourlyTrend(): Promise<HourlyTrendRow[]> {
  return getJson<HourlyTrendRow[]>("/api/reports/hourly-trend");
}

export async function fetchClinicErrors(): Promise<ClinicErrorRow[]> {
  return getJson<ClinicErrorRow[]>("/api/reports/clinic-errors");
}

export async function fetchServiceHealth(): Promise<ServiceHealthRow[]> {
  return getJson<ServiceHealthRow[]>("/api/reports/service-health");
}

export async function runEtlSync(): Promise<EtlRunResult> {
  return postJson<EtlRunResult, Record<string, never>>("/api/reports/run-etl", {});
}

export async function fetchFirebirdConnection(): Promise<FirebirdConfigView> {
  return getJson<FirebirdConfigView>("/api/config/firebird");
}

export async function testFirebirdConnection(payload: FirebirdConfigFormData): Promise<ApiMutationResult> {
  return postJson<ApiMutationResult, FirebirdConfigFormData>("/api/config/test-firebird", payload);
}

export async function saveFirebirdConnection(payload: FirebirdConfigFormData): Promise<ApiMutationResult> {
  return postJson<ApiMutationResult, FirebirdConfigFormData>("/api/config/save-firebird", payload);
}
