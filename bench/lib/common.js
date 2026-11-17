// Shared helpers for all k6 scenarios.
// Every setting can be overridden with `-e NAME=value` (see README.md).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// ---------- Settings ----------
export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
export const ENV_NAME = __ENV.ENV_NAME || 'local'; // label for the environment, e.g. vps or azure-aca
export const RESULTS_DIR = __ENV.RESULTS_DIR || 'results';
export const MAX_PRODUCT_ID = Number(__ENV.MAX_PRODUCT_ID || 1000); // seeded products have ids 1..N
export const SAMPLER_ENABLED = (__ENV.SAMPLER || '1') !== '0';

// Percentiles shown in the end-of-test summary.
export const summaryTrendStats = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];

// ---------- Metrics ----------
export const latencyAll = new Trend('latency_all', true);
export const serverTime = new Trend('server_time_ms', true); // from the Server-Timing header
export const latencyByKind = {
  products_list: new Trend('latency_products_list', true),
  products_detail: new Trend('latency_products_detail', true),
  orders_create: new Trend('latency_orders_create', true),
  report: new Trend('latency_report', true),
};
export const errorRate = new Rate('error_rate');
export const requestsTotal = new Counter('requests_total'); // tagged with the serving instance id

// ---------- Small utilities ----------
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Sleep for roughly `seconds` (+/- 50%) so virtual users do not move in lockstep.
export function think(seconds) {
  if (seconds > 0) sleep(seconds * (0.5 + Math.random()));
}

function parseServerTiming(header) {
  if (!header) return null;
  const m = /dur=([0-9.]+)/.exec(header);
  return m ? Number(m[1]) : null;
}

// Records latency, errors and instance id for one response of a known kind.
function record(kind, res, expectedStatus, validateBody) {
  const ok = check(res, {
    [`${kind}: status ${expectedStatus}`]: (r) => r.status === expectedStatus,
    [`${kind}: body valid`]: (r) => {
      try {
        return validateBody(r.json());
      } catch (e) {
        return false;
      }
    },
  });
  latencyAll.add(res.timings.duration);
  latencyByKind[kind].add(res.timings.duration);
  errorRate.add(!ok);
  requestsTotal.add(1, { instance: res.headers['X-Instance-Id'] || 'unknown' });
  const st = parseServerTiming(res.headers['Server-Timing']);
  if (st !== null) serverTime.add(st);
  return ok;
}

// ---------- Requests (one function per API call in the PRD) ----------
export function listProducts() {
  const offset = randInt(0, Math.max(0, MAX_PRODUCT_ID - 20));
  const res = http.get(`${BASE_URL}/api/products?limit=20&offset=${offset}`, {
    tags: { name: 'GET /api/products' },
  });
  return record('products_list', res, 200, (b) => Array.isArray(b.items) && b.items.length > 0);
}

export function getProduct() {
  const id = randInt(1, MAX_PRODUCT_ID);
  const res = http.get(`${BASE_URL}/api/products/${id}`, {
    tags: { name: 'GET /api/products/:id' },
  });
  return record('products_detail', res, 200, (b) => b.id === id);
}

export function createOrder() {
  const count = randInt(1, 3);
  const ids = new Set();
  while (ids.size < count) ids.add(randInt(1, MAX_PRODUCT_ID));
  const body = {
    customerName: 'Load Test',
    // Synthetic address only. Never use real personal data in load tests.
    customerEmail: `user+${__VU}.${__ITER}@example.com`,
    items: Array.from(ids).map((productId) => ({ productId, quantity: randInt(1, 3) })),
  };
  const res = http.post(`${BASE_URL}/api/orders`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /api/orders' },
  });
  return record('orders_create', res, 201, (b) => b.id !== undefined && typeof b.totalCents === 'number');
}

