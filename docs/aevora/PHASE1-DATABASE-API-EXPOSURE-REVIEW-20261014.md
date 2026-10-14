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
