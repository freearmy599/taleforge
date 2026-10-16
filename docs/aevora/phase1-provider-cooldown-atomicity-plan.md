# Aevora Phase 1 — provider cooldown atomicity plan

Status: design gate only. This document does not authorize deployment, migration, provider calls, publication, or schedule changes.

## Verified defect

The current `generate-chapter` provider-failure handler reads `consecutive_throttle_count` and `cooldown_until`, calculates a new value in TypeScript, then upserts the whole provider-state row. Two concurrent failures can read the same count and overwrite one another. Taking the maximum of the proposed and previously read timestamps protects against shortening only when both reads are current; it does not make the counter update atomic.

The existing source-contract test checks error aliasing and fail-closed logging. It does not prove concurrent increments, timestamp monotonicity under races, function ACLs, or runtime behavior.

## Required design

Implement one PostgreSQL operation that records a provider throttle as a single database-atomic operation. Choose its exact SQL only after the read-only schema inventory has been reconciled with the actual database and migration history.

The operation must:

1. Update the `gemini` provider row atomically, including when the row does not yet exist and when multiple requests arrive concurrently.
2. Increment the throttle counter exactly once per accepted recording call; concurrent calls must not lose increments.
3. Derive the exponential quota cooldown from the serialized/new counter value, while retaining the longest already-recorded cooldown. A temporary-overload event may use its distinct fixed duration, but must never shorten an existing cooldown.
4. Use database time consistently for recorded timestamps and calculate all state changes in the same transaction.
5. Return an explicit success result and the persisted state needed by callers; any database error must remain an error, never be converted to apparent success.
6. Be idempotent only if a stable event/idempotency key is deliberately introduced. Do not claim retries are idempotent otherwise.
7. Be executable only by the intended server-side service role. Revoke execution from `PUBLIC`, `anon`, and `authenticated`; verify effective privileges, ownership, schema exposure, and any `SECURITY DEFINER` search path before release.
8. Avoid returning secrets, prompt text, provider response bodies, or user content.

## Required regression coverage

- Two or more concurrent quota events starting from a known counter result in the expected total increment.
- Concurrent events cannot reduce `cooldown_until`.
- First insert racing with another first insert leaves one provider row and accounts for both events.
- Malformed persisted state is handled explicitly rather than silently reset.
- Database failure produces a failed result and the caller does not proceed as though cooldown recording succeeded.
- Temporary overload and quota/rate-limit paths follow their distinct intended durations.
- Unauthenticated and ordinary authenticated roles cannot execute the operation; service-role execution is verified from effective ACL evidence.
- The Edge Function has no remaining read-then-write cooldown path and type-checks against the actual RPC result shape.
- A real PostgreSQL concurrency rehearsal exercises the migration/RPC. Static regex tests alone are insufficient.

## Evidence required before writing the migration

Use `docs/aevora/phase1-provider-state-schema-provenance.sql` through an already-authorized read-only SQL session. Record the exact existing relation/column types, constraints, unique key, triggers, grants, default privileges, function owners, and related routines. Compare that evidence to repository migrations and deployed definitions. Do not infer column types, function signatures, or ownership from the Edge Function.

If repository migration history and the live database disagree, stop and reconcile before drafting a migration. Do not apply the inventory SQL as a migration; it is catalog-only audit SQL.

## Release gates

This repair remains blocked until the atomic operation and regression tests are implemented, reviewed, and green. Then re-run Edge Function type-checking, all existing Phase 1 contract tests, and the disposable PostgreSQL rehearsal. Verify real Supabase Edge Runtime compatibility separately.

This plan does not authorize production deployment, database migration, schedule mutation, chapter generation/publication, or creation of a billable Supabase branch.

## Additional confirmed defect: malformed counter is silently reset

The current handler converts `consecutive_throttle_count` to a number and substitutes `0` whenever the result is not a non-negative safe integer. That means a malformed, negative, fractional, or unsafe persisted counter is not surfaced as invalid state; it can be treated as a fresh counter and produce a shorter escalation interval. This differs from the explicit malformed-`cooldown_until` branch, which preserves existing state and logs an error.

The atomic database operation must not silently normalize an invalid persisted counter. It should return a stable invalid-state result (or use another explicitly reviewed recovery rule), leave the prior state intact, and prevent the caller from claiming cooldown recording succeeded. Add regression cases for `NULL` if allowed by the actual schema, negative values, fractional values if the type permits them, and values outside the supported integer range. Test only the representations that the reconciled schema can actually store.


## Second writer path: generation-orchestrator fallback

The atomicity scope includes **both** `generate-chapter` and `generation-orchestrator`. The orchestrator has a fallback recorder that independently reads `taleforge_ai_provider_state`, computes a counter/cooldown in TypeScript, and upserts the row. Its current “already active” check avoids some duplicate counting when a worker has already persisted a cooldown, but that read-then-write check is itself racy and is not an idempotency guarantee. Two concurrent fallback calls can also observe the same state and lose an increment.

The eventual RPC migration must route both writers through the same atomic database operation, with an explicitly reviewed policy for duplicate observations of one upstream failure. Do not fix only the direct worker while leaving the fallback path as a second non-atomic writer. Until that is implemented and rehearsed, provider cooldown atomicity remains an open release blocker.


## Branch implementation update — 2026-10-16

The branch now contains candidate migration `20261016180000_atomic_gemini_provider_throttle.sql`, which defines `public.aevora_record_gemini_throttle(text)`. Both `generate-chapter` and `generation-orchestrator` route quota/overload recording through this shared RPC; the three dedicated review workers do the same. The RPC accepts only the event classes `quota` and `overload`, uses fixed safe diagnostic strings, atomically increments the row with `INSERT ... ON CONFLICT DO UPDATE`, keeps the longest active cooldown with `GREATEST`, rejects negative persisted counters, and grants execution only to `service_role` after revoking `PUBLIC`, `anon`, and `authenticated`.

This is a **prepared branch candidate**, not a live fix. It does not yet resolve the missing original provider-state migration body or the live migration-ledger mismatch. It is not idempotent across duplicate calls because no stable event key is passed; the call sites must therefore not claim exactly-once semantics across retries. Database exceptions must remain visible as failed recording, not be normalized into success.

The branch now adds a disposable PostgreSQL concurrency rehearsal that runs 20 concurrent RPC calls and checks the final counter, server-only EXECUTE ACLs, fixed diagnostics, preservation of a longer cooldown, the one-hour overload cooldown, invalid event rejection, and preservation of a malformed negative counter. The CI workflow has been updated to run this rehearsal in its own explicitly named disposable database. Static contract tests were also updated to assert the shared RPC path instead of the removed read-modify-upsert path.

**Remaining release gates:** confirm the migration executes successfully in CI's actual PostgreSQL runtime, inspect the complete test result, verify the Edge Runtime result shape, reconcile the live table's provenance and effective ACLs, and obtain separate rollout authorization. Do not apply this migration to production or deploy workers as part of this continuation.
