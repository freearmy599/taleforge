# Aevora Scheduled Dispatch Correlation ADR (Draft)

**Status:** Proposed; branch documentation only.  
**Date:** 2026-10-14  
**Scope:** Read-only operational observability for existing pg_cron → pg_net → Supabase Edge Function calls.

## Problem

A successful row in `cron.job_run_details` proves that the scheduled SQL statement completed. It does not prove that the asynchronous HTTP request completed, that the Edge Function returned a successful HTTP status, or that the function completed its intended business operation. A response count across `net._http_response` is useful for aggregate health but cannot reliably attribute a response to a particular cron job unless the returned pg_net request ID was persisted with the job identity.

## Decision

Use explicit per-dispatch correlation in a future, reviewed rollout. Do not infer job ownership from timestamps, response order, URL alone, or aggregate status counts.

For each scheduled dispatch, persist only:
- a generated dispatch-row ID;
- the stable, explicit cron job name (and `cron.job.jobid` when it can be resolved unambiguously);
- pg_cron's scheduled/run identifier when available from the dispatch wrapper context;
- the pg_net `request_id` returned by `net.http_post`;
- dispatch timestamp and a bounded status lifecycle (for example, `dispatched`, `http_succeeded`, `http_failed`, `application_failed`, `timed_out`, `response_missing`);
- response status code, timeout flag, and a short allowlisted error category;
- timestamps for dispatch and outcome observation.

Do **not** persist request headers, bearer tokens, service-role keys, request bodies, response bodies, arbitrary response headers, chapter text, prompts, or other user/story data. Do not include secrets or response payloads in logs or GitHub issues.

## Proposed processing model

1. A narrowly scoped SQL wrapper or per-job SQL CTE calls `net.http_post` and captures its returned `request_id`.
2. The same transaction records the request ID against an explicit, stable job name. The dispatch record is written only after the HTTP request enqueue returns a valid ID; failures to record correlation must be visible as a dispatch/audit error, not silently represented as a successful downstream run.
3. A periodic read-only reconciliation joins dispatch records to `net._http_response.id` and records the HTTP outcome before pg_net response cleanup can remove the original row.
4. Where the endpoint returns JSON, parse only a documented, allowlisted application outcome field in memory. Store a normalized outcome/category, never the response body. HTTP 2xx alone must not be called business success when the function contract requires an explicit `success: true` or equivalent.
5. Report separate metrics: SQL dispatch result, HTTP response result, application result, and durable business postcondition. Missing correlation or missing response after a configurable grace period is **unknown**, not success. Repeated retries must be idempotent and must not cause the scheduled job to execute twice merely to repair telemetry.

## Security and database requirements

Before implementing a migration, inspect the live database's actual pg_cron/pg_net versions, function signatures, cron job names/IDs, response-table retention/cleanup policy, and existing grants. Do not assume that internal `net` schema objects or cron metadata are available to ordinary roles.

Any new correlation table should live in a non-exposed schema (prefer an existing private schema after confirming it exists), have RLS enabled where applicable, and grant no access to `anon` or `authenticated`. Only the narrow service-role-owned reconciliation path should write it. Avoid a broad `SECURITY DEFINER` helper unless its fixed search path, owner, execute grants, argument validation, and privilege boundary have been independently reviewed.

The design must not require a billable Supabase branch. Prefer an offline/local SQL contract test and a disposable local Postgres/pg_net integration test if available. Do not run a live dispatch as a test.

## Failure semantics

| Observation | Recorded interpretation |
|---|---|
| Cron SQL fails before enqueue | `dispatch_failed` |
| Enqueue returns a valid request ID | `dispatched`; not downstream success |
| HTTP response is non-2xx | `http_failed` with status/category |
| HTTP response is 2xx but allowlisted application result says failure | `application_failed` |
| HTTP 2xx and application result passes, but durable postcondition is not checked | `application_succeeded`; business completion still unverified |
| No response before grace deadline | `response_missing` / unknown; never auto-upgrade to success |
| Correlation row or response snapshot is incomplete | Audit unhealthy / unknown |

## Rollout gates

This ADR is not authorization to change production. Before implementation or deployment:

1. Confirm actual cron jobs and command text using read-only queries.
2. Confirm pg_net response schema, retention behavior, and whether request IDs are returned by the deployed version.
3. Design an idempotent dispatch wrapper that preserves each job's current URL, headers, payload, cadence, and behavior exactly.
4. Add tests for enqueue failure, response missing, 429 cooldown, non-2xx, 2xx application failure, duplicate reconciliation, and redaction.
5. Review grants/RLS and ensure no ordinary-user access.
6. Deploy only after explicit owner approval; then use read-only verification and never trigger generation/publication as a smoke test.

## Current state

The existing monitor's counts (including HTTP 200 and cooldown-related HTTP 429 responses) are aggregate evidence only. Per-job downstream outcome correlation remains open. No live cron command, table, schedule, Edge Function, or production queue state was changed to prepare this proposal.
