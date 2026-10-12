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

## Deployment implications

- The prepared scheduler's claim/renew/release RPC names and signatures match the live functions.
- No lease migration appears necessary based on the inspected function/table metadata.
- This confirms schema prerequisites only. It does not validate the prepared scheduler's full runtime behavior, authentication environment, or publication path.
- Production scheduler and publisher remain unchanged. No RPC was invoked, no lease was acquired or released, no schedule was modified, and no chapter was generated or published.