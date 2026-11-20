# Benchmark scripts (k6)

Load tests for the Catalog and Orders app. The same scripts run against the VPS and against Azure Container Apps, so the results are comparable.

## Requirements

- k6 (https://k6.io, install for your OS). The scripts were tested with k6 v1.3.0.
- Bash (Linux, macOS, or WSL/Git Bash on Windows) for `run.sh` and `summarize.sh`. Without Bash you can call `k6 run` directly (see below).
- Node.js 18+ only if you want to dry-run against `mock-server.js`.

## Files

| File                | What it does                                                                        |
| ------------------- | ----------------------------------------------------------------------------------- |
| `s1-steady-read.js` | Constant reads (70% list, 30% detail). Default 50 VUs, 5 min.                       |
| `s2-write.js`       | Constant `POST /api/orders`. Default 20 VUs, 3 min.                                 |
| `s3-spike.js`       | 0 to 300 VUs in 30 s, hold 120 s, down in 30 s. Mix 80% read, 15% write, 5% report. |
| `s4-cpu.js`         | Constant `GET /api/report?complexity=3`. Default 10 VUs, 3 min.                     |
| `s5-cold-start.js`  | Idle, then one cold request and one warm request. Default 10 rounds, 15 min idle.   |
| `lib/common.js`     | Shared requests, metrics, instance sampler, summary writer.                         |
| `run.sh`            | Runs one scenario and saves the console log with the results.                       |
| `summarize.sh`      | Merges all per-run CSV files into `results/all.csv`.                                |
| `mock-server.js`    | Stand-in app for dry runs only. Not for measurements.                               |

## Run

```
./run.sh <s1|s2|s3|s4|s5> <environment-name> <base-url> [extra k6 args]

./run.sh s1 vps http://203.0.113.10
./run.sh s3 azure-aca https://my-app.region.azurecontainerapps.io
./run.sh s5 azure-aca https://my-app.region.azurecontainerapps.io
```

Use the same environment name every time for the same target (for example `vps` and `azure-aca`). It becomes the folder and the label in the CSV.

Without Bash:

```
k6 run -e BASE_URL=https://my-app.example.com -e ENV_NAME=azure-aca s1-steady-read.js
```

Create `results/<env>/<scenario>/` first in that case, because k6 may not create the folders.

## Dry run before the real app exists

```
node mock-server.js          # terminal 1, listens on :8080
./run.sh s1 smoke http://localhost:8080 -e VUS=5 -e DURATION_S=10    # terminal 2
```

The mock uses a lighter CPU workload than the real `/api/report`, so only check that the scripts run, not the numbers.

## Settings

Pass with `-e NAME=value` (extra arguments after the base URL in `run.sh`).

| Name                                             | Default                 | Used by                                                    |
| ------------------------------------------------ | ----------------------- | ---------------------------------------------------------- |
| `BASE_URL`                                       | `http://localhost:8080` | all (set by `run.sh`)                                      |
| `ENV_NAME`                                       | `local`                 | all (set by `run.sh`)                                      |
| `MAX_PRODUCT_ID`                                 | 1000                    | all. Product ids must be 1..N (a freshly seeded database). |
| `SAMPLER`                                        | 1                       | S1-S4. Set 0 to turn off the `/health` sampler.            |
| `VUS`, `DURATION_S`, `THINK_TIME_S`              | per scenario            | S1, S2, S4                                                 |
| `LIST_SHARE`                                     | 0.7                     | S1                                                         |
| `PEAK_VUS`, `RAMP_UP_S`, `HOLD_S`, `RAMP_DOWN_S` | 300, 30, 120, 30        | S3                                                         |
| `COMPLEXITY`                                     | 3                       | S3, S4                                                     |
| `ITERATIONS`, `IDLE_SECONDS`, `SKIP_FIRST_IDLE`  | 10, 900, 0              | S5                                                         |

Think time (`THINK_TIME_S`) is the pause between requests of one virtual user. It was not fixed by the PRD, so the defaults (0.5 s, and 0.2 s for the CPU test) are assumptions. Use the same values for every environment.

## Output

For each run, under `results/<env>/<scenario>/<timestamp>`:

- `.json`: the full k6 summary data
- `.csv`: one row per metric (`avg`, `p50`, `p95`, `p99`, `max`, plus `rps` and `error_rate` on the first row)
- `.log`: the console output, which also contains the sampler and cold-start lines

Metrics: `latency_all`, `latency_products_list`, `latency_products_detail`, `latency_orders_create`, `latency_report`, and `server_time_ms` (from the `Server-Timing` header, so you can compare it with the client-side latency).

### Instances over time

While S1-S4 run, the sampler prints one line per second:

```
SAMPLER,<time>,<instance id>,<status>,<ms>
```

Extract and count instances:

```
grep -o 'SAMPLER,[^"]*' results/azure-aca/s3-spike/<file>.log > sampler.csv
cut -d, -f3 sampler.csv | sort | uniq -c
```

The sampler uses `/health`, which is cheap and does not touch the database. It adds 1 request per second, which is negligible.

### Cold start (S5)

Each round prints:

```
COLD_START,<n>,<time>,<cold status>,<cold ms>,<cold ttfb ms>,<warm status>,<warm ms>,<cold instance>,<warm instance>
```

```
grep -o 'COLD_START,[^"]*' results/azure-aca/s5-cold-start/<file>.log > cold.csv
```

- S5 has no sampler on purpose. Polling would keep the app warm.
- The idle time must be longer than the platform's scale-to-zero cooldown. If the cold and warm values look the same, increase `IDLE_SECONDS`.
- On the VPS there is no cold start, so S5 there is the baseline.
- Plan the time: 10 rounds with 15 min idle takes about 2.5 hours.

## Method rules (from the PRD)

1. Run from the same machine and network for both environments, and write down where it is.
2. Run each scenario 3 times and report the median.
3. Run both environments at similar times of day.
4. Reset benchmark orders before each run (`npm run db:reset-orders` in the app).
5. Do not discard cold-start effects in S3.
6. Record the Docker image digest used in each environment.

## Safety

- Load tests cost real money on pay-per-use platforms. Start with small values (for example `-e PEAK_VUS=30 -e HOLD_S=20`) and check the Azure budget alert before the full run.
- Only test your own deployment.
- The scripts use synthetic emails (`user+N@example.com`). Keep it that way.
