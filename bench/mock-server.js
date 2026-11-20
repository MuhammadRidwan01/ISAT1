// Minimal stand-in for the real app, ONLY for dry-running the k6 scripts.
// It follows the PRD's API shape, keeps everything in memory and has no dependencies.
// Usage: node mock-server.js        (listens on PORT, default 8080)
// Env:   REPORT_ITER_PER_LEVEL (default 20000), INSTANCE_ID
const http = require("http");
const crypto = require("crypto");
const os = require("os");

const PORT = Number(process.env.PORT || 8080);
const INSTANCE_ID = process.env.INSTANCE_ID || os.hostname();
const ITER_PER_LEVEL = Number(process.env.REPORT_ITER_PER_LEVEL || 20000);
const STARTED_AT = new Date();

const CATEGORIES = [
  "books",
  "toys",
  "garden",
  "kitchen",
  "sports",
  "office",
  "music",
  "tools",
];
const products = Array.from({ length: 1000 }, (_, i) => ({
  id: i + 1,
  sku: `SKU-${String(i + 1).padStart(5, "0")}`,
  name: `Product ${i + 1}`,
  description: `Description of product ${i + 1}`,
  category: CATEGORIES[i % CATEGORIES.length],
  priceCents: 500 + ((i * 37) % 9500),
  stock: 100,
}));
const orders = new Map();
let nextOrderId = 1;

function send(res, start, status, body) {
  const json = JSON.stringify(body);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Instance-Id", INSTANCE_ID);
  res.setHeader(
    "Server-Timing",
    `app;dur=${(performance.now() - start).toFixed(1)}`,
  );
  res.statusCode = status;
  res.end(json);
}
const err = (res, start, status, code, message) =>
  send(res, start, status, { error: { code, message } });

function health() {
  return {
    status: "ok",
    instanceId: INSTANCE_ID,
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.round((Date.now() - STARTED_AT.getTime()) / 1000),
    version: "mock",
  };
}

function report(complexity) {
  const iterations = complexity * ITER_PER_LEVEL;
  const buf = Buffer.alloc(1024, 7);
  const t0 = performance.now();
  let h = buf;
  for (let i = 0; i < iterations; i++)
    h = crypto.createHash("sha256").update(h).digest();
  return {
    aggregates: { revenuePerCategory: [], topProducts: [], revenuePerDay: [] },
    cpu: {
      iterations,
      durationMs: Math.round(performance.now() - t0),
      checksum: h.toString("hex"),
    },
  };
}

const server = http.createServer((req, res) => {
  const start = performance.now();
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/health")
    return send(res, start, 200, health());
  if (req.method === "GET" && path === "/health/db")
    return send(res, start, 200, { ...health(), db: "ok" });
  if (req.method === "GET" && path === "/api/categories")
    return send(res, start, 200, CATEGORIES);

  if (req.method === "GET" && path === "/api/products") {
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") || 20)),
    );
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const category = url.searchParams.get("category");
    const all = category
      ? products.filter((p) => p.category === category)
      : products;
    return send(res, start, 200, {
      items: all.slice(offset, offset + limit),
      total: all.length,
      limit,
      offset,
    });
  }

  let m = /^\/api\/products\/(\d+)$/.exec(path);
  if (req.method === "GET" && m) {
    const p = products[Number(m[1]) - 1];
    return p
      ? send(res, start, 200, p)
      : err(res, start, 404, "not_found", "Product not found");
  }

  m = /^\/api\/orders\/(\d+)$/.exec(path);
  if (req.method === "GET" && m) {
    const o = orders.get(Number(m[1]));
    return o
      ? send(res, start, 200, o)
      : err(res, start, 404, "not_found", "Order not found");
  }

  if (req.method === "POST" && path === "/api/orders") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let b;
      try {
        b = JSON.parse(raw);
      } catch (e) {
        return err(res, start, 400, "invalid_json", "Body must be JSON");
      }
      const okItems =
        Array.isArray(b.items) && b.items.length >= 1 && b.items.length <= 10;
      const okName =
        typeof b.customerName === "string" &&
        b.customerName.length >= 1 &&
        b.customerName.length <= 100;
      const okEmail =
        typeof b.customerEmail === "string" &&
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.customerEmail);
      if (!okItems || !okName || !okEmail)
        return err(res, start, 400, "validation_error", "Invalid order");
      let total = 0;
      const items = [];
      for (const it of b.items) {
        const p = products[Number(it.productId) - 1];
        const q = Number(it.quantity);
        if (!p)
          return err(
            res,
            start,
            422,
            "unknown_product",
            `Unknown productId ${it.productId}`,
          );
        if (!(q >= 1 && q <= 10))
          return err(res, start, 400, "validation_error", "Invalid quantity");
        total += p.priceCents * q;
        items.push({
          productId: p.id,
          quantity: q,
          unitPriceCents: p.priceCents,
        });
      }
      const order = {
        id: nextOrderId++,
        status: "confirmed",
        totalCents: total,
        createdAt: new Date().toISOString(),
        items,
      };
      orders.set(order.id, order);
      if (orders.size > 50000) orders.delete(orders.keys().next().value);
      send(res, start, 201, order);
    });
    return;
  }

  if (req.method === "GET" && path === "/api/report") {
    const c = Number(url.searchParams.get("complexity") || 3);
    if (!Number.isInteger(c) || c < 1 || c > 10)
      return err(
        res,
        start,
        400,
        "validation_error",
        "complexity must be 1-10",
      );
    return send(res, start, 200, report(c));
  }

  err(res, start, 404, "not_found", "Route not found");
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`mock server on :${PORT} (instance ${INSTANCE_ID})`),
);
