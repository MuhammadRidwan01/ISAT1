#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const pricingPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "pricing.json",
);
const pricing = JSON.parse(fs.readFileSync(pricingPath, "utf8"));

const volumes = [10000, 100000, 1000000, 10000000];
const serviceTimeSec = Number(process.argv[2] || 0.3);
const concurrency = Number(process.argv[3] || 1);
const vcpu = pricing.instanceSpec.vcpu;
const mem = pricing.instanceSpec.memoryGiB;

const vpsPrice = pricing.vps.monthlyPrice;
const vcpuRate = pricing.serverless.vcpuRatePerSecond;
const memRate = pricing.serverless.memoryRatePerGiBSecond;
const reqRate = pricing.serverless.requestRatePerMillion;
const free = pricing.serverless.freeGrant;

function serverlessCost(reqs) {
  if (vcpuRate === null || memRate === null || reqRate === null) return null;
  const vcpuSeconds = (reqs * serviceTimeSec * vcpu) / concurrency;
  const gibSeconds = (reqs * serviceTimeSec * mem) / concurrency;
  const vcpuCharge = Math.max(0, vcpuSeconds - free.vcpuSeconds) * vcpuRate;
  const memCharge = Math.max(0, gibSeconds - free.gibSeconds) * memRate;
  const reqCharge = Math.max(0, reqs - free.requests) * (reqRate / 1000000);
  return vcpuCharge + memCharge + reqCharge;
}

const rows = ["requests_per_month,vps_monthly,serverless_monthly"];
const points = [];
for (const r of volumes) {
  const sc = serverlessCost(r);
  rows.push(
    `${r},${vpsPrice === null ? "" : vpsPrice},${sc === null ? "" : sc.toFixed(4)}`,
  );
  points.push({ r, sc });
}

const outDir = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "results",
);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "cost.csv"), rows.join("\n") + "\n");

// Break-even: find crossing where serverless == vps (linear between points)
let breakEven = null;
if (vpsPrice !== null && vcpuRate !== null) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    const ca = serverlessCost(a.r),
      cb = serverlessCost(b.r);
    if (ca === null || cb === null) continue;
    if ((ca - vpsPrice) * (cb - vpsPrice) <= 0) {
      const t = (vpsPrice - ca) / (cb - ca);
      breakEven = Math.round(a.r + t * (b.r - a.r));
      break;
    }
  }
}

// SVG chart
const W = 600,
  H = 400,
  pad = 50;
const xs = volumes;
const ys = points.map((p) => (p.sc === null ? 0 : p.sc));
const maxY = Math.max(vpsPrice || 0, ...ys, 1);
function sx(r) {
  return (
    pad +
    ((Math.log10(r) - Math.log10(xs[0])) /
      (Math.log10(xs[xs.length - 1]) - Math.log10(xs[0]))) *
      (W - 2 * pad)
  );
}
function sy(v) {
  return H - pad - (v / maxY) * (H - 2 * pad);
}
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
svg += `<rect width="100%" height="100%" fill="white"/>`;
// axes
svg += `<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="black"/>`;
svg += `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="black"/>`;
// vps line
if (vpsPrice !== null) {
  svg += `<line x1="${pad}" y1="${sy(vpsPrice)}" x2="${W - pad}" y2="${sy(vpsPrice)}" stroke="blue" stroke-dasharray="4,4"/>`;
  svg += `<text x="${W - pad - 60}" y="${sy(vpsPrice) - 5}" fill="blue" font-size="11">VPS ${vpsPrice}</text>`;
}
// serverless polyline
const poly = points
  .map((p) => `${sx(p.r)},${sy(p.sc === null ? 0 : p.sc)}`)
  .join(" ");
svg += `<polyline points="${poly}" fill="none" stroke="red" stroke-width="2"/>`;
for (const p of points) {
  svg += `<circle cx="${sx(p.r)}" cy="${sy(p.sc === null ? 0 : p.sc)}" r="3" fill="red"/>`;
}
svg += `<text x="${pad}" y="${pad - 10}" font-size="12">Monthly cost (USD) vs requests/month</text>`;
svg += `</svg>`;
fs.writeFileSync(path.join(outDir, "cost.svg"), svg);

console.log("Assumptions: compute only; DB and egress excluded.");
console.log(
  "serviceTimeSec=" + serviceTimeSec,
  "concurrency=" + concurrency,
  "vcpu=" + vcpu,
  "memGiB=" + mem,
);
console.log("Free grants: 180000 vCPU-s, 360000 GiB-s, 2000000 requests.");
if (vpsPrice === null || vcpuRate === null) {
  console.log(
    "Rates are null in pricing.json; fill them to get numeric costs and break-even.",
  );
} else {
  console.log("Break-even requests/month:", breakEven);
}
console.log("Output: cost/results/cost.csv, cost/results/cost.svg");