export function getReport(complexity) {
  const res = http.get(`${BASE_URL}/api/report?complexity=${complexity}`, {
    tags: { name: 'GET /api/report' },
    timeout: '120s',
  });
  return record('report', res, 200, (b) => b.cpu && typeof b.cpu.iterations === 'number');
}

// ---------- Instance sampler ----------
// Polls /health once per second and prints one line per sample:
//   SAMPLER,<iso time>,<instance id>,<status>,<ms>
// Use it to count instances over time. Re-export it from a scenario file with:
//   export { sampler } from './lib/common.js';
export function sampler() {
  const res = http.get(`${BASE_URL}/health`, { tags: { name: 'GET /health', sampler: 'true' } });
  console.log(
    `SAMPLER,${new Date().toISOString()},${res.headers['X-Instance-Id'] || ''},${res.status},${Math.round(res.timings.duration)}`
  );
}

// Returns {sampler: {...}} to spread into `scenarios`, or {} when SAMPLER=0.
export function samplerScenarios(durationSeconds) {
  if (!SAMPLER_ENABLED) return {};
  return {
    sampler: {
      executor: 'constant-arrival-rate',
      exec: 'sampler',
      rate: 1,
      timeUnit: '1s',
      duration: `${durationSeconds}s`,
      preAllocatedVUs: 1,
      maxVUs: 2,
    },
  };
}

// ---------- End-of-test summary ----------
const DEFAULT_METRICS = [
  'latency_all',
  'latency_products_list',
  'latency_products_detail',
  'latency_orders_create',
  'latency_report',
  'server_time_ms',
];

function values(data, name) {
  const m = data.metrics[name];
  if (!m) return null;
  return m.values || m;
}

function fmt(x) {
  return typeof x === 'number' && isFinite(x) ? x.toFixed(2) : '';
}

// Builds stdout text, a full JSON dump and a CSV, written to
//   <RESULTS_DIR>/<ENV_NAME>/<scenario>/<timestamp>.{json,csv}
export function buildSummary(scenario, data, metricNames) {
  const names = metricNames || DEFAULT_METRICS;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${RESULTS_DIR}/${ENV_NAME}/${scenario}/${ts}`;

  const req = values(data, 'requests_total');
  const err = values(data, 'error_rate');
  const rps = req ? req.rate : null;
  const errRate = err ? err.rate : null;

  const header = 'env,scenario,timestamp,metric,avg_ms,p50_ms,p95_ms,p99_ms,max_ms,rps,error_rate';
  const rows = [];
  const lines = [];
  lines.push('');
  lines.push(`Scenario: ${scenario}   Environment: ${ENV_NAME}   Target: ${BASE_URL}`);
  lines.push('');
  lines.push('metric                       avg      p50      p95      p99      max   (ms)');

  names.forEach((name) => {
    const v = values(data, name);
    if (!v) return;
    const first = rows.length === 0;
    rows.push(
      [
        ENV_NAME,
        scenario,
        ts,
        name,
        fmt(v.avg),
        fmt(v.med),
        fmt(v['p(95)']),
        fmt(v['p(99)']),
        fmt(v.max),
        first ? fmt(rps) : '',
        first ? fmt(errRate) : '',
      ].join(',')
    );
    lines.push(
      `${name.padEnd(26)} ${fmt(v.avg).padStart(8)} ${fmt(v.med).padStart(8)} ${fmt(v['p(95)']).padStart(8)} ${fmt(v['p(99)']).padStart(8)} ${fmt(v.max).padStart(8)}`
    );
  });

  lines.push('');
  if (req) lines.push(`requests: ${req.count}   rate: ${fmt(rps)} req/s`);
  if (err) lines.push(`error rate: ${(errRate * 100).toFixed(2)} %`);
  lines.push(`files: ${base}.json, ${base}.csv`);
  lines.push('');

  return {
    stdout: lines.join('\n'),
    [`${base}.json`]: JSON.stringify(data, null, 2),
    [`${base}.csv`]: [header].concat(rows).join('\n') + '\n',
  };
}
