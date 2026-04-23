import "dotenv/config";

import express from "express";

import { DatabaseController } from "./controllers/database.controller";
import { createReportsRouter, ReportsController } from "./controllers/reports.controller";
import { EtlService } from "./services/etl.service";
import { FirebirdService } from "./services/firebird.service";
import { PostgresService } from "./services/postgres.service";
import { loadConfig } from "./utils/validation";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const postgresService = new PostgresService(config.postgres);
  await postgresService.ensureSchema();
  const firebirdService = new FirebirdService(config.firebird, postgresService);
  const etlService = new EtlService(firebirdService, postgresService, config.etlBatchSize);
  const databaseController = new DatabaseController(firebirdService, postgresService);
  const reportsController = new ReportsController(etlService, postgresService);
  const app = express();

  app.use(express.json());

  app.get("/health", async (_request, response) => {
    try {
      const result = await postgresService.query('SELECT 1');
      if (!result || !result.rows) {
        response.status(503).json({ status: "unhealthy", reason: "PostgreSQL query failed" });
        return;
      }
      response.status(200).json({ status: "healthy", postgres: "connected" });
    } catch (error) {
      response.status(503).json({ 
        status: "unhealthy", 
        reason: "PostgreSQL connection failed",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/database/check", databaseController.checkConnections);
  app.get("/api/config/firebird", databaseController.getFirebird);
  app.get("/api/config/clinic-directory-issues", databaseController.getClinicDirectoryIssues);
  app.post("/api/config/test-firebird", databaseController.testFirebird);
  app.post("/api/config/save-firebird", databaseController.saveFirebird);
  app.use("/api/reports", createReportsRouter(reportsController));

  const server = app.listen(config.port, () => {
    console.log(`Backend is listening on port ${config.port}`);
  });

  const shutdown = async (): Promise<void> => {
    server.close(async () => {
      await postgresService.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception", error);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
