#!/usr/bin/env bash
# Unattended benchmark driver. No set -e: one failed run does not kill the rest.

DRY="${DRY_RUN:-0}"
if [ "$DRY" = "1" ]; then
  PREFIX="dryrun-"
  SLEEP120=5
  SLEEP600=5
  PEAKS=(5)
  S3_EXTRA=(-e HOLD_S=5 -e RAMP_UP_S=2 -e RAMP_DOWN_S=2)
  S5_EXTRA=(-e ITERATIONS=1 -e IDLE_SECONDS=5 -e SKIP_FIRST_IDLE=1)
  VUS_EXTRA=(-e VUS=2 -e DURATION_S=5)
  DO_SHUTDOWN=0
else
  PREFIX=""
  SLEEP120=120
  SLEEP600=600
  PEAKS=(50 150 300)
  S3_EXTRA=()
  S5_EXTRA=(-e ITERATIONS=5)
  VUS_EXTRA=()
  DO_SHUTDOWN=1
fi

ENV_VM="${PREFIX}azure-vm"
ENV_ACA="${PREFIX}azure-aca"
WARMUP_LABEL="${PREFIX}warmup"
VM_URL="http://85.211.182.199"
ACA_URL="https://catalog-orders.wonderfulriver-e99086d4.malaysiawest.azurecontainerapps.io"

mkdir -p analysis
if [ ! -f analysis/runlog.csv ]; then
  echo "phase,scenario,env,rep,peak,start_utc,end_utc,exit_code,error_rate,FLAG" > analysis/runlog.csv
fi

LAST_EXIT_CODE=0
LAST_ERROR_RATE=0

log_progress() { echo "[$(date -u +%H:%M:%SZ)] $*"; }

get_newest() {
  # $1 base dir, $2 path substring, $3 glob
  find "$1" -type f -name "$3" -path "*$2*" -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | sed 's/^[^ ]* //'
}

url_for_env() {
  if [ "$1" = "$ENV_VM" ]; then echo "$VM_URL"; else echo "$ACA_URL"; fi
}

run_bench() {
  # phase scenario env url rep peak extra...
  local phase="$1"; local scen="$2"; local env="$3"; local url="$4"; local rep="$5"; local peak="$6"; shift 6
  local extra=("$@")
  local attempt=0 max_attempts=1
  if [ "$phase" != "phase2" ]; then max_attempts=2; fi
  while [ $attempt -lt $max_attempts ]; do
    attempt=$((attempt+1))
    if [ "$phase" = "phase1" ] || [ "$phase" = "phase2" ]; then
      npm run db:reset-orders --silent > /dev/null 2>&1
      reset_ec=$?
      if [ $reset_ec -ne 0 ]; then
        log_progress "ERROR db:reset-orders failed (exit=$reset_ec) for $phase $scen $env"
        exit 1
      fi
    fi
    local start end ec csv err flagged retry_allowed flagval logf
    start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    if [ $attempt -eq 1 ]; then
      log_progress "START $phase $scen $env rep=$rep peak=$peak"
    else
      log_progress "RETRY $phase $scen $env rep=$rep"
    fi
    ./bench/run.sh "$scen" "$env" "$url" "${extra[@]}" > /dev/null 2>&1
    ec=$?
    end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    csv=$(get_newest "bench/results/$env" "${scen}-" "*.csv")
    err=$(awk -F, 'NR==2{print $NF}' "$csv" 2>/dev/null)
    [ -z "$err" ] && err=0
    flagged=0
    [ $ec -ne 0 ] && flagged=1
    awk -v e="$err" 'BEGIN{exit !(e+0 > 0.01)}' && flagged=1
    if [ "$phase" = "phase2" ]; then retry_allowed=0; else retry_allowed=1; fi
    if [ $flagged -eq 1 ]; then flagval="FLAGGED"; else flagval=""; fi
    echo "$phase,$scen,$env,$rep,$peak,$start,$end,$ec,$err,$flagval" >> analysis/runlog.csv
    LAST_EXIT_CODE=$ec
    LAST_ERROR_RATE=$err
    if [ $attempt -eq 1 ] && [ $retry_allowed -eq 1 ] && [ $flagged -eq 1 ]; then
      continue
    fi
    break
  done
  if [ "$scen" = "s3" ] && [ -n "$peak" ]; then
    logf=$(get_newest "bench/results/$env" "${scen}-" "*.log")
    if [ -n "$logf" ]; then
      grep -o 'SAMPLER,[^"]*' "$logf" > "analysis/sampler-${env}-${peak}-${rep}.csv" 2>/dev/null || true
    fi
  fi
  log_progress "DONE $phase $scen $env rep=$rep ec=$LAST_EXIT_CODE err=$LAST_ERROR_RATE"
}

# ---------- Preflight ----------
log_progress "Preflight: k6 version"
K6V=$(k6 version 2>&1 | head -n 1)
log_progress "Preflight: $K6V"

VM_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$VM_URL/health/db")
ACA_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$ACA_URL/health/db")
log_progress "Preflight: health/db azure-vm=$VM_CODE azure-aca=$ACA_CODE"
if [ "$VM_CODE" != "200" ] || [ "$ACA_CODE" != "200" ]; then
  log_progress "ABORT: health/db not 200 on one or both targets"
  exit 1
