import { Request, Response } from "express";

import { DatabaseStatus, FirebirdConfigPayload, FirebirdConnectionConfig } from "../types";
import { FirebirdService } from "../services/firebird.service";
import { PostgresService } from "../services/postgres.service";
import { buildDefaultFirebirdJoinQuery } from "../utils/validation";

export class DatabaseController {
  constructor(
    private readonly firebirdService: FirebirdService,
    private readonly postgresService: PostgresService
  ) {}

  checkConnections = async (_request: Request, response: Response): Promise<void> => {
    const status: DatabaseStatus = {
      firebird: "ok",
      postgres: "ok",
      details: []
    };

    try {
      await this.firebirdService.ping();
    } catch (error) {
      status.firebird = "error";
      status.details.push(error instanceof Error ? error.message : "Unknown Firebird error");
    }

    try {
      await this.postgresService.ping();
    } catch (error) {
      status.postgres = "error";
      status.details.push(error instanceof Error ? error.message : "Unknown PostgreSQL error");
    }

    const statusCode = status.firebird === "ok" && status.postgres === "ok" ? 200 : 503;
    response.status(statusCode).json(status);
  };

  testFirebird = async (request: Request, response: Response): Promise<void> => {
    try {
      const payload = this.parseFirebirdPayload(request.body);
      await this.firebirdService.testConnection(payload);

      response.status(200).json({
        ok: true,
        message: "Firebird connection test succeeded"
      });
    } catch (error) {
      response.status(400).json({
        ok: false,
        message: error instanceof Error ? error.message : "Unknown Firebird test error"
      });
    }
  };

  getFirebird = async (_request: Request, response: Response): Promise<void> => {
    try {
      await this.postgresService.initializeDefaultFirebirdConfig();

      const storedConfig = await this.postgresService.getFirebirdConfigState();

      if (!storedConfig) {
        throw new Error("Firebird config is missing in app_config after initialization");
      }

      response.status(200).json(storedConfig);
    } catch (error) {
      response.status(500).json({
        ok: false,
        message: error instanceof Error ? error.message : "Unknown Firebird config read error"
      });
    }
  };

  saveFirebird = async (request: Request, response: Response): Promise<void> => {
    try {
      const payload = this.parseFirebirdPayload(request.body);
      await this.firebirdService.testConnection(payload);
      await this.postgresService.saveFirebirdConfig(this.toConnectionConfig(payload));

      response.status(200).json({
        ok: true,
        message: "Firebird configuration saved"
      });
    } catch (error) {
      response.status(400).json({
        ok: false,
        message: error instanceof Error ? error.message : "Unknown Firebird save error"
      });
    }
  };

  private parseFirebirdPayload(payload: unknown): FirebirdConfigPayload {
    if (!payload || typeof payload !== "object") {
      throw new Error("Request body must be a JSON object");
    }

    const candidate = payload as Record<string, unknown>;
    const host = this.requireString(candidate.host, "host");
    const alias = this.requireString(candidate.alias, "alias");
    const user = this.requireString(candidate.user, "user");
    const pass = this.requireString(candidate.pass, "pass");
    const port = this.requireNumber(candidate.port, "port");

    return {
      host,
      port,
      alias,
      user,
      pass
    };
  }

  private toConnectionConfig(payload: FirebirdConfigPayload): FirebirdConnectionConfig {
    return {
      host: payload.host,
      port: payload.port,
      alias: payload.alias,
      user: payload.user,
      password: payload.pass,
      joinQuery: process.env.FIREBIRD_JOIN_QUERY ?? buildDefaultFirebirdJoinQuery(),
      pageSize: Number(process.env.FIREBIRD_PAGE_SIZE ?? "4096")
    };
  }

  private requireString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Field "${fieldName}" must be a non-empty string`);
    }

    return value.trim();
  }

  private requireNumber(value: unknown, fieldName: string): number {
    if (typeof value !== "number" && typeof value !== "string") {
      throw new Error(`Field "${fieldName}" must be a number`);
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Field "${fieldName}" must be a positive integer`);
    }

    return parsed;
  }
}
