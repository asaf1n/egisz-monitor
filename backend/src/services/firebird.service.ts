const Firebird = require("node-firebird");
const FirebirdWireConst = require("node-firebird/lib/wire/const");

import { AppConfig, FirebirdConfigPayload, FirebirdConnectionConfig, FirebirdLicenseLogRow } from "../types";
import { PostgresService } from "./postgres.service";

const REQUIRED_FIREBIRD_FETCH_SIZE = 200;
const FIREBIRD_ATTACH_TIMEOUT_MS = Number(process.env.FIREBIRD_ATTACH_TIMEOUT_MS ?? "8000");
const FIREBIRD_QUERY_TIMEOUT_MS = Number(process.env.FIREBIRD_QUERY_TIMEOUT_MS ?? "12000");
const FIREBIRD_ETL_QUERY_TIMEOUT_MS = Number(process.env.FIREBIRD_ETL_QUERY_TIMEOUT_MS ?? "30000");
const FIREBIRD_COUNT_QUERY_TIMEOUT_MS = Number(process.env.FIREBIRD_COUNT_QUERY_TIMEOUT_MS ?? "15000");
const FIREBIRD_ETL_PAGE_SIZE = (() => {
  const parsed = Number(process.env.FIREBIRD_ETL_PAGE_SIZE ?? "200");
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 200;
})();

type FirebirdDatabase = {
  query: (sql: string, callback: (error: Error | null, result: FirebirdLicenseLogRow[] | undefined) => void) => void;
  detach: (callback: (error?: Error | null) => void) => void;
};

type FirebirdAttachOptions = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  pageSize: number;
  role: null;
  lowercase_keys: false;
  retryConnectionInterval: number;
  pluginName: string;
};

export class FirebirdService {
  private pool: any = null;
  private poolConfigString: string | null = null;

  async initializePool(config?: FirebirdConnectionConfig): Promise<void> {
    const resolvedConfig = config ?? await this.getResolvedConfig();
    const configString = JSON.stringify(resolvedConfig);

    if (this.pool && this.poolConfigString === configString) {
      return;
    }

    if (this.pool) {
      this.pool.destroy();
      this.pool = null;
    }

    const normalizedConfig = {
      ...resolvedConfig,
      host: resolvedConfig.host.trim(),
      alias: resolvedConfig.alias.trim(),
      user: resolvedConfig.user.trim()
    };

    const authPlugins = [Firebird.AUTH_PLUGIN_SRP256, Firebird.AUTH_PLUGIN_SRP, Firebird.AUTH_PLUGIN_LEGACY].filter(
      (plugin): plugin is string => typeof plugin === "string" && plugin.length > 0
    );

    let workingPlugin: string | null = null;
    const connectionErrors: string[] = [];

    for (const pluginName of authPlugins) {
      try {
        const db = await this.attachWithPlugin(normalizedConfig, pluginName);
        await this.detach(db);
        workingPlugin = pluginName;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Firebird connection error";
        connectionErrors.push(`[${pluginName}] ${message}`);
      }
    }

    if (!workingPlugin) {
      throw new Error(
        `Failed to connect to Firebird at ${normalizedConfig.host}:${normalizedConfig.alias} on port ${
          normalizedConfig.port
        }. ${connectionErrors.join(" ")}`
      );
    }

    const options: FirebirdAttachOptions = {
      host: normalizedConfig.host,
      port: normalizedConfig.port,
      database: normalizedConfig.alias,
      user: normalizedConfig.user,
      password: normalizedConfig.password,
      pageSize: normalizedConfig.pageSize,
      role: null,
      lowercase_keys: false,
      retryConnectionInterval: 1000,
      pluginName: workingPlugin
    };

    this.pool = Firebird.pool(5, options);
    this.poolConfigString = configString;
  }

  constructor(
    private readonly fallbackConfig: AppConfig["firebird"],
    private readonly postgresService: PostgresService
  ) {
    this.ensureFetchSize();
  }

