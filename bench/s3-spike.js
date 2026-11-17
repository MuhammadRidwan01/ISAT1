// S3 spike: sudden burst of traffic with a mixed workload.
// Default: ramp 0 -> 300 virtual users in 30 s, hold 120 s, ramp down in 30 s.
// Mix: 80% reads (half list, half detail), 15% writes, 5% report.
import {
  listProducts,
  getProduct,
  createOrder,
  getReport,
  think,
  buildSummary,
  samplerScenarios,
  summaryTrendStats,
} from './lib/common.js';
export { sampler } from './lib/common.js';

const PEAK_VUS = Number(__ENV.PEAK_VUS || 300);
const RAMP_UP_S = Number(__ENV.RAMP_UP_S || 30);
const HOLD_S = Number(__ENV.HOLD_S || 120);
const RAMP_DOWN_S = Number(__ENV.RAMP_DOWN_S || 30);
const THINK_TIME_S = Number(__ENV.THINK_TIME_S || 0.5);
const REPORT_COMPLEXITY = Number(__ENV.COMPLEXITY || 3);
const TOTAL_S = RAMP_UP_S + HOLD_S + RAMP_DOWN_S;

export const options = {
  summaryTrendStats,
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${RAMP_UP_S}s`, target: PEAK_VUS },
        { duration: `${HOLD_S}s`, target: PEAK_VUS },
        { duration: `${RAMP_DOWN_S}s`, target: 0 },
      ],
      gracefulRampDown: '30s',
      gracefulStop: '60s',
    },
    ...samplerScenarios(TOTAL_S),
  },
};

export default function () {
  const r = Math.random();
  if (r < 0.4) listProducts();
  else if (r < 0.8) getProduct();
  else if (r < 0.95) createOrder();
  else getReport(REPORT_COMPLEXITY);
  think(THINK_TIME_S);
}

export function handleSummary(data) {
  return buildSummary('s3-spike', data);
}
