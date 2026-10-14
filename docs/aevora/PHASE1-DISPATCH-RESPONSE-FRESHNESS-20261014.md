# Aevora Dispatch Response Freshness Check — 2026-10-14

Status: unresolved operational observation; read-only checks only.

## Evidence observed

- The active cron inventory includes recurring dispatch jobs scheduled every 5 or 15 minutes.
- At the read-only check around 2026-10-14 04:05 UTC, `cron.job_run_details` showed recent successful SQL executions, including release and publication-sync jobs with latest runs at about 04:05 UTC.
- At that same inspection, `net._http_response` contained 246 rows, but its newest `created` timestamp was about 02:25 UTC. The request queue count was zero.
- The database reports `pg_net.ttl = 6 hours` (default). A point-in-time response table can contain older rows because cleanup behavior depends on the worker processing requests; the table age alone does not establish worker health.
- The existing cron command metadata does not mention a persisted `request_id`. Most jobs call through helper expressions, so the absence of an obvious direct assignment in the command text is not proof that no internal helper captures it; no request-ID persistence mechanism was found in the reviewed metadata.

## Interpretation

There is a freshness gap between recent successful cron SQL executions and the newest visible pg_net response. This is not enough to conclude that the HTTP worker is down: a successful cron row only establishes SQL statement success, and a zero-length queue is only a point-in-time observation. The actual HTTP outcome and application-level result remain unknown without request correlation.

## Safe follow-up

1. Read-only inspect the helper functions referenced by the existing cron commands, without printing URLs, auth headers, request bodies, or secret-bearing literals.
2. Check pg_net worker health and response-table freshness using supported operational telemetry.
3. Establish the exact API-exposed schema list from project configuration; database grants alone do not prove client API reachability.
4. Add correlation to a future reviewed design, capturing each `net.http_post` request ID and reconciling status before response cleanup. Preserve current job cadence, payload, headers, and side effects exactly.
5. Do not send test HTTP requests, trigger any Edge Function, or change live jobs as part of diagnosis.

No live job, schedule, function, grant, table, or production task state was changed.
