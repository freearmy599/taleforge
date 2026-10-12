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

## Atomic lease fencing — prepared, not applied

The initial prepared scheduler renewed the lease and then updated `release_schedules` through a separate PostgREST request. A lease could expire and be claimed by another scheduler between those requests, allowing the former owner to advance the deadline after losing ownership. Lifecycle activation had the same check-then-write gap.

Read-only production inspection recovered the exact definitions and ACLs for the existing claim/renew/release RPCs. The prepared branch now adds `supabase/migrations/20261012190000_aevora_atomic_scheduler_lease_fencing.sql`, defining two narrowly scoped functions:

- `aevora_advance_release_schedule_if_lease_owned`: locks the lease row, verifies the exact token and unexpired lease, and advances the release deadline in the same transaction.
- `aevora_activate_story_lifecycle_if_lease_owned`: applies the same lease fence and verifies the schedule-to-series relationship before transitioning a preparing lifecycle to active.

Both functions use SECURITY DEFINER with a fixed `pg_catalog, public, pg_temp` search path, revoke execution from PUBLIC/anon/authenticated, and grant execution only to postgres/service_role. The prepared scheduler now calls these RPCs and fails closed on errors or false results. Contract tests cover token/expiry checks, row locking, function security, and the scheduler's use of atomic writes.

**This migration has not been applied.** Hosted validation run [38283233964](https://github.com/freearmy599/taleforge/actions/runs/38283233964) passed all prepared Edge Function type checks and the 37-test source-contract suite, including the atomic migration contract and non-advancing-deadline guard. This is source/type validation only, not a live migration or integration test. Do not deploy the scheduler until the migration has been reviewed and separately authorized for application and deployment.

## Remaining repository migration-tracking gap

The existing production lease table and original claim/renew/release function definitions still do not have their source migration recovered in this branch. The new migration only adds atomic write functions and does not recreate the existing lease foundation. This remains a reproducibility gap, not evidence that the live production objects are missing.

The exact live definitions and grants were inspected read-only. Do not fabricate the missing original migration or apply any migration as part of this audit.

## Deployment implications

- The prepared scheduler's claim/renew/release RPC names and signatures match the live functions.
- No lease migration appears necessary based on the inspected function/table metadata.
- This confirms schema prerequisites only. It does not validate the prepared scheduler's full runtime behavior, authentication environment, or publication path.
- Production scheduler and publisher remain unchanged. No RPC was invoked, no lease was acquired or released, no schedule was modified, and no chapter was generated or published.