fi

{
  echo "machine-type: $(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/machine-type)"
  echo "zone: $(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/zone)"
  echo "--- azure-vm ($VM_URL) ---"
  for i in 1 2 3 4 5; do
    curl -o /dev/null -s -w "%{time_connect} %{time_starttransfer}\n" "$VM_URL/health"
  done
  echo "--- azure-aca ($ACA_URL) ---"
  for i in 1 2 3 4 5; do
    curl -o /dev/null -s -w "%{time_connect} %{time_starttransfer}\n" "$ACA_URL/health"
  done
} > analysis/baseline.txt
log_progress "Preflight: baseline written"

# ---------- Warm-up ----------
log_progress "Warmup start"
for url in "$VM_URL" "$ACA_URL"; do
  run_bench "warmup" "s1" "$WARMUP_LABEL" "$url" "1" "" -e VUS=5 -e DURATION_S=20
done
rm -rf "bench/results/$WARMUP_LABEL"
log_progress "Warmup done"

# ---------- Phase 1 ----------
log_progress "Phase 1 start"
for rep in 1 2 3; do
  for s in s1 s2 s4; do
    for env in "$ENV_VM" "$ENV_ACA"; do
      url=$(url_for_env "$env")
      extra=("${VUS_EXTRA[@]}")
      run_bench "phase1" "$s" "$env" "$url" "$rep" "" "${extra[@]}"
      if [ "$s" = "s4" ] && [ "$env" = "$ENV_VM" ]; then
        sleep "$SLEEP600"
      else
        sleep "$SLEEP120"
      fi
    done
  done
done
log_progress "Phase 1 done"

# ---------- Phase 2 (S3 ladder) ----------
log_progress "Phase 2 start"
FINAL_LEVEL=""
for peak in "${PEAKS[@]}"; do
  level_failed=0
  VM_EC=0; ACA_EC=0; VM_ERR=0; ACA_ERR=0
  for env in "$ENV_VM" "$ENV_ACA"; do
    url=$(url_for_env "$env")
    extra=(-e PEAK_VUS="$peak" "${S3_EXTRA[@]}")
    run_bench "phase2" "s3" "$env" "$url" "1" "$peak" "${extra[@]}"
    if [ "$env" = "$ENV_VM" ]; then
      VM_EC=$LAST_EXIT_CODE; VM_ERR=$LAST_ERROR_RATE
    else
      ACA_EC=$LAST_EXIT_CODE; ACA_ERR=$LAST_ERROR_RATE
    fi
    sleep "$SLEEP600"
  done
  if [ "$VM_EC" -ne 0 ] || [ "$ACA_EC" -ne 0 ]; then
    level_failed=1
  fi
  awk -v e="$VM_ERR" 'BEGIN{exit !(e+0 > 0.01)}' && level_failed=1
  awk -v e="$ACA_ERR" 'BEGIN{exit !(e+0 > 0.01)}' && level_failed=1
  if [ "$level_failed" -eq 0 ]; then
    FINAL_LEVEL="$peak"
    log_progress "Phase 2 level $peak OK"
  else
    log_progress "Phase 2 level $peak FAILED (stop climbing)"
    break
  fi
done
if [ -z "$FINAL_LEVEL" ]; then
  FINAL_LEVEL="${PEAKS[0]}"
  log_progress "Phase 2 no successful level; defaulting to $FINAL_LEVEL"
fi
log_progress "Phase 2 final level=$FINAL_LEVEL; running 2 more reps"
for rep in 2 3; do
  for env in "$ENV_VM" "$ENV_ACA"; do
    url=$(url_for_env "$env")
    extra=(-e PEAK_VUS="$FINAL_LEVEL" "${S3_EXTRA[@]}")
    run_bench "phase2" "s3" "$env" "$url" "$rep" "$FINAL_LEVEL" "${extra[@]}"
    sleep "$SLEEP600"
  done
done
log_progress "Phase 2 done"

# ---------- Phase 3 (cold start) ----------
log_progress "Phase 3 start"
(
  run_bench "phase3" "s5" "$ENV_VM" "$VM_URL" "1" "" "${S5_EXTRA[@]}"
) &
pid1=$!
(
  run_bench "phase3" "s5" "$ENV_ACA" "$ACA_URL" "1" "" "${S5_EXTRA[@]}"
) &
pid2=$!
wait "$pid1"
wait "$pid2"

for env in "$ENV_VM" "$ENV_ACA"; do
  logf=$(get_newest "bench/results/$env" "s5-" "*.log")
  if [ -n "$logf" ]; then
    grep -o 'COLD_START,[^"]*' "$logf" > "analysis/cold-${env}.csv" 2>/dev/null || true
  fi
done
log_progress "Phase 3 done"

# ---------- End ----------
log_progress "Summarize"
./bench/summarize.sh > /dev/null 2>&1
date -u '+%Y-%m-%dT%H:%M:%SZ' > analysis/DONE
tar -czf analysis/results.tgz bench/results analysis/*.csv analysis/*.txt analysis/run-all.log 2>/dev/null || tar -czf analysis/results.tgz bench/results analysis/*.csv analysis/*.txt
log_progress "ALL DONE"
if [ "$DO_SHUTDOWN" = "1" ]; then
  sudo shutdown -h +120
fi