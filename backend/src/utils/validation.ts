import { AppConfig, FirebirdConnectionConfig } from "../types";

const DEFAULT_SYNC_WINDOW_DAYS = 30;

function resolveSyncWindowDays(rawValue: string | undefined): number {
  const parsed = Number(rawValue);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed);
  }

  return DEFAULT_SYNC_WINDOW_DAYS;
}

export function buildDefaultFirebirdJoinQuery(): string {
  const syncWindowDays = resolveSyncWindowDays(process.env.FIREBIRD_SYNC_WINDOW_DAYS);

  return `SELECT
    e.LOGID AS LOGID,
    e.LOGDATE AS LOGDATE,
    e.LOGSTATE AS LOGSTATE,
    e.LOGTEXT AS LOGTEXT,
    e.MSGTEXT AS MSGTEXT,
    e.METHOD AS METHOD,
    e.URI AS URI,
    e."ACTION" AS ACTION,
    e.PARENTLOGID AS PARENTLOGID,
    e.GRPID AS GRPID,
    e.MODIFYDATE AS MODIFYDATE,
    e.CREATEDATE AS LOG_CREATED_AT,
    m.REPLYTO AS REPLYTO,
    m.DOCUMENTID AS DOCUMENTID,
    l.MO_UID AS MO_UID,
    l.KIND AS LICENSE_KIND
  FROM EXCHANGELOG e
  LEFT JOIN EGISZ_MESSAGES m
    ON m.MSGID = e.MSGID
  LEFT JOIN EGISZ_LICENSES l
    ON m.REPLYTO = l.MO_DOMEN
  WHERE e.LOGDATE >= DATEADD(-${syncWindowDays} DAY TO CURRENT_TIMESTAMP)
  ORDER BY e.LOGID DESC`;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getNumberEnv(name: string, fallback?: number): number {
  const rawValue = process.env[name];

  if (!rawValue) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new Error(`Missing required numeric environment variable: ${name}`);
  }

  const parsed = Number(rawValue);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }

  return parsed;
}

function getOptionalStringEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function loadConfig(): AppConfig {
  // Firebird config is optional at startup - it will be loaded from DB or use defaults
  const firebirdHost = getOptionalStringEnv("FIREBIRD_HOST") || "host.docker.internal";
  const firebirdPort = getNumberEnv("FIREBIRD_PORT", 3050);
  const firebirdAlias = getOptionalStringEnv("FIREBIRD_ALIAS") || "proxy_egisz";
  const firebirdUser = getOptionalStringEnv("FIREBIRD_USER") || "SYSDBA";
  const firebirdPassword = getOptionalStringEnv("FIREBIRD_PASSWORD") || "masterkey";

  const firebirdConfig: FirebirdConnectionConfig = {
    host: firebirdHost,
    port: firebirdPort,
    alias: firebirdAlias,
    user: firebirdUser,
    password: firebirdPassword,
    pageSize: getNumberEnv("FIREBIRD_PAGE_SIZE", 4096),
    joinQuery: buildDefaultFirebirdJoinQuery()
  };

  return {
    port: getNumberEnv("PORT", 3000),
    etlBatchSize: getNumberEnv("ETL_BATCH_SIZE", 500),
    firebird: firebirdConfig,
    postgres: {
      host: getRequiredEnv("POSTGRES_HOST"),
      port: getNumberEnv("POSTGRES_PORT", 5432),
      database: getRequiredEnv("POSTGRES_DB"),
      user: getRequiredEnv("POSTGRES_USER"),
      password: getRequiredEnv("POSTGRES_PASSWORD"),
      schema: getRequiredEnv("POSTGRES_SCHEMA")
    }
  };
}
