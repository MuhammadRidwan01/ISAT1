#!/usr/bin/env bash
# Merge every per-run CSV under results/ into results/all.csv (one header, one row per metric per run).
set -euo pipefail
cd "$(dirname "$0")"
RESULTS_DIR="${RESULTS_DIR:-results}"
OUT="${RESULTS_DIR}/all.csv"
echo "env,scenario,timestamp,metric,avg_ms,p50_ms,p95_ms,p99_ms,max_ms,rps,error_rate" > "$OUT"
find "$RESULTS_DIR" -mindepth 3 -name '*.csv' ! -name 'all.csv' | sort | while read -r f; do
  tail -n +2 "$f" >> "$OUT"
done
echo "Wrote $OUT ($(($(wc -l < "$OUT") - 1)) rows)"
