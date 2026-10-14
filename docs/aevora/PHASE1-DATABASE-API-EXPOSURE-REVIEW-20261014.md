# Aevora Database API Exposure Review — 2026-10-14

Status: read-only finding; review required. No production permissions were changed.

## Observation

A read-only query against the connected database found that the PostgreSQL PUBLIC role has EXECUTE on the pg_net HTTP request functions `net.http_get`, `net.http_post`, and `net.http_delete`. The `net` schema also reports USAGE for the `anon` and `authenticated` roles. The same inspection did not show those client roles with table privileges on `net._http_response`, and they did not have USAGE on `cron`.

## Interpretation

This is a permission-hardening item, not evidence that an outside party has exploited the database. The database-side PostgREST exposed-schema setting was not available in the inspected settings, so client API reachability for these functions is not confirmed. Function execute grants alone do not establish that the functions are reachable over the public API.

## Safe next steps

1. Verify the project's actual PostgREST exposed schemas using supported project configuration, not assumptions based on database settings.
2. Check current Supabase guidance and pg_net requirements for safe function grants.
3. If client invocation is possible, prepare a narrowly scoped correction and confirm that the trusted role executing scheduled dispatches retains the required privileges.
4. Add a regression check for the intended schema exposure and grants.
5. Obtain explicit approval before changing production privileges.

Do not blindly revoke broad grants: a correction must preserve scheduler compatibility. No schema, grant, function, schedule, table, or production state was modified during this inspection.

## Follow-up: effective public-schema function EXECUTE inventory

A metadata-only follow-up using `has_function_privilege` confirmed 12 public-schema invoker functions currently have effective EXECUTE for `anon` and `authenticated`. Four are trigger-returning functions attached to table triggers (`taleforge_update_updated_at`, `touch_story_lifecycle_updated_at`, `update_series_chapter_count`, `update_updated_at`); this is not proof they can be meaningfully invoked through PostgREST RPC. The prepared migration `20261013110000_restrict_internal_invoker_rpc_execution.sql` revokes client EXECUTE on seven named planner/metrics functions. One additional non-trigger function, `taleforge_score_story_opportunity(numeric,numeric,numeric,numeric,numeric)`, also has effective client EXECUTE and no catalog trigger references, but it is not in that migration. Its intended audience and caller paths have not been verified, so it remains a **classification item**, not an automatic revoke. Confirm whether it is used by any client-facing workflow before extending the migration. Do not change production privileges during this audit.

