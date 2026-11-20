# Decisions and assumptions

## M1

- Node version: developed on Node 26, target Node 22 LTS for container (Dockerfile in M3).
- `/api/categories` returns an array of category strings (matches bench mock-server).
- Order response shape: `{ id, status, totalCents, createdAt, items }` with items `{ productId, quantity, unitPriceCents }`, matching bench mock-server.
- `/api/orders/:id` returns the same order shape (customer fields not included, matching mock).
- `GET /api/report` aggregates: revenue per category, top 10 products by revenue, revenue per day for last 30 days.
- CPU workload: `complexity * 200000` iterations of SHA-256 over a fixed 1KB buffer, chained (each hash feeds previous digest). Matches PRD iteration count; duration at complexity 3 measured ~218 ms on dev machine.
- Idempotent seed: skips if products already present or seed orders already present.
- Migrations tracked in `schema_migrations` table.
- Log level default info; pino JSON to stdout via Fastify logger.
- DB_SSL defaults to true; set false for local.
- ESLint ignores `bench/` (k6 globals).
- Container calibration (1 vCPU) deferred to M3; dev measurement recorded in docs/CALIBRATION.md.

## M6

- Cost calculator outputs CSV + SVG; break-even computed by linear interpolation between volume points.
- Rates left null in pricing.json per PRD.
