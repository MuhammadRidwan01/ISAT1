#!/usr/bin/env bash

ACA_URL="https://catalog-orders.wonderfulriver-e99086d4.malaysiawest.azurecontainerapps.io"
VM_URL="http://85.211.182.199"

DRY="${DRY_RUN:-0}"
if [ "$DRY" = "1" ]; then
  ITERS=1
  IDLE_ARGS=(-e IDLE_SECONDS=5 -e SKIP_FIRST_IDLE=1)
  SLEEP_SEC=5
  PREFIX="dryrun-"
  DO_FINAL=0
else
  ITERS=5
  IDLE_ARGS=()
  SLEEP_SEC=120
  PREFIX=""
  DO_FINAL=1
fi

STATUS_DIR="$(mktemp -d /tmp/opencode/s5fix.XXXXXX)"

run_one() {
  local label="$1"
  local url="$2"
  shift 2
  local full="${PREFIX}${label}"
  local start end rc
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "START $full"
  ./bench/run.sh s5 "$full" "$url" "$@"
  rc=$?
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "$full|$start|$end|$rc" > "$STATUS_DIR/$full.status"
  echo "END $full rc=$rc"
}

# Preflight
for pair in "azure-vm-health $VM_URL" "azure-aca-health $ACA_URL"; do
  set -- $pair
  lbl="$1"; url="$2"
  code="$(curl -s -o /dev/null -w '%{http_code}' "${url}/health")"
  if [ "$code" != "200" ]; then
    echo "PREFLIGHT FAIL $lbl /health -> $code"
    exit 1
  fi
  echo "PREFLIGHT OK $lbl /health -> $code"
done

if [ ! -f analysis/runlog-s5fix.csv ]; then
  echo "label,start_utc,end_utc,exit_code,error_rate" > analysis/runlog-s5fix.csv
fi

echo "PHASE A START"
run_one azure-vm-health "$VM_URL" -e ITERATIONS="$ITERS" -e PROBE_PATH=/health "${IDLE_ARGS[@]}" &
run_one azure-aca-health "$ACA_URL" -e ITERATIONS="$ITERS" -e PROBE_PATH=/health "${IDLE_ARGS[@]}" &
wait
echo "PHASE A DONE"

echo "SLEEP ${SLEEP_SEC}s"
sleep "$SLEEP_SEC"

echo "PHASE B START"
run_one azure-vm-db "$VM_URL" -e ITERATIONS="$ITERS" "${IDLE_ARGS[@]}" &
run_one azure-aca-db "$ACA_URL" -e ITERATIONS="$ITERS" "${IDLE_ARGS[@]}" &
wait
echo "PHASE B DONE"

labels=(azure-vm-health azure-aca-health azure-vm-db azure-aca-db)
for l in "${labels[@]}"; do
  full="${PREFIX}${l}"
  IFS='|' read -r lbl start end rc < "$STATUS_DIR/$full.status"
  csv="$(ls -t "bench/results/$full/s5-cold-start/"*.csv 2>/dev/null | head -n 1)"
  er=""
  if [ -n "$csv" ] && [ -f "$csv" ]; then
    er="$(awk -F, 'NR==2 {print $11}' "$csv")"
  fi
  echo "$full,$start,$end,$rc,$er" >> analysis/runlog-s5fix.csv
done

for l in "${labels[@]}"; do
  full="${PREFIX}${l}"
  logf="$(ls -t "bench/results/$full/s5-cold-start/"*.log 2>/dev/null | head -n 1)"
  if [ -n "$logf" ] && [ -f "$logf" ]; then
    grep -o 'COLD_START,[^"]*' "$logf" > "analysis/cold-${full}.csv"
  fi
done

if [ "$DO_FINAL" = "1" ]; then
  echo "DONE-S5FIX"
  : > analysis/DONE-S5FIX
  tar -czf analysis/results-s5fix.tgz \
    bench/results/azure-*-health \
    bench/results/azure-*-db \
    analysis/cold-*.csv \
    analysis/runlog-s5fix.csv \
    analysis/run-s5-fix.log
  echo "TARBALL CREATED"
fi

rm -rf "$STATUS_DIR"
echo "ALL DONE"
