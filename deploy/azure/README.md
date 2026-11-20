# Azure Container Apps (serverless) deployment

## Cost-safety steps

1. Set a budget alert in Azure before running.
2. Run `deploy.sh` with DATABASE_URL set.
3. Run benchmarks.
4. Run `destroy.sh` to delete everything.

## Usage

```
DATABASE_URL="postgres://..." ./deploy.sh
./destroy.sh
```

MIN_REPLICAS defaults to 0; set MIN_REPLICAS=1 for the always-warm scenario.

Record the Docker image digest used so both environments run the same image.
