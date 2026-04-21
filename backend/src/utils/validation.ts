import { AppConfig, FirebirdConnectionConfig } from "../types";

export function buildDefaultFirebirdJoinQuery(): string {
  return `SELECT
    CAST(NULL AS BIGINT) AS LICENSE_ID,
    CAST(NULL AS VARCHAR(255)) AS LICENSE_NUMBER,
    CAST(NULL AS TIMESTAMP) AS LICENSE_CREATED_AT,
    e.LOGID AS EXCHANGELOG_ID,
    e.LOGID AS LOGID,
    e.LOGSTATE,
    e.LOGTYPE,
    e.LOGMODE,
    e.LOGTEXT,
    e.MSGTEXT,
    e.LOGDATE,
    e.CREATEDATE AS LOG_CREATED_AT,
    e.MODIFYDATE AS MODIFYDATE,
    e.URI,
    e.ACTION,
    e.METHOD,
    e.GRPID,
    CAST(NULL AS BIGINT) AS JID,
    CAST(NULL AS VARCHAR(255)) AS MO_UID,
    CAST(NULL AS VARCHAR(255)) AS MO_DOMEN,
    CAST(NULL AS BIGINT) AS KIND,
    CAST(NULL AS BIGINT) AS SERVICE_TYPE
  FROM EXCHANGELOG e
  ORDER BY e.LOGID`;
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
