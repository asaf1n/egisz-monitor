import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import { AppConfig, FirebirdConfigResponse, FirebirdConnectionConfig, StarSchemaLogRecord } from "../types";
import { buildDefaultFirebirdJoinQuery } from "../utils/validation";

const FIREBIRD_CONFIG_KEY = "firebird_connection";
const DEFAULT_FIREBIRD_CONNECTION = {
  host: "host.docker.internal",
  port: 3050,
  alias: "proxy_egisz",
  user: "sysdba",
  pass: "masterkey"
} as const;

type StoredFirebirdConfig = {
  host?: unknown;
  port?: unknown;
  alias?: unknown;
  path?: unknown;
  user?: unknown;
  pass?: unknown;
  password?: unknown;
  pageSize?: unknown;
  joinQuery?: unknown;
  isDefault?: unknown;
};

export class PostgresService {
  private readonly pool: Pool;
  private readonly schemaName: string;
  private static readonly ETL_LOCK_NAMESPACE = 48219;
  private static readonly ETL_LOCK_KEY = 1;

  constructor(private readonly config: AppConfig["postgres"]) {
    this.schemaName = this.validateSchemaName(config.schema);
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schemaName}`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schemaName}.app_config (
        config_key TEXT PRIMARY KEY,
        config_value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      ALTER TABLE ${this.schemaName}.app_config
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schemaName}.dim_clinics (
        clinic_id SERIAL PRIMARY KEY,
        jid BIGINT NOT NULL,
        mo_uid VARCHAR(256) NOT NULL UNIQUE,
        mo_domen VARCHAR(256)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schemaName}.dim_services (
        service_id SERIAL PRIMARY KEY,
        kind BIGINT NOT NULL UNIQUE,
        service_type BIGINT NOT NULL,
        description VARCHAR(255)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schemaName}.fact_transactions (
        transaction_id BIGSERIAL PRIMARY KEY,
        clinic_id INT NOT NULL REFERENCES ${this.schemaName}.dim_clinics(clinic_id),
        service_id INT NOT NULL REFERENCES ${this.schemaName}.dim_services(service_id),
        original_log_id BIGINT UNIQUE,
        transaction_date TIMESTAMP NOT NULL,
        status VARCHAR(20) NOT NULL,
        error_category VARCHAR(50),
        error_text TEXT,
        CONSTRAINT chk_fact_transactions_status CHECK (status IN ('success', 'error')),
        CONSTRAINT chk_fact_transactions_error_category CHECK (
          (status = 'error' AND error_category IS NOT NULL) OR
          (status = 'success' AND error_category IS NULL)
        )
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_date
      ON ${this.schemaName}.fact_transactions(transaction_date)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_agg_dashboard
      ON ${this.schemaName}.fact_transactions(clinic_id, service_id, status)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_errors
      ON ${this.schemaName}.fact_transactions(status, error_category)
      WHERE status = 'error'
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_clinic_id
      ON ${this.schemaName}.fact_transactions(clinic_id)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_service_id
      ON ${this.schemaName}.fact_transactions(service_id)
    `);
  }

  async initializeDefaultFirebirdConfig(): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `
        INSERT INTO ${this.schemaName}.app_config (config_key, config_value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (config_key) DO NOTHING
      `,
      [FIREBIRD_CONFIG_KEY, JSON.stringify({ ...DEFAULT_FIREBIRD_CONNECTION, isDefault: true })]
    );
  }

  async saveFirebirdConfig(config: FirebirdConnectionConfig): Promise<void> {
    await this.ensureSchema();
    const storedConfig = {
      host: config.host,
      port: config.port,
      alias: config.alias,
      user: config.user,
      pass: config.password,
      isDefault: false
    };

    await this.pool.query(
      `
        INSERT INTO ${this.schemaName}.app_config (config_key, config_value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (config_key) DO UPDATE
        SET
          config_value = EXCLUDED.config_value,
          updated_at = NOW()
      `,
      [FIREBIRD_CONFIG_KEY, JSON.stringify(storedConfig)]
    );
  }

  async getFirebirdConfig(): Promise<FirebirdConnectionConfig | null> {
    await this.ensureSchema();

    const result = await this.pool.query<{ config_value: StoredFirebirdConfig }>(
      `
        SELECT config_value
        FROM ${this.schemaName}.app_config
        WHERE config_key = $1
      `,
      [FIREBIRD_CONFIG_KEY]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.normalizeStoredFirebirdConnection(result.rows[0].config_value);
  }

  async getFirebirdConfigState(): Promise<FirebirdConfigResponse | null> {
    await this.ensureSchema();

    const result = await this.pool.query<{ config_value: StoredFirebirdConfig }>(
      `
        SELECT config_value
        FROM ${this.schemaName}.app_config
        WHERE config_key = $1
      `,
      [FIREBIRD_CONFIG_KEY]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.normalizeStoredFirebirdConfigView(result.rows[0].config_value);
  }

  async upsertStarSchemaBatch(records: StarSchemaLogRecord[]): Promise<number> {
    if (records.length === 0) {
      return 0;
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      for (const record of records) {
        const clinicId = await this.upsertClinic(client, record);
        const serviceId = await this.upsertService(client, record);
        await this.upsertFactTransaction(client, record, clinicId, serviceId);
      }

      await client.query("COMMIT");
      return records.length;
    } catch (error) {
      await this.rollbackQuietly(client);

      throw new Error(
        `Failed to write ETL batch into PostgreSQL star schema. ${error instanceof Error ? error.message : "Unknown write error"}`
      );
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    try {
      await this.pool.query("SELECT 1");
    } catch (error) {
      throw new Error(
        `PostgreSQL ping failed for ${this.config.host}:${this.config.port}/${this.config.database}. ${
          error instanceof Error ? error.message : "Unknown connection error"
        }`
      );
    }
  }

  async query<TResult extends QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<TResult>> {
    return this.pool.query<TResult>(sql, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getQualifiedTableName(tableName: "app_config" | "dim_clinics" | "dim_services" | "fact_transactions"): string {
    return `${this.schemaName}.${tableName}`;
  }

  async withEtlLock<T>(callback: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      const lockResult = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS locked",
        [PostgresService.ETL_LOCK_NAMESPACE, PostgresService.ETL_LOCK_KEY]
      );

      if (!lockResult.rows[0]?.locked) {
        throw new Error("ETL is already running");
      }

      return await callback();
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [
          PostgresService.ETL_LOCK_NAMESPACE,
          PostgresService.ETL_LOCK_KEY
        ]);
      } catch {
        // Ignore unlock errors on shutdown paths.
      }

      client.release();
    }
  }

  private async upsertClinic(client: PoolClient, record: StarSchemaLogRecord): Promise<number> {
    const result = await client.query<{ clinic_id: number }>(
      `
        INSERT INTO ${this.schemaName}.dim_clinics (jid, mo_uid, mo_domen)
        VALUES ($1, $2, $3)
        ON CONFLICT (mo_uid) DO UPDATE
        SET
          jid = EXCLUDED.jid,
          mo_domen = EXCLUDED.mo_domen
        RETURNING clinic_id
      `,
      [record.clinic.jid, record.clinic.moUid, record.clinic.moDomen]
    );

    return result.rows[0].clinic_id;
  }

  private async upsertService(client: PoolClient, record: StarSchemaLogRecord): Promise<number> {
    const result = await client.query<{ service_id: number }>(
      `
        INSERT INTO ${this.schemaName}.dim_services (kind, service_type, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (kind) DO UPDATE
        SET
          service_type = EXCLUDED.service_type,
          description = EXCLUDED.description
        RETURNING service_id
      `,
      [record.service.kind, record.service.serviceType, record.service.description]
    );

    return result.rows[0].service_id;
  }

  private async upsertFactTransaction(
    client: PoolClient,
    record: StarSchemaLogRecord,
    clinicId: number,
    serviceId: number
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO ${this.schemaName}.fact_transactions (
          clinic_id,
          service_id,
          original_log_id,
          transaction_date,
          status,
          error_category,
          error_text
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (original_log_id) DO UPDATE
        SET
          clinic_id = EXCLUDED.clinic_id,
          service_id = EXCLUDED.service_id,
          transaction_date = EXCLUDED.transaction_date,
          status = EXCLUDED.status,
          error_category = EXCLUDED.error_category,
          error_text = EXCLUDED.error_text
      `,
      [
        clinicId,
        serviceId,
        record.fact.originalLogId,
        record.fact.transactionDate,
        record.fact.status,
        record.fact.errorCategory,
        record.fact.errorText
      ]
    );
  }

  private validateSchemaName(value: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
      throw new Error("POSTGRES_SCHEMA must be a valid SQL identifier");
    }

    return value;
  }

  private async rollbackQuietly(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors so we can surface the original failure.
    }
  }

  private normalizeStoredFirebirdConnection(config: StoredFirebirdConfig): FirebirdConnectionConfig {
    return {
      host: this.readString(config.host, DEFAULT_FIREBIRD_CONNECTION.host),
      port: this.readNumber(config.port, DEFAULT_FIREBIRD_CONNECTION.port),
      alias: this.readString(config.alias ?? config.path, DEFAULT_FIREBIRD_CONNECTION.alias),
      user: this.readString(config.user, DEFAULT_FIREBIRD_CONNECTION.user),
      password: this.readString(config.password ?? config.pass, DEFAULT_FIREBIRD_CONNECTION.pass),
      pageSize: this.readNumber(config.pageSize, Number(process.env.FIREBIRD_PAGE_SIZE ?? "4096")),
      joinQuery: this.readString(config.joinQuery, process.env.FIREBIRD_JOIN_QUERY ?? buildDefaultFirebirdJoinQuery())
    };
  }

  private normalizeStoredFirebirdConfigView(config: StoredFirebirdConfig): FirebirdConfigResponse {
    return {
      host: this.readString(config.host, DEFAULT_FIREBIRD_CONNECTION.host),
      port: this.readNumber(config.port, DEFAULT_FIREBIRD_CONNECTION.port),
      alias: this.readString(config.alias ?? config.path, DEFAULT_FIREBIRD_CONNECTION.alias),
      user: this.readString(config.user, DEFAULT_FIREBIRD_CONNECTION.user),
      pass: this.readString(config.password ?? config.pass, DEFAULT_FIREBIRD_CONNECTION.pass),
      isDefault: this.readBoolean(config.isDefault, false)
    };
  }

  private readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  }

  private readNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }
}