  async testConnection(payload: FirebirdConfigPayload): Promise<void> {
    const config = this.mapPayloadToConfig(payload);
    await this.executeQuery(config, "SELECT 1 FROM RDB$DATABASE", FIREBIRD_QUERY_TIMEOUT_MS);
  }

  async fetchLicenseExchangeLogs(): Promise<FirebirdLicenseLogRow[]> {
    const pageSize = FIREBIRD_ETL_PAGE_SIZE;
    let skip = 0;
    let rows: FirebirdLicenseLogRow[] = [];

    while (true) {
      const page = await this.fetchLicenseExchangeLogsPage(skip, pageSize);

      if (page.length === 0) {
        break;
      }

      rows = rows.concat(page);
      skip += page.length;

      if (page.length < pageSize) {
        break;
      }
    }

    return rows;
  }

  async fetchLicenseExchangeLogsPage(skip: number, limit = FIREBIRD_ETL_PAGE_SIZE): Promise<FirebirdLicenseLogRow[]> {
    const config = await this.getResolvedConfig();
    const paginatedQuery = this.buildPaginatedQuery(config.joinQuery, skip, limit);
    const result = await this.executeQuery(config, paginatedQuery, FIREBIRD_ETL_QUERY_TIMEOUT_MS);
    return Array.isArray(result) ? result : [];
  }

  async fetchEnrichmentDictionary(): Promise<FirebirdLicenseLogRow[]> {
    const config = await this.getResolvedConfig();
    const query = `
      SELECT
        l.MO_DOMEN AS MO_DOMEN,
        l.JID AS JID,
        l.MO_UID AS MO_UID,
        l.KIND AS KIND,
        l.SERVICE_TYPE AS SERVICE_TYPE,
        jp.JNAME AS JNAME
      FROM EGISZ_LICENSES l
      LEFT JOIN JPERSONS jp ON jp.JID = l.JID
    `;
    const result = await this.executeQuery(config, query, FIREBIRD_ETL_QUERY_TIMEOUT_MS);
    return Array.isArray(result) ? result : [];
  }

