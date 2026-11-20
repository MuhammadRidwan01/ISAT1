import fs from "node:fs";
import path from "node:path";

const __dir = path.dirname(new URL(import.meta.url).pathname);
const resultsRoot = path.resolve(__dir, "..", "bench", "results");
const runlogPath = path.join(__dir, "runlog.csv");

function toMinute(ts) {
  const m = String(ts).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})[-:](\d{2})/);
  if (m) return `${m[1]}T${m[2]}:${m[3]}`;
  return String(ts).slice(0, 16);
}

function median(arr) {
  const nums = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

function fmt(x, digits = 2) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "";
  return x.toFixed(digits);
}

function statCell(arr, digits = 2) {
  const m = median(arr);
  if (arr.length <= 1) return fmt(m, digits);
  const finite = arr.filter((x) => Number.isFinite(x));
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  return `${fmt(m, digits)} [${fmt(lo, digits)}..${fmt(hi, digits)}]`;
}

// ---- runlog parsing (s3 peak mapping) ----
const s3PeakByMinute = new Map();
const runlogLines = fs.readFileSync(runlogPath, "utf8").trim().split(/\r?\n/);
for (let i = 1; i < runlogLines.length; i++) {
  const cols = runlogLines[i].split(",");
  if (cols.length < 8) continue;
  if (cols[1] !== "s3") continue;
  const env = cols[2];
  const rep = cols[3];
  const peak = cols[4];
  const endUtc = cols[6];
  const minute = toMinute(endUtc);
  s3PeakByMinute.set(`${env}|${minute}`, { peak, rep });
}

// ---- data stores ----
const other = {};
function ensureOther(env, scenario, metric) {
  other[env] = other[env] || {};
  other[env][scenario] = other[env][scenario] || {};
  other[env][scenario][metric] = other[env][scenario][metric] || {
    p50: [], p95: [], p99: [], max: [], rps: [], error_rate: [],
  };
  return other[env][scenario][metric];
}

const s3 = {};
function ensureS3(env, peak, metric) {
  s3[env] = s3[env] || {};
  s3[env][peak] = s3[env][peak] || {};
  s3[env][peak][metric] = s3[env][peak][metric] || {
    p50: [], p95: [], p99: [], max: [], rps: [], error_rate: [],
  };
  return s3[env][peak][metric];
}

const s3Runs = [];

const envDirs = fs.readdirSync(resultsRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const env of envDirs) {
  if (env === "warmup" || env.startsWith("dryrun-")) continue;
  const envPath = path.join(resultsRoot, env);
  const scenDirs = fs.readdirSync(envPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const scenario of scenDirs) {
    const scenPath = path.join(envPath, scenario);
    const files = fs.readdirSync(scenPath).filter((f) => f.endsWith(".csv"));

    const isS3 = scenario === "s3-spike";

    for (const file of files) {
      const content = fs.readFileSync(path.join(scenPath, file), "utf8");
      const lines = content.trim().split(/\r?\n/);
      if (lines.length < 2) continue;

      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 11) continue;
        const metric = cols[3];
        if (!metric) continue;
        rows.push({ cols, metric });
      }
      if (rows.length === 0) continue;

      if (isS3) {
        const ts = rows[0].cols[2];
        const minute = toMinute(ts);
        let info = s3PeakByMinute.get(`${env}|${minute}`);
        if (!info) {
          const m2 = file.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
          if (m2) info = s3PeakByMinute.get(`${env}|${toMinute(m2[1])}`);
          if (!info) continue;
        }
        const { peak, rep } = info;
        if (!peak) continue;

        const runMetrics = {};
        for (const r of rows) {
          const cols = r.cols;
          const metric = r.metric;
          const rec = ensureS3(env, peak, metric);
          const p50 = cols[5] === "" ? NaN : Number(cols[5]);
          const p95 = cols[6] === "" ? NaN : Number(cols[6]);
          const p99 = cols[7] === "" ? NaN : Number(cols[7]);
          const mx = cols[8] === "" ? NaN : Number(cols[8]);
          const rps = cols[9] === "" ? NaN : Number(cols[9]);
          const er = cols[10] === "" ? NaN : Number(cols[10]);
          if (Number.isFinite(p50)) rec.p50.push(p50);
          if (Number.isFinite(p95)) rec.p95.push(p95);
          if (Number.isFinite(p99)) rec.p99.push(p99);
          if (Number.isFinite(mx)) rec.max.push(mx);
          if (Number.isFinite(rps)) rec.rps.push(rps);
          if (Number.isFinite(er)) rec.error_rate.push(er);

          runMetrics[metric] = { p50, p95, p99, max: mx, rps, error_rate: er };
        }
        s3Runs.push({ env, peak, rep, file, metrics: runMetrics });
      } else {
        for (const r of rows) {
          const cols = r.cols;
          const metric = r.metric;
          const rec = ensureOther(env, scenario, metric);
          const p50 = cols[5] === "" ? NaN : Number(cols[5]);
          const p95 = cols[6] === "" ? NaN : Number(cols[6]);
          const p99 = cols[7] === "" ? NaN : Number(cols[7]);
          const mx = cols[8] === "" ? NaN : Number(cols[8]);
          const rps = cols[9] === "" ? NaN : Number(cols[9]);
          const er = cols[10] === "" ? NaN : Number(cols[10]);
          if (Number.isFinite(p50)) rec.p50.push(p50);
          if (Number.isFinite(p95)) rec.p95.push(p95);
          if (Number.isFinite(p99)) rec.p99.push(p99);
          if (Number.isFinite(mx)) rec.max.push(mx);
          if (Number.isFinite(rps)) rec.rps.push(rps);
          if (Number.isFinite(er)) rec.error_rate.push(er);
        }
      }
    }
  }
}

