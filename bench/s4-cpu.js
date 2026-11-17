// S4 cpu: sustained CPU-heavy requests (GET /api/report).
// Default: 10 virtual users for 3 minutes, complexity 3.
import { getReport, think, buildSummary, samplerScenarios, summaryTrendStats } from './lib/common.js';
export { sampler } from './lib/common.js';

const VUS = Number(__ENV.VUS || 10);
const DURATION_S = Number(__ENV.DURATION_S || 180);
const COMPLEXITY = Number(__ENV.COMPLEXITY || 3);
const THINK_TIME_S = Number(__ENV.THINK_TIME_S || 0.2);

export const options = {
  summaryTrendStats,
  scenarios: {
    cpu: { executor: 'constant-vus', vus: VUS, duration: `${DURATION_S}s` },
    ...samplerScenarios(DURATION_S),
  },
};

export default function () {
  getReport(COMPLEXITY);
  think(THINK_TIME_S);
}

export function handleSummary(data) {
  return buildSummary('s4-cpu', data, ['latency_all', 'latency_report', 'server_time_ms']);
}
