# Aevora Dispatch Response Freshness Check — 2026-10-14

Status: unresolved operational observation; read-only checks only.

## Evidence observed

- The active cron inventory includes recurring dispatch jobs scheduled every 5 or 15 minutes.
- At the read-only check around 2026-10-14 04:05 UTC, `cron.job_run_details` showed recent successful SQL executions, including release and publication-sync jobs with latest runs at about 04:05 UTC.
- At that same inspection, `net._http_response` contained 246 rows, but its newest `created` timestamp was about 02:25 UTC. The request queue count was zero.
- The database reports `pg_net.ttl = 6 hours` (default). A point-in-time response table can contain older rows because cleanup behavior depends on the worker processing requests; the table age alone does not establish worker health.
- A follow-up metadata-only function-name extraction from active dispatch commands found direct `net.http_post` calls alongside built-in `exists` and `jsonb_build_object` expressions; no custom helper function appeared in those commands. The command text was not emitted or copied into this report. No request-ID persistence mechanism was found in the reviewed dispatch metadata.
- A read-only `pg_stat_activity` snapshot showed one `pg_net 0.20.4 worker` session in an idle state waiting on an extension event. This confirms a worker session was visible at that moment; an idle wait state is not proof of failure or full health.

## Interpretation

There is a freshness gap between recent successful cron SQL executions and the newest visible pg_net response. This is not enough to conclude that the HTTP worker is down: a successful cron row only establishes SQL statement success, and a zero-length queue is only a point-in-time observation. The actual HTTP outcome and application-level result remain unknown without request correlation.

## Safe follow-up

1. Read-only inspect the helper functions referenced by the existing cron commands, without printing URLs, auth headers, request bodies, or secret-bearing literals.
2. Check pg_net worker health and response-table freshness using supported operational telemetry.
3. Establish the exact API-exposed schema list from project configuration; database grants alone do not prove client API reachability.
4. Add correlation to a future reviewed design, capturing each `net.http_post` request ID and reconciling status before response cleanup. Preserve current job cadence, payload, headers, and side effects exactly.
5. Confirm worker health using supported Supabase operational telemetry and time-correlated, aggregate logs; do not treat an idle worker wait state as an error.
6. Do not send test HTTP requests, trigger any Edge Function, or change live jobs as part of diagnosis.

No live job, schedule, function, grant, table, or production task state was changed.


## Recheck at approximately 2026-10-14 05:12 UTC

A newer read-only aggregate snapshot found 246 rows in `net._http_response`, with the newest response at `2026-10-14 05:05:00.365511+00`. In the same query, `cron.job_run_details` had 294 runs in the preceding six hours, with the newest start at `2026-10-14 05:05:00.312733+00`. Thus the earlier visible freshness gap was **not present at this later snapshot**: the latest observed response and latest cron start were within the same second. This does not prove request-by-request correlation or Edge Function business success; aggregate timestamps cannot attribute each response to a specific job, and response cleanup may remove older rows. No command text, response bodies, credentials, or request payloads were retrieved, and no jobs or functions were triggered.

## Later read-only recheck — 2026-10-14 05:10 UTC

The six-hour aggregate now shows 246 `net._http_response` rows with newest response at `2026-10-14 05:10:00.12948+00`; the 294 `cron.job_run_details` rows have newest start at `2026-10-14 05:10:00.112231+00`. Active scheduled jobs showed zero failed SQL runs in this six-hour window; generation/blueprint/DNA/arc/quality/Clara jobs last started at about 05:00 UTC, while release, publication-sync, and semantic-continuity jobs last started at about 05:10 UTC. This confirms the earlier response freshness gap was not present at this snapshot, but it still does not correlate individual pg_net responses with individual cron dispatches or prove application-level business success. No command text, request/response payload, credentials, or application rows were read; no job was triggered or modified.
