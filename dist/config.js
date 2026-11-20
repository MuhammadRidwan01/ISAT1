import "dotenv/config";
import os from "node:os";
export const config = {
  port: Number(process.env.PORT || 8080),
  databaseUrl: process.env.DATABASE_URL || "",
  dbPoolMax: Number(process.env.DB_POOL_MAX || 5),
  dbSsl: (process.env.DB_SSL ?? "true") !== "false",
  instanceId: process.env.INSTANCE_ID || os.hostname(),
  logLevel: process.env.LOG_LEVEL || "info",
  appVersion: process.env.APP_VERSION || "0.1.0",
};
