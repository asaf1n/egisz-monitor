import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import {
  AppConfig,
  ClinicDirectoryIssue,
  FirebirdConfigResponse,
  FirebirdConnectionConfig,
  PostgresConnectionIssue,
  StarSchemaLogRecord
} from "../types";
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
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schemaName}`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.app_config (
          config_key TEXT PRIMARY KEY,
          config_value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.app_config
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.dim_clinics (
          clinic_id SERIAL PRIMARY KEY,
          jid BIGINT NOT NULL,
          mo_uid VARCHAR(256) NOT NULL UNIQUE,
          mo_domen VARCHAR(256),
          jname VARCHAR(255),
          is_verified BOOLEAN NOT NULL DEFAULT TRUE
        )
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.dim_clinics
        ADD COLUMN IF NOT EXISTS mo_domen VARCHAR(256)
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.dim_clinics
        ADD COLUMN IF NOT EXISTS jname VARCHAR(255)
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.dim_clinics
        ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT TRUE
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.dim_services (
          service_id SERIAL PRIMARY KEY,
          kind BIGINT NOT NULL UNIQUE,
          service_type BIGINT NOT NULL,
          description VARCHAR(255)
        )
      `);

      await client.query(`
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

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.egisz_errors (
          error_id BIGSERIAL PRIMARY KEY,
          original_log_id BIGINT NOT NULL UNIQUE,
          clinic_id INT,
          transaction_date TIMESTAMP NOT NULL,
          error_category VARCHAR(50) NOT NULL,
          error_text TEXT NOT NULL,
          hostname VARCHAR(256)
        )
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.egisz_errors
        ADD COLUMN IF NOT EXISTS clinic_id INT
      `);
      await client.query(`
        ALTER TABLE ${this.schemaName}.egisz_errors
        ADD COLUMN IF NOT EXISTS hostname VARCHAR(256)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.schemaName}.dim_error_costs (
          error_cost_id SERIAL PRIMARY KEY,
          error_category VARCHAR(50) NOT NULL UNIQUE,
          error_subcategory VARCHAR(50),
          base_cost_per_error DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          escalation_multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.00,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await this.migrateClinicDirectory(client);
      await this.normalizeErrorCategories(client);
      await this.backfillEgiszErrorClinicIds(client);
      await this.enforceEgiszErrorClinicForeignKey(client);
      await this.createIndexes(client);
      await this.createAnalyticsViews(client);

      await client.query("COMMIT");
    } catch (error) {
      await this.rollbackQuietly(client);
      throw this.toDatabaseError(error, "Failed to ensure PostgreSQL schema");
    } finally {
      client.release();
    }
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

  async initializeDefaultErrorCosts(): Promise<void> {
    await this.ensureSchema();

    const defaultCosts = [
      { error_category: 'network', error_subcategory: null, base_cost_per_error: 50.00, escalation_multiplier: 1.00 },
      { error_category: 'async', error_subcategory: null, base_cost_per_error: 25.00, escalation_multiplier: 1.00 },
      { error_category: 'other', error_subcategory: 'auth', base_cost_per_error: 100.00, escalation_multiplier: 2.00 },
      { error_category: 'other', error_subcategory: 'timeout', base_cost_per_error: 75.00, escalation_multiplier: 1.50 },
      { error_category: 'other', error_subcategory: 'connection_refused', base_cost_per_error: 60.00, escalation_multiplier: 1.20 },
      { error_category: 'other', error_subcategory: 'proxy', base_cost_per_error: 40.00, escalation_multiplier: 1.00 },
      { error_category: 'other', error_subcategory: 'egisz', base_cost_per_error: 80.00, escalation_multiplier: 1.80 },
      { error_category: 'other', error_subcategory: 'validation', base_cost_per_error: 30.00, escalation_multiplier: 1.00 },
      { error_category: 'other', error_subcategory: 'unknown', base_cost_per_error: 45.00, escalation_multiplier: 1.10 }
    ];

    for (const cost of defaultCosts) {
      await this.pool.query(
        `
          INSERT INTO ${this.schemaName}.dim_error_costs (
            error_category, error_subcategory, base_cost_per_error, escalation_multiplier, is_active
          )
          VALUES ($1, $2, $3, $4, TRUE)
          ON CONFLICT (error_category) DO UPDATE SET
            error_subcategory = EXCLUDED.error_subcategory,
            base_cost_per_error = EXCLUDED.base_cost_per_error,
            escalation_multiplier = EXCLUDED.escalation_multiplier,
            updated_at = NOW()
          WHERE ${this.schemaName}.dim_error_costs.error_subcategory IS NULL
             OR ${this.schemaName}.dim_error_costs.error_subcategory = EXCLUDED.error_subcategory
        `,
        [cost.error_category, cost.error_subcategory, cost.base_cost_per_error, cost.escalation_multiplier]
      );
    }
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
        await this.upsertEgiszError(client, record, clinicId);
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
      throw this.toDatabaseError(error, "PostgreSQL ping failed");
    }
  }

  inspectConnectionIssue(error: unknown): PostgresConnectionIssue {
    const message = error instanceof Error ? error.message : "Unknown PostgreSQL error";

    if (/password authentication failed|28p01/i.test(message)) {
      return {
        code: "authentication_failed",
        message,
        userHint:
          `Проверьте пользователя/пароль PostgreSQL для существующего pgdata. ` +
          `Переменные окружения не переопределяют уже созданных пользователей.`
      };
    }

    if (/does not exist|connection refused|timeout expired|getaddrinfo|ecconnrefused|3d000/i.test(message)) {
      return {
        code: "database_unavailable",
        message,
        userHint: "Проверьте доступность контейнера db, имя базы и сетевые параметры подключения."
      };
    }

    if (/ensure PostgreSQL schema|clinic_id after migration|relation .* does not exist/i.test(message)) {
      return {
        code: "schema_migration_failed",
        message,
        userHint: "Проверьте состояние существующего pgdata и консистентность исторических данных перед миграцией."
      };
    }

    return {
      code: "unknown",
      message,
      userHint: null
    };
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

  getQualifiedTableName(
    tableName: "app_config" | "dim_clinics" | "dim_services" | "fact_transactions" | "egisz_errors" | "dim_error_costs" |
    "view_daily_summary" | "view_error_analysis" | "view_clinic_sla" | "v_unified_analytics" | 
    "v_support_economic_metrics" | "v_vpn_node_stability"
  ): string {
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

  async listUnverifiedClinics(): Promise<ClinicDirectoryIssue[]> {
    await this.ensureSchema();

    const result = await this.pool.query<ClinicDirectoryIssue>(
      `
        SELECT
          clinic_id AS "clinicId",
          jid,
          mo_uid AS "moUid",
          mo_domen AS "moDomen",
          jname,
          is_verified AS "isVerified"
        FROM ${this.schemaName}.dim_clinics
        WHERE is_verified = FALSE
        ORDER BY COALESCE(mo_domen, mo_uid) ASC
      `
    );

    return result.rows;
  }

  private async upsertClinic(client: PoolClient, record: StarSchemaLogRecord): Promise<number> {
    if (record.clinic.moDomen) {
      const existingClinicId = await this.findClinicIdByDomain(client, record.clinic.moDomen);

      if (existingClinicId !== null) {
        await client.query(
          `
            UPDATE ${this.schemaName}.dim_clinics
            SET
              jid = CASE WHEN $2 <> 0 THEN $2 ELSE jid END,
              mo_uid = CASE
                WHEN is_verified = FALSE AND $5 = TRUE THEN $3
                ELSE mo_uid
              END,
              jname = CASE
                WHEN $4::VARCHAR(255) IS NOT NULL AND ($5 = TRUE OR jname IS NULL OR jname LIKE 'Неизвестная клиника (%)')
                  THEN $4::VARCHAR(255)
                ELSE jname
              END,
              is_verified = is_verified OR $5
            WHERE clinic_id = $1
          `,
          [
            existingClinicId,
            record.clinic.jid,
            record.clinic.moUid,
            record.clinic.jname,
            record.clinic.isVerified
          ]
        );

        return existingClinicId;
      }
    }

    const effectiveMoUid = record.clinic.isVerified ? record.clinic.moUid : `ghost-${record.clinic.moDomen ?? record.clinic.moUid}`;
    const effectiveJname = record.clinic.isVerified
      ? record.clinic.jname
      : `Неизвестная клиника (${record.clinic.moDomen ?? record.clinic.moUid})`;

    const result = await client.query<{ clinic_id: number }>(
      `
        INSERT INTO ${this.schemaName}.dim_clinics (jid, mo_uid, mo_domen, jname, is_verified)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (mo_uid) DO UPDATE
        SET
          jid = CASE WHEN EXCLUDED.jid <> 0 THEN EXCLUDED.jid ELSE ${this.schemaName}.dim_clinics.jid END,
          mo_domen = COALESCE(EXCLUDED.mo_domen, ${this.schemaName}.dim_clinics.mo_domen),
          jname = CASE
            WHEN EXCLUDED.is_verified THEN COALESCE(EXCLUDED.jname, ${this.schemaName}.dim_clinics.jname)
            ELSE COALESCE(${this.schemaName}.dim_clinics.jname, EXCLUDED.jname)
          END,
          is_verified = ${this.schemaName}.dim_clinics.is_verified OR EXCLUDED.is_verified
        RETURNING clinic_id
      `,
      [
        record.clinic.jid,
        effectiveMoUid,
        record.clinic.moDomen,
        effectiveJname,
        record.clinic.isVerified
      ]
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

  private async upsertEgiszError(
    client: PoolClient,
    record: StarSchemaLogRecord,
    clinicId: number
  ): Promise<void> {
    if (!record.error) {
      return;
    }

    await client.query(
      `
        INSERT INTO ${this.schemaName}.egisz_errors (
          original_log_id,
          clinic_id,
          transaction_date,
          error_category,
          error_text,
          hostname
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (original_log_id) DO UPDATE
        SET
          clinic_id = EXCLUDED.clinic_id,
          transaction_date = EXCLUDED.transaction_date,
          error_category = EXCLUDED.error_category,
          error_text = EXCLUDED.error_text,
          hostname = EXCLUDED.hostname
      `,
      [
        record.error.originalLogId,
        clinicId,
        record.error.transactionDate,
        record.error.errorCategory,
        record.error.errorText,
        record.error.hostname
      ]
    );
  }

  private async migrateClinicDirectory(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dim_clinics_mo_domen
      ON ${this.schemaName}.dim_clinics(mo_domen)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dim_clinics_jid
      ON ${this.schemaName}.dim_clinics(jid)
    `);
    await client.query(`
      UPDATE ${this.schemaName}.dim_clinics
      SET mo_domen = lower(trim(regexp_replace(regexp_replace(mo_domen, '^[a-z][a-z0-9+.-]*://', '', 'i'), '/+$', '')))
      WHERE mo_domen IS NOT NULL
    `);
    await client.query(`
      UPDATE ${this.schemaName}.dim_clinics
      SET mo_domen = regexp_replace(mo_domen, ':\d+$', '')
      WHERE mo_domen IS NOT NULL
    `);
    await client.query(`
      UPDATE ${this.schemaName}.dim_clinics
      SET is_verified = CASE
        WHEN jname IS NOT NULL AND jname NOT LIKE 'Неизвестная клиника (%)' THEN TRUE
        ELSE COALESCE(is_verified, FALSE)
      END
    `);

    const legacyClinicsExists = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = $1
            AND table_name = 'clinics'
        ) AS exists
      `,
      [this.schemaName]
    );

    if (legacyClinicsExists.rows[0]?.exists) {
      await client.query(`
        UPDATE ${this.schemaName}.dim_clinics AS dc
        SET jname = COALESCE(dc.jname, legacy.jname)
        FROM ${this.schemaName}.clinics AS legacy
        WHERE legacy.mo_domen = dc.mo_domen
          AND legacy.jname IS NOT NULL
      `);
    }

    await client.query(`
      WITH canonical AS (
        SELECT DISTINCT ON (mo_domen)
          mo_domen,
          clinic_id
        FROM ${this.schemaName}.dim_clinics
        WHERE mo_domen IS NOT NULL
        ORDER BY mo_domen, is_verified DESC, clinic_id ASC
      )
      UPDATE ${this.schemaName}.fact_transactions AS ft
      SET clinic_id = canonical.clinic_id
      FROM ${this.schemaName}.dim_clinics AS source_clinic
      JOIN canonical
        ON canonical.mo_domen = source_clinic.mo_domen
      WHERE ft.clinic_id = source_clinic.clinic_id
        AND source_clinic.clinic_id <> canonical.clinic_id
    `);
    await client.query(`
      WITH canonical AS (
        SELECT DISTINCT ON (mo_domen)
          mo_domen,
          clinic_id
        FROM ${this.schemaName}.dim_clinics
        WHERE mo_domen IS NOT NULL
        ORDER BY mo_domen, is_verified DESC, clinic_id ASC
      )
      UPDATE ${this.schemaName}.egisz_errors AS ee
      SET clinic_id = canonical.clinic_id
      FROM ${this.schemaName}.dim_clinics AS source_clinic
      JOIN canonical
        ON canonical.mo_domen = source_clinic.mo_domen
      WHERE ee.clinic_id = source_clinic.clinic_id
        AND source_clinic.clinic_id <> canonical.clinic_id
    `);
    await client.query(`
      DELETE FROM ${this.schemaName}.dim_clinics AS duplicate_row
      USING ${this.schemaName}.dim_clinics AS kept_row
      WHERE duplicate_row.clinic_id > kept_row.clinic_id
        AND duplicate_row.mo_domen IS NOT NULL
        AND duplicate_row.mo_domen = kept_row.mo_domen
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dim_clinics_mo_domen_unique
      ON ${this.schemaName}.dim_clinics(mo_domen)
      WHERE mo_domen IS NOT NULL
    `);
  }

  private async normalizeErrorCategories(client: PoolClient): Promise<void> {
    const networkAliases = ["network", "Сетевая", "РЎРµС‚РµРІР°СЏ"];
    const asyncAliases = ["async", "Асинхронная", "РђСЃРёРЅС…СЂРѕРЅРЅР°СЏ"];

    await client.query(
      `
        UPDATE ${this.schemaName}.fact_transactions
        SET error_category = 'network'
        WHERE error_category = ANY($1::text[])
      `,
      [networkAliases]
    );
    await client.query(
      `
        UPDATE ${this.schemaName}.fact_transactions
        SET error_category = 'async'
        WHERE error_category = ANY($1::text[])
      `,
      [asyncAliases]
    );
    await client.query(
      `
        UPDATE ${this.schemaName}.egisz_errors
        SET error_category = 'network'
        WHERE error_category = ANY($1::text[])
      `,
      [networkAliases]
    );
    await client.query(
      `
        UPDATE ${this.schemaName}.egisz_errors
        SET error_category = 'async'
        WHERE error_category = ANY($1::text[])
      `,
      [asyncAliases]
    );
  }

  private async backfillEgiszErrorClinicIds(client: PoolClient): Promise<void> {
    await client.query(`
      UPDATE ${this.schemaName}.egisz_errors AS ee
      SET clinic_id = ft.clinic_id
      FROM ${this.schemaName}.fact_transactions AS ft
      WHERE ee.original_log_id = ft.original_log_id
        AND (ee.clinic_id IS NULL OR ee.clinic_id <> ft.clinic_id)
    `);
    await client.query(`
      UPDATE ${this.schemaName}.egisz_errors AS ee
      SET clinic_id = dc.clinic_id
      FROM ${this.schemaName}.dim_clinics AS dc
      WHERE ee.clinic_id IS NULL
        AND ee.hostname IS NOT NULL
        AND dc.mo_domen = ee.hostname
    `);
  }

  private async enforceEgiszErrorClinicForeignKey(client: PoolClient): Promise<void> {
    await client.query(`
      ALTER TABLE ${this.schemaName}.egisz_errors
      DROP CONSTRAINT IF EXISTS egisz_errors_clinic_id_fkey
    `);
    await client.query(`
      ALTER TABLE ${this.schemaName}.egisz_errors
      DROP CONSTRAINT IF EXISTS fk_egisz_errors_clinic
    `);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM ${this.schemaName}.egisz_errors
          WHERE clinic_id IS NULL
        ) THEN
          RAISE EXCEPTION 'egisz_errors contains rows without clinic_id after migration';
        END IF;
      END $$;
    `);
    await client.query(`
      ALTER TABLE ${this.schemaName}.egisz_errors
      ALTER COLUMN clinic_id SET NOT NULL
    `);
    await client.query(`
      ALTER TABLE ${this.schemaName}.egisz_errors
      ADD CONSTRAINT fk_egisz_errors_clinic
      FOREIGN KEY (clinic_id)
      REFERENCES ${this.schemaName}.dim_clinics(clinic_id)
    `);
  }

  private async createIndexes(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_date
      ON ${this.schemaName}.fact_transactions(transaction_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_agg_dashboard
      ON ${this.schemaName}.fact_transactions(clinic_id, service_id, status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_errors
      ON ${this.schemaName}.fact_transactions(status, error_category)
      WHERE status = 'error'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_clinic_id
      ON ${this.schemaName}.fact_transactions(clinic_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_service_id
      ON ${this.schemaName}.fact_transactions(service_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fact_trans_original_log_id
      ON ${this.schemaName}.fact_transactions(original_log_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_egisz_errors_clinic_id
      ON ${this.schemaName}.egisz_errors(clinic_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_egisz_errors_hostname
      ON ${this.schemaName}.egisz_errors(hostname)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_egisz_errors_transaction_date
      ON ${this.schemaName}.egisz_errors(transaction_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_egisz_errors_original_log_id
      ON ${this.schemaName}.egisz_errors(original_log_id)
    `);
  }

  private async createAnalyticsViews(client: PoolClient): Promise<void> {
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_service_hourly_health`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_clinic_hourly_sla`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_error_fingerprints`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_support_economic_metrics`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_vpn_node_stability`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.v_unified_analytics`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.view_clinic_sla`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.view_error_analysis`);
    await client.query(`DROP VIEW IF EXISTS ${this.schemaName}.view_daily_summary`);

    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.view_daily_summary AS
      SELECT
        ft.transaction_date::date AS summary_date,
        dc.mo_uid AS organization_oid,
        COALESCE(ds.description, ds.kind::text) AS semd_type,
        COUNT(*) FILTER (WHERE ft.status = 'success') AS success_count,
        COUNT(*) FILTER (WHERE ft.status = 'error') AS error_count
      FROM ${this.schemaName}.fact_transactions AS ft
      JOIN ${this.schemaName}.dim_clinics AS dc
        ON dc.clinic_id = ft.clinic_id
      JOIN ${this.schemaName}.dim_services AS ds
        ON ds.service_id = ft.service_id
      GROUP BY
        ft.transaction_date::date,
        dc.mo_uid,
        COALESCE(ds.description, ds.kind::text)
    `);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.view_error_analysis AS
      SELECT
        ft.error_text,
        ft.error_category AS category,
        COUNT(*) AS occurrence_count,
        CASE
          WHEN ft.error_category = 'network' THEN 'Сетевая'
          WHEN ft.error_category = 'async' THEN 'Асинхронная'
          ELSE 'Прочая'
        END AS category_ru,
        MIN(ft.transaction_date) AS first_seen_at,
        MAX(ft.transaction_date) AS last_seen_at
      FROM ${this.schemaName}.fact_transactions AS ft
      WHERE ft.status = 'error'
        AND ft.transaction_date >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      GROUP BY
        ft.error_text,
        ft.error_category
    `);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.view_clinic_sla AS
      WITH clinic_last_response AS (
        SELECT
          ft.clinic_id,
          MAX(ft.transaction_date) AS last_response_at
        FROM ${this.schemaName}.fact_transactions AS ft
        GROUP BY ft.clinic_id
      )
      SELECT
        dc.clinic_id,
        dc.jid,
        dc.jname,
        dc.mo_uid AS organization_oid,
        dc.mo_domen,
        clr.last_response_at,
        CURRENT_TIMESTAMP - clr.last_response_at AS time_since_last_response,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - clr.last_response_at))::bigint
          AS seconds_since_last_response,
        ROUND(
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - clr.last_response_at)) / 60.0,
          2
        ) AS minutes_since_last_response
      FROM ${this.schemaName}.dim_clinics AS dc
      LEFT JOIN clinic_last_response AS clr
        ON clr.clinic_id = dc.clinic_id
    `);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_unified_analytics AS
      SELECT
        ft.transaction_id,
        ft.original_log_id,
        ft.transaction_date,
        ft.transaction_date::date AS date_day,
        date_trunc('hour', ft.transaction_date) AS date_hour,
        ft.status,
        (ft.status = 'success') AS is_success,
        (ft.status = 'error') AS is_error,
        ft.clinic_id,
        dc.jid,
        dc.jname,
        dc.is_verified,
        COALESCE(NULLIF(TRIM(dc.jname), ''), ee.hostname, dc.mo_domen, dc.mo_uid) AS clinic_display_name,
        dc.mo_uid,
        dc.mo_domen,
        ft.service_id,
        ds.kind AS service_kind,
        ds.service_type,
        ds.description AS service_description,
        COALESCE(ds.description, ds.service_type::TEXT, ds.kind::TEXT) AS service_display_name,
        ft.error_category,
        CASE
          WHEN ft.error_category = 'network' THEN 'Сетевая'
          WHEN ft.error_category = 'async' THEN 'Асинхронная'
          WHEN ft.error_category IS NULL THEN NULL
          ELSE 'Прочая'
        END AS error_category_ru,
        CASE
          WHEN ft.status <> 'error' THEN NULL
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'auth|authentication|авторизац|логин|парол|token|401|403'
            THEN 'auth'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'timeout|timed out|таймаут'
            THEN 'timeout'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'connection refused|connect failed|could not connect|соединени'
            THEN 'connection_refused'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'proxy'
            THEN 'proxy'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'egisz|егисз'
            THEN 'egisz'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'validation|invalid|некоррект|ошибка формата'
            THEN 'validation'
          ELSE 'unknown'
        END AS error_subcategory,
        COALESCE(ee.error_text, ft.error_text) AS error_text,
        md5(
          COALESCE(ft.error_category, '') || '|' ||
          COALESCE(
            regexp_replace(COALESCE(ee.error_text, ft.error_text, ''), '\s+', ' ', 'g'),
            ''
          )
        ) AS error_fingerprint,
        ee.hostname,
        (ee.error_id IS NOT NULL) AS has_egisz_error_record,
        COALESCE(dec.base_cost_per_error, 0.00) AS error_base_cost,
        COALESCE(dec.escalation_multiplier, 1.00) AS error_escalation_multiplier,
        CASE
          WHEN ft.status = 'error' THEN COALESCE(dec.base_cost_per_error * dec.escalation_multiplier, 0.00)
          ELSE 0.00
        END AS error_cost
      FROM ${this.schemaName}.fact_transactions AS ft
      JOIN ${this.schemaName}.dim_clinics AS dc
        ON dc.clinic_id = ft.clinic_id
      JOIN ${this.schemaName}.dim_services AS ds
        ON ds.service_id = ft.service_id
      LEFT JOIN ${this.schemaName}.egisz_errors AS ee
        ON ee.original_log_id = ft.original_log_id
      LEFT JOIN ${this.schemaName}.dim_error_costs AS dec
        ON dec.error_category = COALESCE(
          CASE
            WHEN ft.status <> 'error' THEN NULL
            WHEN COALESCE(ee.error_text, ft.error_text) ~* 'auth|authentication|авторизац|логин|парол|token|401|403'
              THEN 'other'
            WHEN COALESCE(ee.error_text, ft.error_text) ~* 'timeout|timed out|таймаут'
              THEN 'other'
            WHEN COALESCE(ee.error_text, ft.error_text) ~* 'connection refused|connect failed|could not connect|соединени'
              THEN 'other'
            WHEN COALESCE(ee.error_text, ft.error_text) ~* 'proxy'
              THEN 'other'
            WHEN COALESCE(ee.error_text, ft.error_text) ~* 'egisz|егисз'
              THEN 'other'
            WHEN COALESCE(ee.error_text, ft.error_text) ~* 'validation|invalid|некоррект|ошибка формата'
              THEN 'other'
            ELSE ft.error_category
          END,
          'other'
        ) AND dec.error_subcategory = CASE
          WHEN ft.status <> 'error' THEN NULL
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'auth|authentication|авторизац|логин|парол|token|401|403'
            THEN 'auth'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'timeout|timed out|таймаут'
            THEN 'timeout'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'connection refused|connect failed|could not connect|соединени'
            THEN 'connection_refused'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'proxy'
            THEN 'proxy'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'egisz|егисз'
            THEN 'egisz'
          WHEN COALESCE(ee.error_text, ft.error_text) ~* 'validation|invalid|некоррект|ошибка формата'
            THEN 'validation'
          ELSE 'unknown'
        END
    `);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_error_fingerprints AS
      SELECT
        ua.error_fingerprint,
        ua.error_category,
        ua.error_category_ru,
        ua.error_subcategory,
        MIN(ua.transaction_date) AS first_seen_at,
        MAX(ua.transaction_date) AS last_seen_at,
        COUNT(*) AS total_occurrences,
        COUNT(DISTINCT ua.clinic_id) AS affected_clinics,
        COUNT(DISTINCT ua.hostname) FILTER (WHERE ua.hostname IS NOT NULL) AS affected_hosts,
        MIN(ua.error_text) AS sample_error_text
      FROM ${this.schemaName}.v_unified_analytics AS ua
      WHERE ua.is_error
      GROUP BY
        ua.error_fingerprint,
        ua.error_category,
        ua.error_category_ru,
        ua.error_subcategory
    `);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_clinic_hourly_sla AS
      SELECT
        ua.date_hour,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (WHERE ua.is_success) AS successful_requests,
        COUNT(*) FILTER (WHERE ua.is_error) AS failed_requests,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*) FILTER (WHERE ua.transaction_id IS NOT NULL), 0),
          2
        ) AS sla_success_pct
      FROM ${this.schemaName}.v_unified_analytics AS ua
      GROUP BY
        ua.date_hour,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid
    `);
    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_service_hourly_health AS
      SELECT
        ua.date_hour,
        ua.service_id,
        ua.service_kind,
        ua.service_type,
        ua.service_display_name,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (WHERE ua.is_success) AS successful_requests,
        COUNT(*) FILTER (WHERE ua.is_error) AS failed_requests,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0),
          2
        ) AS success_rate_pct
      FROM ${this.schemaName}.v_unified_analytics AS ua
      GROUP BY
        ua.date_hour,
        ua.service_id,
        ua.service_kind,
        ua.service_type,
        ua.service_display_name
    `);

    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_support_economic_metrics AS
      SELECT
        ua.date_day,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid,
        ua.mo_domen,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (WHERE ua.is_error) AS error_count,
        SUM(ua.error_cost) AS total_error_cost,
        ROUND(AVG(ua.error_cost) FILTER (WHERE ua.is_error), 2) AS avg_error_cost,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ua.is_error) / NULLIF(COUNT(*), 0),
          2
        ) AS error_rate_pct,
        MAX(ua.transaction_date) AS last_transaction_at,
        CASE
          WHEN COUNT(*) FILTER (WHERE ua.is_error) > 10 THEN 'high'
          WHEN COUNT(*) FILTER (WHERE ua.is_error) > 5 THEN 'medium'
          ELSE 'low'
        END AS support_priority
      FROM ${this.schemaName}.v_unified_analytics AS ua
      WHERE ua.transaction_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY
        ua.date_day,
        ua.clinic_id,
        ua.jid,
        ua.jname,
        ua.clinic_display_name,
        ua.mo_uid,
        ua.mo_domen
    `);

    await client.query(`
      CREATE OR REPLACE VIEW ${this.schemaName}.v_vpn_node_stability AS
      WITH hourly_stats AS (
        SELECT
          ua.hostname,
          date_trunc('hour', ua.transaction_date) AS date_hour,
          COUNT(*) AS total_requests,
          COUNT(*) FILTER (WHERE ua.is_success) AS successful_requests,
          COUNT(*) FILTER (WHERE ua.is_error) AS failed_requests,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE ua.is_success) / NULLIF(COUNT(*), 0),
            2
          ) AS success_rate_pct
        FROM ${this.schemaName}.v_unified_analytics AS ua
        WHERE ua.hostname IS NOT NULL
          AND ua.transaction_date >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
        GROUP BY ua.hostname, date_trunc('hour', ua.transaction_date)
      )
      SELECT
        hostname,
        date_hour,
        total_requests,
        successful_requests,
        failed_requests,
        success_rate_pct,
        0 AS avg_response_time_seconds,
        CASE
          WHEN success_rate_pct < 90 THEN 'critical'
          WHEN success_rate_pct < 95 THEN 'warning'
          ELSE 'stable'
        END AS stability_status,
        'normal' AS performance_status
      FROM hourly_stats
      ORDER BY hostname, date_hour DESC
    `);
  }

  private validateSchemaName(value: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
      throw new Error("POSTGRES_SCHEMA must be a valid SQL identifier");
    }

    return value;
  }

  private async findClinicIdByDomain(client: PoolClient, hostname: string): Promise<number | null> {
    const result = await client.query<{ clinic_id: number }>(
      `
        SELECT clinic_id
        FROM ${this.schemaName}.dim_clinics
        WHERE mo_domen = $1
        ORDER BY is_verified DESC, clinic_id ASC
        LIMIT 1
      `,
      [hostname]
    );

    return result.rows[0]?.clinic_id ?? null;
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

  private toDatabaseError(error: unknown, prefix: string): Error {
    const originalMessage = error instanceof Error ? error.message : "Unknown PostgreSQL error";
    const issue = this.inspectConnectionIssue(error);
    const hint = issue.userHint ? ` ${issue.userHint}` : "";

    return new Error(
      `${prefix} for ${this.config.host}:${this.config.port}/${this.config.database}. ${originalMessage}${hint}`
    );
  }
}
