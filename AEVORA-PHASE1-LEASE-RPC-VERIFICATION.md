# Aevora Phase 1 — Scheduler lease RPC prerequisite verification

Date: 2026-10-12  
Status: read-only production verification; no mutation performed.

## Prepared scheduler RPCs exist in production

The prepared scheduler calls these existing PostgreSQL functions:

| Function | Arguments | Return |
|---|---|---|
| aevora_claim_release_scheduler_lease | p_schedule_id uuid, p_lease_token uuid, p_lease_seconds integer | boolean |
| aevora_renew_release_scheduler_lease | p_schedule_id uuid, p_lease_token uuid, p_lease_seconds integer | boolean |
| aevora_release_scheduler_lease | p_schedule_id uuid, p_lease_token uuid | boolean |

The claim/renew functions default to 300 seconds and reject requested durations outside 30–900 seconds. Claim creates a lease when none exists or replaces an expired lease; it will not take over an unexpired lease. Renew requires the matching schedule/token pair and an unexpired lease. Release deletes only the matching schedule/token pair. These semantics were checked by read-only inspection of the function definitions; the functions were not executed as part of this audit.

## Privilege and table checks

- All three functions are SECURITY DEFINER and set a fixed search_path of pg_catalog, public, and pg_temp.
- Explicit function EXECUTE grants were observed for postgres and service_role only; no PUBLIC, anon, or authenticated execute grant was observed.
- The public.aevora_release_scheduler_leases table exists with non-null schedule ID, token, expiry, creation, and update columns.
- Its primary key is a unique index on schedule_id, supporting one lease row per schedule.
- A read-only count found zero current lease rows (zero unexpired and zero expired leases), so no existing lease row would block the prepared scheduler at this snapshot.
- RLS is enabled. anon and authenticated have no SELECT/INSERT/UPDATE/DELETE table privileges; service_role has those privileges.

## Remaining lease-fencing race

The current prepared scheduler renews the lease and then updates `release_schedules` through a separate PostgREST request filtered only by schedule ID. The lease RPC correctly checks the matching token at renewal time, but that check is not atomic with the subsequent schedule update. If execution is paused long enough for the lease to expire and another scheduler to claim it between those requests, the former owner could still advance the schedule row. The 180-second lease and immediate follow-up reduce the window but do not mathematically eliminate it.

A robust final fix should use a narrowly scoped database function that, in one transaction, verifies the matching unexpired lease token and updates the schedule deadline; it should return an explicit boolean/row result and remain executable only by `service_role` and `postgres`. The prepared scheduler must fail closed if that atomic operation returns false or errors. Review the lifecycle activation write for the same fencing requirement. Do not implement or apply this function until the migration source and security contract have been reviewed.

## Repository migration-tracking gap

A follow-up inspection of the current hardening branch found no lease-named migration among its 39 SQL migration files, and neither `database-schema.sql` nor `series-chapters-schema.sql` contains the lease table or RPC definitions. Production metadata confirms these objects currently exist, but this branch does not contain their source definitions. This is a repository reproducibility gap, not evidence that the live production objects are missing.

Do not fabricate a migration from function names alone. Before Phase 1 can be considered fully reproducible, recover and review the exact deployed definitions and grants through a read-only inspection, then prepare a source-controlled migration or a documented dependency with explicit justification. Do not apply a migration as part of this audit.

## Deployment implications

- The prepared scheduler's claim/renew/release RPC names and signatures match the live functions.
- No lease migration appears necessary based on the inspected function/table metadata.
- This confirms schema prerequisites only. It does not validate the prepared scheduler's full runtime behavior, authentication environment, or publication path.
- Production scheduler and publisher remain unchanged. No RPC was invoked, no lease was acquired or released, no schedule was modified, and no chapter was generated or published.