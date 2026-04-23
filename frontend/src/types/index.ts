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
  clinicDisplayName: string;
  mo_uid: string;
  kind: string;
  last_activity: string;
  status: "green" | "yellow" | "red";
}

export interface ClinicErrorRow {
  clinicName: string;
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

export interface DatabaseStatus {
  firebird: "ok" | "error";
  postgres: "ok" | "error";
  details: string[];
}

export interface ClinicDirectoryIssue {
  clinicId: number;
  jid: number;
  moUid: string;
  moDomen: string | null;
  jname: string | null;
  isVerified: boolean;
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

export interface EtlRunStatus {
  status: "idle" | "running" | "success" | "failed";
  stage: "idle" | "extracting" | "parsing" | "loading" | "success" | "failed";
  message: string;
  progressPercent: number;
  processedRows: number;
  totalRows: number;
  startedAt: string | null;
  finishedAt: string | null;
  result: EtlRunResult | null;
  error: string | null;
}
