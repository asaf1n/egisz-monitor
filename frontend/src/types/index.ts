export interface DashboardKPI {
  total: number;
  successRate: number;
  uniqueErrors: number;
}

export interface ErrorPieData {
  category: string;
  count: number;
}

export interface HourlyTrendRow {
  hourBucket: string;
  successCount: number;
  errorCount: number;
}

export interface StatusHeatmapRow {
  mo_uid: string;
  kind: string;
  last_activity: string;
  status: "green" | "yellow" | "red";
}

export interface ClinicErrorRow {
  moUid: string;
  totalCount: number;
  errorCount: number;
  successRate: number;
  lastErrorAt: string | null;
}

export interface ServiceHealthRow {
  semdType: string;
  totalCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  lastExchangeAt: string | null;
}

export interface FirebirdConfigFormData {
  host: string;
  port: number;
  alias: string;
  user: string;
  pass: string;
}

export interface FirebirdConfigView extends FirebirdConfigFormData {
  isDefault: boolean;
}

export interface ApiMutationResult {
  ok: boolean;
  message: string;
}

export interface EtlRunResult {
  extracted: number;
  transformed: number;
  inserted: number;
  skipped: number;
}
