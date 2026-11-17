# PRD: Catalog and Orders Benchmark App

Version 1.0 - 16 November 2026

Owner: Rian (Muhammad Ridwan). Audience: AI coding agent.

## 1. Purpose

This application is the test subject for a university paper (Information Systems Architecture, paper 2) titled Serverless and Traditional Web Application Deployment: Cost and Performance Compared.

The app is built once as a single Docker image. That image is then deployed two ways and load-tested:

1. Traditional: one container on a fixed-size VPS (fixed monthly price, fixed capacity, manual scaling).
2. Serverless: the same image on Azure Container Apps, Consumption plan, with scale-to-zero and automatic scale-out (billed per second of use).

The feature set is not what matters. What matters is that the app is identical in both environments, stateless, deterministic and easy to measure. Do not add features that are not in this document.

## 2. Working agreement for the agent

- Follow this PRD literally. If something is ambiguous and blocks progress, make the simplest reasonable choice, record it in docs/DECISIONS.md, and continue.
- Do not deploy anything or create cloud resources yourself. Deliver code, scripts and docs. The owner runs the deployments.
- Never commit secrets. Provide .env.example only.
- Keep the code simple and readable. No unnecessary abstractions or dependencies.
- Work in the milestone order in section 15 and report after each milestone.

## 3. Goals and non-goals

Goals:

- One image, zero code differences between environments. Only environment variables differ.
- Three workload types: read-heavy, write, and CPU-heavy.
- Built-in observability for the experiment: instance identity, startup time, per-request timing.
- Reproducible load tests and a transparent cost model.

Non-goals: authentication, payments, admin UI, email, image uploads, search, i18n, rate limiting, Kubernetes, Azure Functions, VPS autoscaling, caching layers.

## 4. Technology and constraints

Default stack (the owner may override it; if so, keep every requirement in this document):

- Runtime: Node.js 22 LTS with TypeScript in strict mode
- HTTP framework: Fastify
- Database access: node-postgres (pg) with plain SQL migrations, parameterized queries only
- Validation: zod
- Logging: pino (JSON to stdout)
- Tests: vitest
- Frontend: static HTML, CSS and vanilla JavaScript, no framework and no build step, served by the same app
- Load testing: k6

Database: PostgreSQL, a single hosted instance shared by both deployments (any managed provider with a free tier, reachable from both the VPS and Azure). The database is excluded from the cost comparison so that only compute is compared. The connection string comes from DATABASE\_URL.

Container rules:

- Multi-stage Dockerfile, non-root user, listens on 0.0.0.0 at PORT (default 8080), image size target under 200 MB.
- Graceful shutdown on SIGTERM: finish in-flight requests, close the DB pool, exit within 10 seconds.
- No local state: no files written, no in-memory caching of data, no sticky sessions. Each instance must do the same work for the same request.
- Reference resources per instance in both environments: 1 vCPU and 2 GiB RAM (configurable by the owner).

Configuration (environment variables):

- PORT (default 8080)
- DATABASE\_URL (required)
- DB\_POOL\_MAX (default 5; keep it low because many serverless replicas share one database)
- DB\_SSL (default true)
- INSTANCE\_ID (optional, defaults to the hostname)
- LOG\_LEVEL (default info)
- APP\_VERSION (optional, shown in /health)

## 5. Data model

products: id (serial primary key), sku (unique), name, description, category, price\_cents (integer), stock (integer, informational only), created\_at. Index on category.

orders: id (serial primary key), customer\_name, customer\_email, total\_cents, status (always 'confirmed'), is\_seed (boolean, default false), created\_at. Index on created\_at.

order\_items: id (serial primary key), order\_id (foreign key), product\_id (foreign key), quantity, unit\_price\_cents.

Seed script (npm run seed): deterministic (fixed random seed), idempotent, creates 1,000 products across 8 categories and 5,000 historical orders (is\_seed = true) spread over the last 90 days with 1 to 5 items each.

Reset script (npm run db:reset-orders): deletes orders where is\_seed = false, so every benchmark run can start from the same state.

## 6. API

All responses are JSON. Error format for every error: { error: { code, message, details? } } with the correct HTTP status. Request body limit is 100 KB. No CORS (same origin).

