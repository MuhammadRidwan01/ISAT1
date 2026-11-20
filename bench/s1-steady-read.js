// S1 steady-read: constant load of read requests (list + detail).
// Default: 50 virtual users for 5 minutes.
import {
  listProducts,
  getProduct,
  think,
  buildSummary,
  samplerScenarios,
  summaryTrendStats,
} from "./lib/common.js";
export { sampler } from "./lib/common.js";

const VUS = Number(__ENV.VUS || 50);
const DURATION_S = Number(__ENV.DURATION_S || 300);
const THINK_TIME_S = Number(__ENV.THINK_TIME_S || 0.5);
const LIST_SHARE = Number(__ENV.LIST_SHARE || 0.7); // 70% list, 30% detail

export const options = {
  summaryTrendStats,
  scenarios: {
    steady_read: {
      executor: "constant-vus",
      vus: VUS,
      duration: `${DURATION_S}s`,
    },
    ...samplerScenarios(DURATION_S),
  },
};

export default function () {
  if (Math.random() < LIST_SHARE) listProducts();
  else getProduct();
  think(THINK_TIME_S);
}

export function handleSummary(data) {
  return buildSummary("s1-steady-read", data);
}
