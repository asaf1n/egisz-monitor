export interface AppConfig {
  port: number;
  etlBatchSize: number;
  firebird: FirebirdConnectionConfig;
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    schema: string;
  };
}

export interface FirebirdConnectionConfig {
  host: string;
  port: number;
  alias: string;
  user: string;
  password: string;
  pageSize: number;
  joinQuery: string;
}

export interface FirebirdConfigPayload {
  host: string;
  port: number;
  alias: string;
  user: string;
  pass: string;
}

export interface FirebirdConfigResponse {
  host: string;
  port: number;
  alias: string;
  user: string;
  pass: string;
  isDefault: boolean;
}

export interface FirebirdLicenseLogRow {
  LICENSE_ID: number | string | null;
  LICENSE_NUMBER: string | null;
  LICENSE_CREATED_AT: Date | string | null;
  EXCHANGELOG_ID: number | string | null;
  LOGID?: number | string | null;
  LOGSTATE: number | string | null;
  LOGTYPE?: number | string | null;
  LOGMODE?: number | string | null;
  LOGTEXT: string | null;
  MSGTEXT: string | null;
  LOG_CREATED_AT: Date | string | null;
  LOGDATE?: Date | string | null;
  MODIFYDATE?: Date | string | null;
  URI?: string | null;
  ACTION?: string | null;
  METHOD?: string | null;
  GRPID?: number | string | null;
  JID?: number | string | null;
  JNAME?: string | null;
  MO_UID?: string | null;
  MO_DOMEN?: string | null;
  REPLYTO?: string | null;
  KIND?: number | string | null;
  SERVICE_TYPE?: number | string | null;
  [key: string]: unknown;
}

export interface ClinicDimensionRecord {
  jid: number;
  moUid: string;
  moDomen: string | null;
  jname: string | null;
  isVerified: boolean;
}

export interface ServiceDimensionRecord {
  kind: string;
  serviceType: string;
  description: string | null;
}

export interface FactTransactionRecord {
  originalLogId: number;
  transactionDate: Date;
  status: "success" | "error";
  errorCategory: string | null;
  errorText: string | null;
}

export interface EgiszErrorRecord {
  originalLogId: number;
  transactionDate: Date;
  errorCategory: string;
  errorText: string;
  hostname: string | null;
}

export interface StarSchemaLogRecord {
  clinic: ClinicDimensionRecord;
  service: ServiceDimensionRecord;
  fact: FactTransactionRecord;
  error: EgiszErrorRecord | null;
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
  startedAt: string | null;
  finishedAt: string | null;
  result: EtlRunResult | null;
  error: string | null;
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

export interface PostgresConnectionIssue {
  code: "authentication_failed" | "database_unavailable" | "schema_migration_failed" | "unknown";
  message: string;
  userHint: string | null;
}
