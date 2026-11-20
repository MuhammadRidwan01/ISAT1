#!/usr/bin/env bash
set -euo pipefail

# ---- variables (edit these) ----
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-catalog-orders}"
LOCATION="malaysiawest"
ENV_NAME="${ENV_NAME:-cae-catalog-orders}"
APP_NAME="${APP_NAME:-catalog-orders}"
IMAGE="${IMAGE:-docker.io/bebekterbangg/catalog-bench@sha256:357b33dd345add057bd4097bc1a10bd7610afaab6c1b9470c5bdffaf10d8742f}"
REGISTRY_SERVER="${REGISTRY_SERVER:-docker.io}"
CPU="${CPU:-1.0}"
MEMORY="${MEMORY:-2Gi}"
MIN_REPLICAS="${MIN_REPLICAS:-0}"
MAX_REPLICAS="${MAX_REPLICAS:-10}"
CONCURRENT_REQUESTS="${CONCURRENT_REQUESTS:-20}"
DATABASE_URL="${DATABASE_URL:-}"
APP_VERSION="${APP_VERSION:-0.1.0}"

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

az containerapp env create \
  --name "$ENV_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION"

az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENV_NAME" \
  --image "$IMAGE" \
  --target-port 8080 \
  --ingress external \
  --cpu "$CPU" --memory "$MEMORY" \
  --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" \
  --scale-rule-name http-rule \
  --scale-rule-type http \
  --scale-rule-http-concurrency "$CONCURRENT_REQUESTS" \
  --secrets "database-url=$DATABASE_URL" \
  --env-vars "PORT=8080" "DATABASE_URL=secretref:database-url" "DB_SSL=true" "DB_POOL_MAX=5" "APP_VERSION=$APP_VERSION" "LOG_LEVEL=info"

echo "Deployed. Record the image digest for both environments."