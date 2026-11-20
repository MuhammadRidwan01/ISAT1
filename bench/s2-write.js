// S2 write: constant load of POST /api/orders.
// Default: 20 virtual users for 3 minutes.
import {
  createOrder,
  think,
  buildSummary,
  samplerScenarios,
  summaryTrendStats,
} from "./lib/common.js";
export { sampler } from "./lib/common.js";

const VUS = Number(__ENV.VUS || 20);
const DURATION_S = Number(__ENV.DURATION_S || 180);
const THINK_TIME_S = Number(__ENV.THINK_TIME_S || 0.5);

export const options = {
  summaryTrendStats,
  scenarios: {
    write: { executor: "constant-vus", vus: VUS, duration: `${DURATION_S}s` },
    ...samplerScenarios(DURATION_S),
  },
};

export default function () {
  createOrder();
  think(THINK_TIME_S);
}

export function handleSummary(data) {
  return buildSummary("s2-write", data);
}
