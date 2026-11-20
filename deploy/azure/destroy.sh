#!/usr/bin/env bash
set -euo pipefail
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-catalog-orders}"
az group delete --name "$RESOURCE_GROUP" --yes --no-wait
echo "Deleted resource group $RESOURCE_GROUP"