- GET /health - cheap, no database. Returns { status: 'ok', instanceId, startedAt, uptimeSeconds, version }.
- GET /health/db - runs SELECT 1. Returns the same fields plus db: 'ok' or 'error' (HTTP 503 on error).
- GET /api/categories - returns the list of categories.
- GET /api/products - read workload. Query: limit (1-100, default 20), offset (default 0), category (optional). Returns { items: \[{ id, sku, name, description, category, priceCents, stock }\], total, limit, offset }.
- GET /api/products/:id - returns one product, or 404.
- POST /api/orders - write workload. Body: { customerName (1-100 chars), customerEmail (valid email), items: \[{ productId, quantity (1-10) }\] } with 1 to 10 items and no duplicate productId. In one transaction: load current prices from the database, compute totals on the server (ignore any client-sent price), insert the order and its items. Stock is NOT decremented, so benchmarks never run out of stock. Returns 201 { id, status, totalCents, createdAt, items }. Returns 400 for validation errors and 422 if a productId does not exist.
- GET /api/orders/:id - returns the order with its items, or 404.
- GET /api/report?complexity=N - CPU-heavy workload, see section 7.

## 7. CPU-heavy endpoint

GET /api/report accepts complexity (integer 1-10, default 3). It does two things:

1. Runs three aggregate SQL queries on the seeded data: revenue per category, top 10 products by revenue, and revenue per day for the last 30 days.
2. Runs a synthetic CPU workload: complexity x 200,000 iterations of SHA-256 over a fixed 1 KB buffer, executed synchronously on the main thread. This is intentional: it models a CPU-bound request.

Response: { aggregates: {...}, cpu: { iterations, durationMs, checksum } }. The checksum prevents the work from being optimized away.

Calibration: the agent must measure the duration at complexity 1, 3 and 10 locally in a container limited to 1 vCPU, and record the results in docs/CALIBRATION.md. The target is roughly 200 to 400 ms at complexity 3. Adjust the per-level iteration count if needed and document the change.

## 8. Frontend

One page, index.html, served at /. Plain, neutral styling: system font, white background, thin borders, no gradients, no solid saturated header block, no emojis, no icon libraries.

- Product list with category filter and pagination (uses /api/products and /api/categories).
- Cart held in browser memory only (no browser storage).
- Checkout form (name and email) that posts to /api/orders and shows a confirmation with the order id and total.
- Diagnostics panel showing, for the last request: client-measured time, X-Instance-Id and the Server-Timing value. A button runs /api/report and shows the same data.
- Total page weight under 100 KB. No third-party requests.

## 9. Observability

- Every response includes X-Instance-Id and Server-Timing: app;dur=\<milliseconds>.
- One JSON log line per request: timestamp, method, path, status, durationMs, instanceId.
- One startup log line when the server begins listening: bootMs (time from process start to listening) and instanceId. It is used to estimate cold start.
- No external APM or tracing dependencies.

## 10. Deployment deliverables

10.1 Local. docker-compose.yml with the app and a local Postgres for development, plus npm scripts or a Makefile for build, test, seed and run.

10.2 Traditional (VPS), folder deploy/vps/. A docker-compose.yml that runs the single app container with restart: unless-stopped, an optional Nginx reverse proxy config, and a README with steps for Ubuntu 24.04 (install Docker, pull the image, set env vars, run). Capacity is intentionally fixed: one instance, no autoscaling. The README includes a table for the owner to record VPS provider, region, vCPU, RAM and monthly price.

10.3 Serverless, folder deploy/azure/. A deploy.sh using the Azure CLI that creates a resource group, a Container Apps environment (Consumption), and a container app that:

- pulls the image from a registry (Docker Hub or any other registry)
- exposes external ingress on target port 8080
- uses 1 vCPU and 2 Gi memory
- sets min replicas 0 and max replicas 10
- adds an HTTP scaling rule at 20 concurrent requests per replica
- stores DATABASE\_URL as a secret

All of these values are variables at the top of the script. Also provide destroy.sh (deletes the resource group) and a README with cost-safety steps: set a budget alert, run the tests, then delete everything.

10.4 A variable MIN\_REPLICAS lets the owner run an extra scenario with min replicas 1 (always warm). The default stays 0.

10.5 Optional: a GitHub Actions workflow that builds and pushes the image on a version tag. The README must tell the owner to record the image digest in the results, so both environments are provably running the same image.

## 11. Benchmark suite (folder bench/)

k6 scripts configured by BASE\_URL. Use synthetic emails only (user+N@example.com); never use real personal data.

- S1 steady-read: 50 virtual users for 5 minutes, a mix of GET /api/products (random offset) and GET /api/products/:id.
- S2 write: 20 virtual users for 3 minutes, POST /api/orders with random products.
- S3 spike: ramp from 0 to 300 virtual users in 30 seconds, hold for 2 minutes, ramp down in 30 seconds. Traffic mix: 80% reads, 15% writes, 5% report.
- S4 cpu: 10 virtual users for 3 minutes on GET /api/report?complexity=3.
- S5 cold-start: after a configurable idle period (default 15 minutes, must exceed the scale-to-zero cooldown), send one request to GET /api/products?limit=1 and record the time. Repeat 10 times and write a CSV.
- Instance sampler: a small script that polls /health once per second during any scenario and logs the timestamp and instanceId to a CSV, to count instances over time.

