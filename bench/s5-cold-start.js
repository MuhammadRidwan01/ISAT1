// S5 cold-start: measure the first request after an idle period.
// Each iteration: wait IDLE_SECONDS, send one request (cold), then one more right away (warm).
// The idle period must be longer than the platform's scale-to-zero cooldown.
// There is NO instance sampler here on purpose: polling /health would keep the app warm.
//
// Per-iteration values are printed as lines starting with COLD_START:
//   COLD_START,<n>,<iso time>,<cold status>,<cold total ms>,<cold ttfb ms>,<warm status>,<warm ms>,<cold instance>,<warm instance>
// run.sh saves the full console output, so you can extract them with: grep COLD_START <logfile>
import http from 'k6/http';
import { sleep, check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, errorRate, buildSummary, summaryTrendStats } from './lib/common.js';

const ITERATIONS = Number(__ENV.ITERATIONS || 10);
const IDLE_SECONDS = Number(__ENV.IDLE_SECONDS || 900);
const SKIP_FIRST_IDLE = (__ENV.SKIP_FIRST_IDLE || '0') === '1';
const maxMinutes = Math.ceil((ITERATIONS * (IDLE_SECONDS + 60)) / 60) + 5;

const coldTotal = new Trend('cold_start_ms', true);
const coldTtfb = new Trend('cold_start_ttfb_ms', true);
const warmFollowup = new Trend('warm_followup_ms', true);

export const options = {
  summaryTrendStats,
  scenarios: {
    cold_start: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: ITERATIONS,
      maxDuration: `${maxMinutes}m`,
    },
  },
};

export default function () {
  if (!(SKIP_FIRST_IDLE && __ITER === 0)) sleep(IDLE_SECONDS);

  const url = `${BASE_URL}/api/products?limit=1`;
  const params = { timeout: '120s', tags: { name: 'GET /api/products (cold-start probe)' } };

  const cold = http.get(url, params);
  const warm = http.get(url, params);

  coldTotal.add(cold.timings.duration);
  coldTtfb.add(cold.timings.waiting);
  warmFollowup.add(warm.timings.duration);

  const ok = check(cold, { 'cold: status 200': (r) => r.status === 200 }) &&
    check(warm, { 'warm: status 200': (r) => r.status === 200 });
  errorRate.add(!ok);

  console.log(
    `COLD_START,${__ITER + 1},${new Date().toISOString()},${cold.status},${cold.timings.duration.toFixed(1)},${cold.timings.waiting.toFixed(1)},${warm.status},${warm.timings.duration.toFixed(1)},${cold.headers['X-Instance-Id'] || ''},${warm.headers['X-Instance-Id'] || ''}`
  );
}

export function handleSummary(data) {
  return buildSummary('s5-cold-start', data, ['cold_start_ms', 'cold_start_ttfb_ms', 'warm_followup_ms']);
}
