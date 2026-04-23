import assert from "node:assert/strict";

import { Request, Response } from "express";

import { createReportsRouter, ReportsController } from "../src/controllers/reports.controller";
import { EtlService } from "../src/services/etl.service";
import { FirebirdService } from "../src/services/firebird.service";
import { PostgresService } from "../src/services/postgres.service";

type MockResponse = Response & {
  statusCode: number;
  body: unknown;
};

function createMockResponse(): MockResponse {
  const response = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  } as MockResponse;

  return response;
}

async function waitForTerminalStatus(etlService: EtlService): Promise<"success" | "failed"> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10_000) {
    const status = etlService.getStatus().status;

    if (status === "success" || status === "failed") {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for ETL status transition");
}

async function smokeControllerSyncStatusFallback(): Promise<void> {
  const etlMock = {
    start: () => ({ status: "running" }),
    getStatus: () => ({ status: "idle" })
  } as unknown as EtlService;

  const postgresMock = {
    getSyncStatus: async () => {
      throw new Error("temporary db failure");
    }
  } as unknown as PostgresService;

  const controller = new ReportsController(etlMock, postgresMock);
  const response = createMockResponse();

  await controller.getSyncStatus({} as Request, response);

  assert.equal(response.statusCode, 200, "sync-status should never return 5xx from controller fallback");
  assert.equal((response.body as { degraded?: boolean }).degraded, true, "fallback response should be degraded");
}

function smokeRoutesAliases(): void {
  const etlMock = {
    start: () => ({ status: "running" }),
    getStatus: () => ({ status: "idle" })
  } as unknown as EtlService;
  const postgresMock = {
    getSyncStatus: async () => ({
      totalRecords: 0,
      successRecords: 0,
      errorRecords: 0,
      lastSyncDate: null
    })
  } as unknown as PostgresService;

  const router = createReportsRouter(new ReportsController(etlMock, postgresMock));
  const stack = (router as unknown as { stack?: Array<{ route?: { path?: string } }> }).stack ?? [];
  const paths = new Set(stack.map((layer) => layer.route?.path).filter((path): path is string => Boolean(path)));

  assert(paths.has("/etl-status"), "router must keep /etl-status");
  assert(paths.has("/sync-status"), "router must keep /sync-status alias");
}

async function smokeEtlTransitions(): Promise<void> {
  const postgresMock = {
    withEtlLock: async <T>(callback: () => Promise<T>) => callback(),
    ensureSchema: async () => undefined,
    upsertStarSchemaBatch: async () => 0
  } as unknown as PostgresService;

  const firebirdSuccessMock = {
    fetchLicenseExchangeLogs: async () => []
  } as unknown as FirebirdService;
  const successService = new EtlService(firebirdSuccessMock, postgresMock, 500);

  successService.start();
  const successState = await waitForTerminalStatus(successService);
  assert.equal(successState, "success", "ETL should transition to success");

  const firebirdFailureMock = {
    fetchLicenseExchangeLogs: async () => {
      throw new Error("firebird unavailable");
    }
  } as unknown as FirebirdService;
  const failedService = new EtlService(firebirdFailureMock, postgresMock, 500);

  failedService.start();
  const failedState = await waitForTerminalStatus(failedService);
  assert.equal(failedState, "failed", "ETL should transition to failed on source errors");
}

async function main(): Promise<void> {
  await smokeControllerSyncStatusFallback();
  smokeRoutesAliases();
  await smokeEtlTransitions();
  console.log("Smoke checks passed: sync-status fallback, route aliases, ETL transitions.");
}

void main().catch((error) => {
  console.error("Smoke checks failed", error);
  process.exit(1);
});

