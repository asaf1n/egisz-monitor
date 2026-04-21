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
  const firebirdService = new FirebirdService(config.firebird, postgresService);
  const etlService = new EtlService(firebirdService, postgresService, config.etlBatchSize);
  const databaseController = new DatabaseController(firebirdService, postgresService);
  const reportsController = new ReportsController(etlService, postgresService);
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/api/database/check", databaseController.checkConnections);
  app.get("/api/config/firebird", databaseController.getFirebird);
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
}

bootstrap().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
