# CPU calibration

Measured on dev machine (not container-limited) for `/api/report?complexity=N`.

| complexity | iterations | durationMs |
| ---------- | ---------- | ---------- |
| 1          | 200000     | ~80        |
| 3          | 600000     | ~218       |
| 10         | 2000000    | ~725       |

Target: 200-400 ms at complexity 3. Achieved with 200,000 iterations per level (no adjustment).

Container (1 vCPU, Node 22, --cpus=1): 600,000 iterations (complexity 3) = 360 ms. Within target. No adjustment needed.
