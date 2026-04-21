const Firebird = require("node-firebird");

import { AppConfig, FirebirdConfigPayload, FirebirdConnectionConfig, FirebirdLicenseLogRow } from "../types";
import { PostgresService } from "./postgres.service";

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
  constructor(
    private readonly fallbackConfig: AppConfig["firebird"],
    private readonly postgresService: PostgresService
  ) {}

  async testConnection(payload: FirebirdConfigPayload): Promise<void> {
    const config = this.mapPayloadToConfig(payload);
    await this.executeQuery(config, "SELECT 1 FROM RDB$DATABASE");
  }

  async fetchLicenseExchangeLogs(): Promise<FirebirdLicenseLogRow[]> {
    const config = await this.getResolvedConfig();
    const result = await this.executeQuery(config, config.joinQuery);
    return Array.isArray(result) ? result : [];
  }

  async ping(): Promise<void> {
    const config = await this.getResolvedConfig();
    await this.executeQuery(config, "SELECT 1 FROM RDB$DATABASE");
  }

  private async executeQuery(
    config: FirebirdConnectionConfig,
    sql: string
  ): Promise<FirebirdLicenseLogRow[] | undefined> {
    const db = await this.attach(config);

    try {
      return await new Promise<FirebirdLicenseLogRow[] | undefined>((resolve, reject) => {
        db.query(sql, (queryError, result) => {
          if (queryError) {
            reject(new Error(`Firebird query failed. ${queryError.message}`));
            return;
          }

          resolve(result);
        });
      });
    } finally {
      await this.detach(db);
    }
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
      Firebird.attach(options, (error: Error | null, db: FirebirdDatabase) => {
        if (error) {
          reject(new Error(this.formatConnectionHint(error)));
          return;
        }

        resolve(db);
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
}