const envs = [...new Set(
  Object.keys(other).concat(Object.keys(s3)),
)].sort();

// ---- output: s1/s2/s4/s5 (and any non-s3) ----
const otherScenarios = [...new Set(
  Object.values(other).flatMap((e) => Object.keys(e)),
)].sort();

for (const scenario of otherScenarios) {
  for (const env of envs) {
    if (!other[env] || !other[env][scenario]) continue;
    const metrics = Object.keys(other[env][scenario]).sort();
    console.log(`### ${scenario} — ${env}`);
    console.log("");
    console.log("| metric | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | rps | error_rate |");
    console.log("|---|---:|---:|---:|---:|---:|---:|");
    for (const metric of metrics) {
      const rec = other[env][scenario][metric];
      console.log(
        `| ${metric} | ${statCell(rec.p50)} | ${statCell(rec.p95)} | ${statCell(rec.p99)} | ${statCell(rec.max)} | ${statCell(rec.rps)} | ${statCell(rec.error_rate, 4)} |`,
      );
    }
    console.log("");
  }
}

// ---- S3 output ----
console.log("### S3 spike — ladder (latency_all)");
console.log("");
console.log("| peak VUs | env | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | rps | error_rate |");
console.log("|---:|---|---:|---:|---:|---:|---:|---:|");
for (const level of ["50", "150", "300"]) {
  for (const env of envs) {
    if (!s3[env] || !s3[env][level] || !s3[env][level].latency_all) continue;
    const rec = s3[env][level].latency_all;
    console.log(
      `| ${level} | ${env} | ${statCell(rec.p50)} | ${statCell(rec.p95)} | ${statCell(rec.p99)} | ${statCell(rec.max)} | ${statCell(rec.rps)} | ${statCell(rec.error_rate, 4)} |`,
    );
  }
}
console.log("");

console.log("### S3 spike — level 300 (per metric)");
console.log("");
const level300Metrics = [
  "latency_products_list",
  "latency_products_detail",
  "latency_orders_create",
  "latency_report",
  "server_time_ms",
];
for (const env of envs) {
  if (!s3[env] || !s3[env]["300"]) continue;
  console.log(`#### ${env} (peak 300)`);
  console.log("");
  console.log("| metric | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | rps | error_rate |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const metric of level300Metrics) {
    const rec = s3[env]["300"][metric];
    if (!rec) continue;
    console.log(
      `| ${metric} | ${statCell(rec.p50)} | ${statCell(rec.p95)} | ${statCell(rec.p99)} | ${statCell(rec.max)} | ${statCell(rec.rps)} | ${statCell(rec.error_rate, 4)} |`,
    );
  }
  console.log("");
}

console.log("### S3 spike — level 300 (per run, latency_all)");
console.log("");
console.log("| env | rep | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | rps | error_rate |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
const runs300 = s3Runs
  .filter((r) => r.peak === "300")
  .sort((a, b) => (a.env + a.rep).localeCompare(b.env + b.rep));
for (const r of runs300) {
  const m = r.metrics.latency_all || {};
  console.log(
    `| ${r.env} | ${r.rep} | ${fmt(m.p50)} | ${fmt(m.p95)} | ${fmt(m.p99)} | ${fmt(m.max)} | ${fmt(m.rps)} | ${fmt(m.error_rate, 4)} |`,
  );
}
console.log("");