  async fetchExchangeLogCount(): Promise<number> {
    const config = await this.getResolvedConfig();
    const countQuery = this.buildCountQuery(config.joinQuery);
    let result: FirebirdLicenseLogRow[] | undefined;

    try {
      result = await this.executeQuery(config, countQuery, FIREBIRD_COUNT_QUERY_TIMEOUT_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Firebird count error";
      console.warn(`[ETL] Failed to count Firebird rows. Continuing without total count. ${message}`);
      return 0;
    }

    const firstRow = Array.isArray(result) ? result[0] : null;
    const rawCount =
      firstRow && typeof firstRow === "object"
        ? (firstRow as Record<string, unknown>).TOTAL_ROWS ??
          (firstRow as Record<string, unknown>).total_rows ??
          (firstRow as Record<string, unknown>).count
        : null;
    const normalized = Number(rawCount);

    return Number.isFinite(normalized) && normalized > 0 ? Math.trunc(normalized) : 0;
  }

  async ping(): Promise<void> {
    const config = await this.getResolvedConfig();
    await this.executeQuery(config, "SELECT 1 FROM RDB$DATABASE", FIREBIRD_QUERY_TIMEOUT_MS);
  }

  private async executeQuery(
    config: FirebirdConnectionConfig,
    sql: string,
    timeoutMs: number
  ): Promise<FirebirdLicenseLogRow[] | undefined> {
    const configString = JSON.stringify(config);
    if (!this.pool || this.poolConfigString !== configString) {
      await this.initializePool(config);
    }

    return await new Promise<FirebirdLicenseLogRow[] | undefined>((resolve, reject) => {
      let completed = false;
      let borrowedDb: FirebirdDatabase | null = null;
      const timeoutEnabled = Number.isFinite(timeoutMs) && timeoutMs > 0;
      const finish = (handler: () => void): void => {
        if (completed) {
          return;
        }

        completed = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        handler();
      };
      const timeoutHandle = timeoutEnabled
        ? setTimeout(() => {
            if (borrowedDb) {
              borrowedDb.detach(() => {});
            }

            finish(() => {
              reject(
                new Error(
                  `Firebird query timeout after ${timeoutMs}ms for ${config.host}:${config.alias}.`
                )
              );
            });
          }, timeoutMs)
        : null;

      this.pool.get((error: Error | null, db: FirebirdDatabase) => {
        if (completed) {
          if (db && typeof db.detach === "function") {
            db.detach(() => {});
          }
          return;
        }

        if (error) {
          finish(() => {
            reject(new Error(`Failed to get connection from Firebird pool: ${error.message}`));
          });
          return;
        }

        borrowedDb = db;
        db.query(sql, (queryError, result) => {
          db.detach(() => {}); // Pool detach returns connection to pool

          if (completed) {
            return;
          }

          if (queryError) {
            finish(() => {
              reject(new Error(`Firebird query failed. ${queryError.message}`));
            });
            return;
          }

          finish(() => {
            resolve(result);
          });
        });
      });
    });
  }

  private async attach(config: FirebirdConnectionConfig): Promise<FirebirdDatabase> {
    const normalizedConfig = {
      ...config,
      host: config.host.trim(),
      alias: config.alias.trim(),
      user: config.user.trim()
    };

    const authPlugins = [Firebird.AUTH_PLUGIN_SRP256, Firebird.AUTH_PLUGIN_SRP, Firebird.AUTH_PLUGIN_LEGACY].filter(
      (plugin): plugin is string => typeof plugin === "string" && plugin.length > 0
    );
    const connectionErrors: string[] = [];

    for (const pluginName of authPlugins) {
      try {
        return await this.attachWithPlugin(normalizedConfig, pluginName);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Firebird connection error";
        connectionErrors.push(`[${pluginName}] ${message}`);
      }
    }

    throw new Error(
      `Failed to connect to Firebird at ${normalizedConfig.host}:${normalizedConfig.alias} on port ${
        normalizedConfig.port
      }. ${connectionErrors.join(" ")}`
    );
  }

  private async getResolvedConfig(): Promise<FirebirdConnectionConfig> {
    const storedConfig = await this.postgresService.getFirebirdConfig();

    if (storedConfig) {
      return storedConfig;
    }

    await this.postgresService.initializeDefaultFirebirdConfig();

    const initializedConfig = await this.postgresService.getFirebirdConfig();

    if (initializedConfig) {
      return initializedConfig;
    }

    return this.fallbackConfig;
  }

  private mapPayloadToConfig(payload: FirebirdConfigPayload): FirebirdConnectionConfig {
    return {
      host: payload.host.trim(),
      port: payload.port,
      alias: payload.alias.trim(),
      user: payload.user.trim(),
      password: payload.pass,
      pageSize: this.fallbackConfig.pageSize,
      joinQuery: this.fallbackConfig.joinQuery
    };
  }

  private formatConnectionHint(error: Error): string {
    const message = error.message;

    if (/ECONNREFUSED|connect failed|Unable to complete network request/i.test(message)) {
      return `${message} Check that the Firebird server is reachable from the backend container and listens on ${this.fallbackConfig.port}.`;
    }

    if (/unavailable database|database .* not found|file .* is not a valid database|I\/O error/i.test(message)) {
      return `${message} Verify that the alias exists in Firebird and points to a valid database.`;
    }

    if (/user name and password|authentication|permission|isc_auth_data/i.test(message)) {
      return `${message} Verify the Firebird login and password.`;
    }

    return message;
  }

  private async attachWithPlugin(
    config: FirebirdConnectionConfig,
    pluginName: string
  ): Promise<FirebirdDatabase> {
    const options: FirebirdAttachOptions = {
      host: config.host,
      port: config.port,
      database: config.alias,
      user: config.user,
      password: config.password,
      pageSize: config.pageSize,
      role: null,
      lowercase_keys: false,
      retryConnectionInterval: 1000,
      pluginName
    };

    return await new Promise<FirebirdDatabase>((resolve, reject) => {
      let completed = false;
      const finish = (handler: () => void): void => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timeoutHandle);
        handler();
      };
      const timeoutHandle = setTimeout(() => {
        finish(() => {
          reject(
            new Error(
              `Firebird attach timeout after ${FIREBIRD_ATTACH_TIMEOUT_MS}ms using plugin ${pluginName} (${config.host}:${config.port}/${config.alias}).`
            )
          );
        });
      }, FIREBIRD_ATTACH_TIMEOUT_MS);

      Firebird.attach(options, (error: Error | null, db: FirebirdDatabase) => {
        if (completed) {
          if (db && typeof db.detach === "function") {
            db.detach(() => {});
          }
          return;
        }

        if (error) {
          finish(() => {
            reject(new Error(this.formatConnectionHint(error)));
          });
          return;
        }

        finish(() => {
          resolve(db);
        });
      });
    });
  }

  private async detach(db: FirebirdDatabase): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      db.detach((error) => {
        if (error) {
          reject(new Error(`Failed to close Firebird connection. ${error.message}`));
          return;
        }

        resolve();
      });
    });
  }

  private ensureFetchSize(): void {
    if (FirebirdWireConst.DEFAULT_FETCHSIZE !== REQUIRED_FIREBIRD_FETCH_SIZE) {
      console.warn(
        `[Firebird] node-firebird DEFAULT_FETCHSIZE=${FirebirdWireConst.DEFAULT_FETCHSIZE}, expected ${REQUIRED_FIREBIRD_FETCH_SIZE}.`
      );
    }
  }

  private normalizeBaseQuery(sql: string): string {
    return sql.trim().replace(/;+\s*$/g, "");
  }

  private removeTrailingOrderBy(sql: string): string {
    return sql.replace(/\s+ORDER\s+BY\s+[\s\S]*$/i, "");
  }

  private buildCountQuery(baseQuery: string): string {
    const normalized = this.normalizeBaseQuery(baseQuery);
    const withoutOrder = this.removeTrailingOrderBy(normalized);
    return `SELECT COUNT(*) AS TOTAL_ROWS FROM (${withoutOrder}) count_source`;
  }

  private buildPaginatedQuery(baseQuery: string, skip: number, limit: number): string {
    const normalized = this.ensureDeterministicOrder(this.normalizeBaseQuery(baseQuery));
    const normalizedSkip = Math.max(0, Math.trunc(skip));
    const normalizedLimit = Math.max(1, Math.trunc(limit));

    const rootSelectPagination = this.injectPaginationIntoRootSelect(normalized, normalizedSkip, normalizedLimit);

    if (rootSelectPagination) {
      return rootSelectPagination;
    }

    // Fallback for uncommon custom queries that do not start with SELECT
    // (for example CTE-first statements). Keep deterministic pagination behavior.
    return `SELECT FIRST ${normalizedLimit} SKIP ${normalizedSkip} page_source.* FROM (${normalized}) page_source`;
  }

  private injectPaginationIntoRootSelect(sql: string, skip: number, limit: number): string | null {
    if (!/^\s*SELECT\b/i.test(sql)) {
      return null;
    }

    return sql.replace(
      /^\s*SELECT(?:\s+FIRST\s+\(?\s*\d+\s*\)?)?(?:\s+SKIP\s+\(?\s*\d+\s*\)?)?\b/i,
      (match) => {
        const selectKeyword = match.match(/^\s*SELECT\b/i)?.[0] ?? "SELECT";
        return `${selectKeyword} FIRST ${limit} SKIP ${skip}`;
      }
    );
  }

  private ensureDeterministicOrder(sql: string): string {
    const optimized = sql.replace(/\bORDER\s+BY\s+e\.LOGDATE\s*,\s*e\.LOGID\b/gi, "ORDER BY e.LOGID");

    if (/\bORDER\s+BY\b/i.test(optimized)) {
      return optimized;
    }

    // Firebird FIRST/SKIP pagination must have deterministic ordering.
    return `${optimized} ORDER BY LOGID`;
  }
}
