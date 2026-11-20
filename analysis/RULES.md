# Rules (read first, follow strictly)

- You may create files only in analysis/ and docs/RESULTS.md. bench/, src/, deploy/, cost/ are read-only. No git commit or push.
- Targets: azure-vm = http://85.211.182.199 ; azure-aca = https://catalog-orders.wonderfulriver-e99086d4.malaysiawest.azurecontainerapps.io
- This machine is the load generator (a GCP VM). az is NOT installed here and you must not install or use cloud CLIs.
- Secrets: the database URL is in .env and is loaded by npm scripts (npm run db:reset-orders). You never need to read it. Never open, cat, grep, print or copy .env or any .env.* file, never run env, printenv or set, and never write any connection string or password into any file, log or message. If a command fails with a database connection error, report it and stop.
- Never change run parameters or bench/ on your own. Do not run anything else against the targets while a benchmark is running.
- Numbers come only from files in bench/results/ and analysis/. Never invent, estimate or silently round. No interpretation in docs/RESULTS.md beyond what the numbers show.
- After each step: stop and report in chat when told to.