All durations, user counts and thresholds are constants at the top of each script so the owner can tune them to the credit budget.

Outputs: raw k6 JSON saved to bench/results/\<environment>/\<scenario>/\<timestamp>.json. A script bench/summarize produces one CSV with p50, p95, p99, average, max, requests per second and error rate for each run.

Method rules (put them in bench/README.md):

- Run from the same machine and network for both environments, and record that location.
- Run each scenario 3 times and report the median.
- Run both environments at similar times of day.
- Reset orders with npm run db:reset-orders before each run.
- Do not discard cold-start effects in S3.

## 12. Cost model (folder cost/)

- pricing.json: rates are left null for the owner to fill from the official Azure pricing page and the VPS provider at the time of testing. Include the Consumption free grant as defaults to verify: 180,000 vCPU-seconds, 360,000 GiB-seconds and 2,000,000 requests per month.
- A script that takes monthly request volumes (default 10,000; 100,000; 1,000,000; 10,000,000), the average service time per request (from benchmark results), the average concurrency per replica (default 1, the conservative upper bound) and the instance spec, then outputs the monthly cost of each option.
  - VPS monthly cost = fixed monthly price.
  - Serverless monthly cost = max(0, vCPU-seconds - free grant) x vCPU rate + max(0, GiB-seconds - free grant) x memory rate + request charge above the free grant, where vCPU-seconds = requests x service time x vCPU / concurrency (GiB-seconds likewise with memory).
- Output: a CSV and a line chart (monthly cost versus requests per month) showing the break-even point. All assumptions are printed with the output.
- Scope: compute only. Database cost and network egress are excluded, and the output says so.
- docs/COST\_VALIDATION.md: a template for comparing the model against the actual Azure Cost Analysis figures after a test run.

## 13. Quality requirements

- Unit tests for request validation and order total calculation. Integration tests for every endpoint against a local Postgres.
- TypeScript strict mode, lint and format configured, no warnings.
- README.md with quick start, environment variable table, endpoint list and a Mermaid diagram of the two deployment topologies.
- docs/DECISIONS.md listing every assumption or deviation from this PRD.

## 14. Repository layout

```
.
|-- src/
|   |-- server.ts
|   |-- routes/
|   |-- db/            (migrations, seed)
|   `-- lib/
|-- public/            (index.html, app.js, style.css)
|-- tests/
|-- bench/             (k6 scripts, sampler, summarize, results/)
|-- cost/              (pricing.json, calculator)
|-- deploy/
|   |-- vps/
|   `-- azure/
|-- docs/              (DECISIONS.md, CALIBRATION.md, COST_VALIDATION.md)
|-- Dockerfile
|-- docker-compose.yml
`-- README.md
```

## 15. Milestones

1. M1 App core: schema, migrations, seed, all endpoints, tests. Done when every endpoint passes its integration tests locally.
2. M2 Frontend and observability: the page, headers, logs, health endpoints.
3. M3 Container: Dockerfile, compose, CPU calibration. Done when docker compose up works end to end and graceful shutdown is verified.
4. M4 Deployment kits for the VPS and for Azure Container Apps.
5. M5 Benchmark suite and summarize script.
6. M6 Cost model and documentation.

## 16. Acceptance criteria

1. docker compose up starts the app and the database, the seed completes, the UI lists products and an order can be placed.
2. The identical image runs on the VPS and on Azure with only environment variables different.
3. Every endpoint matches section 6, including validation and the error format.
4. /api/report is CPU-bound and calibrated, with results documented.
5. Each benchmark scenario runs with one command and produces a result file and a summary row.
6. The cost script runs with the pricing file and prints the break-even point.
7. No secrets in the repository, and the image runs as a non-root user.

## 17. Assumptions and open items for the owner

- The default stack is Node.js with TypeScript. Change it before starting if another stack is preferred.
- The hosted PostgreSQL provider and region are not chosen yet. Use regions for the database, the VPS and Azure that are as close together as possible (for example Southeast Asia) to avoid network skew.
- The VPS provider and specification are not chosen yet.
- Whether Azure Container Apps can be created under the owner's Azure for Students account is not verified. If it cannot, the fallback is Azure Functions, which would need a separate PRD.
- Test sizes may be reduced to fit the free credit.
