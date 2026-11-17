#!/usr/bin/env bash
# Run one benchmark scenario and keep the console log next to the results.
#
# Usage:   ./run.sh <s1|s2|s3|s4|s5> <environment-name> <base-url> [extra k6 args]
# Example: ./run.sh s1 azure-aca https://my-app.region.azurecontainerapps.io
#          ./run.sh s3 vps http://203.0.113.10 -e PEAK_VUS=150
set -euo pipefail

if [ "$#" -lt 3 ]; then
  sed -n '2,8p' "$0"
  exit 1
fi

SCENARIO_KEY="$1"
ENV_NAME="$2"
BASE_URL="$3"
shift 3

cd "$(dirname "$0")"

FILE="$(ls ${SCENARIO_KEY}-*.js 2>/dev/null | head -n 1 || true)"
if [ -z "$FILE" ]; then
  echo "Unknown scenario '${SCENARIO_KEY}'. Use s1, s2, s3, s4 or s5." >&2
  exit 1
fi
SCENARIO="${FILE%.js}"
RESULTS_DIR="${RESULTS_DIR:-results}"
OUT_DIR="${RESULTS_DIR}/${ENV_NAME}/${SCENARIO}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

echo "Running ${SCENARIO} against ${BASE_URL} (environment: ${ENV_NAME})"
k6 run -e BASE_URL="$BASE_URL" -e ENV_NAME="$ENV_NAME" -e RESULTS_DIR="$RESULTS_DIR" "$FILE" "$@" 2>&1 \
  | tee "${OUT_DIR}/${STAMP}.log"
