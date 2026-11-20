import Fastify from "fastify";
import { config } from "./config.js";
import { instanceId, processStart, processStartMs } from "./lib/runtime.js";
import { getPool, closePool } from "./db/pool.js";
import healthRoutes from "./routes/health.js";
import categoryRoutes from "./routes/categories.js";
import productRoutes from "./routes/products.js";
import orderRoutes from "./routes/orders.js";
import reportRoutes from "./routes/report.js";
import fs from "node:fs";
import path from "node:path";

// runtime imported

const app = Fastify({
  logger: { level: config.logLevel },
  bodyLimit: 100 * 1024,
});

// Observability: per-request timing
app.addHook("onRequest", async (req, reply) => {
  (req as any).__start = process.hrtime.bigint();
});

app.addHook("onSend", async (req, reply, payload) => {
  reply.header("X-Instance-Id", instanceId);
  const start = (req as any).__start as bigint | undefined;
  const durMs = start ? Number(process.hrtime.bigint() - start) / 1e6 : 0;
  reply.header("Server-Timing", `app;dur=${durMs.toFixed(1)}`);
  return payload;
});

app.addHook("onResponse", async (req, reply) => {
  const start = (req as any).__start as bigint | undefined;
  const durMs = start ? Number(process.hrtime.bigint() - start) / 1e6 : 0;
  req.log.info(
    {
      method: req.method,
      path: req.url,
      status: reply.statusCode,
      durationMs: Math.round(durMs),
      instanceId,
    },
    "request",
  );
});

// Error handler
app.setErrorHandler((err, req, reply) => {
  const status = (err as any).statusCode || 500;
  const e = err as any;
  const code = e.code || (status === 404 ? "not_found" : "internal_error");
  reply.status(status).send({
    error: { code, message: (err as any).message || "Internal error" },
  });
});

// Body limit 100KB
app.addContentTypeParser(
  "application/json",
  { parseAs: "string", bodyLimit: 100 * 1024 },
  (req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  },
);

// Routes
await app.register(healthRoutes);
await app.register(categoryRoutes);
await app.register(productRoutes);
await app.register(orderRoutes);
await app.register(reportRoutes);

// Static frontend
const publicDir = path.join(process.cwd(), "public");
function sendFile(reply: any, file: string, type: string) {
  const full = path.join(publicDir, file);
  if (!fs.existsSync(full)) {
    reply.status(404);
    return { error: { code: "not_found", message: "Not found" } };
  }
  reply.type(type);
  return fs.readFileSync(full);
}
app.get("/", async (_req, reply) =>
  sendFile(reply, "index.html", "text/html; charset=utf-8"),
);
app.get("/style.css", async (_req, reply) =>
  sendFile(reply, "style.css", "text/css; charset=utf-8"),
);
app.get("/app.js", async (_req, reply) =>
  sendFile(reply, "app.js", "application/javascript; charset=utf-8"),
);

// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    await closePool();
    process.exit(0);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start
if (process.env.NODE_ENV !== "test") {
  app
    .listen({ port: config.port, host: "0.0.0.0" })
    .then(() => {
      const bootMs = Date.now() - processStartMs;
      app.log.info({ bootMs, instanceId }, "server listening");
    })
    .catch((e) => {
      app.log.error(e);
      process.exit(1);
    });
}

export { app };
