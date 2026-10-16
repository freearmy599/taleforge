# Aevora Phase 1 — Gemini throttle caller and event-identity audit

Date: 2026-10-16
Status: branch-only source audit; no runtime or database changes
Scope: `aevora_record_gemini_throttle`, direct writers, orchestration fallback writers, and duplicate-event semantics.

## Executive result

The current branch has **eight writer functions identified so far** (including one orchestrator fallback that can repeat an observation already recorded by a child). The master checklist separately records 11 migrated branch writers; this audit has not yet independently located all 11, so that inventory must be reconciled before implementation. The candidate SQL does not satisfy the contract in `PHASE1-GEMINI-THROTTLE-CONTRACT-20261016.md`: it increments `consecutive_throttle_count` for both `quota` and `overload`, and it accepts no stable event identifier. Therefore, do not deploy the candidate migration or any writer changes yet.

## Confirmed writer inventory

| Function | Source location | Write behavior | Identity finding |
| --- | --- | --- | --- |
| `generate-chapter` | `supabase/functions/generate-chapter/index.ts`, catch near lines 282–299 | Records quota/503 in its outer request catch; includes an HTTP request ID in logs only | RPC receives only `p_event_class`; no stable observation key |
| `revise-chapter` | `supabase/functions/revise-chapter/index.ts`, helper near 368–399; catch sites near 968 and 1022 | Records both the primary revision call and the optional continuation call | RPC receives only `p_event_class`; the same source output can have multiple distinct provider calls |
| `continuity-review` | `supabase/functions/continuity-review/index.ts`, helper near 123–145 | Records provider quota/503 from its review catch | RPC receives only `p_event_class` |
| `originality-review` | `supabase/functions/originality-review/index.ts`, helper near 186–210 | Records provider quota/503 from its review catch | RPC receives only `p_event_class` |
| `safety-review` | `supabase/functions/safety-review/index.ts`, helper near 144–170 | Records provider quota/503 from its review catch | RPC receives only `p_event_class` |
| `generation-orchestrator` | `supabase/functions/generation-orchestrator/index.ts`, helper near 44–69; fallback call sites in revision/generation handling | May re-record a child result after invoking `revise-chapter` or `generate-chapter` | Uses a read-before-write active-cooldown check, but this is explicitly best-effort and not idempotent; races remain possible |

The `review-orchestrator` stops additional review steps after provider-block responses; no direct throttle RPC write was found in its inspected source. `publication-review` likewise had no direct throttle writer in the inspected source. The current eight-function list is not claimed to be exhaustive: reconcile the remaining three entries in the master checklist's 11-writer count against actual branch paths before changing the shared contract.

## Confirmed candidate SQL mismatches

File: `supabase/migrations/20261016180000_atomic_gemini_provider_throttle.sql`

1. The `ON CONFLICT` update always adds one to `consecutive_throttle_count`, regardless of whether the event class is `quota` or `overload`. This violates the agreed rule that overload does not increment or reset the quota escalation counter.
2. The RPC signature only accepts `p_event_class`. Replaying the same observation calls the function again and increments again; the SQL comment already acknowledges this.
3. The orchestrator's read-before-write check cannot fix this: two concurrent orchestrator requests can both observe no active cooldown before either write commits.
4. Because direct writers and the orchestrator fallback can both observe the same downstream failure, the current architecture relies on timing to avoid duplicate counts.
5. The migration is a candidate file only. Its existence is not evidence that it was applied to any database.

## Stable identity: what can and cannot be assumed

- `output_id` alone is insufficient: revision has a primary generation call and potentially a continuation call, and the same output may be retried in a later invocation.
- A request header ID is useful for tracing but must not be assumed to remain stable across client retries unless the caller contract explicitly persists and reuses it.
- A generated timestamp or a fresh random ID per RPC retry would defeat deduplication.
- A deterministic composite such as `output_id + stage + call_index` is only safe if the stage/call index belongs to a persisted invocation/attempt record and remains stable on replay. It must not collapse two genuinely distinct provider calls in separate attempts.

## Recommended implementation boundary

1. Keep the provider-call-owning worker as the authoritative recorder for a given failed provider request. Treat orchestrator observations as control-flow signals, not a second event to count.
2. For fallback cases where a child definitely failed to persist the state, do not simply call the same non-idempotent RPC again. First introduce a stable, persisted observation identity that survives retries, or remove the fallback write and fail closed with an operational alert.
3. Add a dedicated event ledger or an equivalent unique-key mechanism in a separate candidate migration. The transaction must atomically claim an event ID and update provider state exactly once. A duplicate ID must return a duplicate/no-op result, not increment again.
4. Separate quota escalation from cooldown calculation: quota events advance the quota counter; overload events leave it unchanged and only extend the cooldown to at least the overload minimum. Every update must preserve a longer existing cooldown.
5. Validate current schema and original migration provenance before deciding whether to extend or replace existing tables/functions. Do not infer live schema from candidate migration text.
6. Add tests for direct worker retries, nested worker/orchestrator duplicate reports, same-ID concurrent replay, distinct-ID concurrent calls, mixed quota/overload concurrency, and failure to persist the event ledger.

## Verification performed

- Inspected the branch candidate migration and the listed function source files through the GitHub repository integration.
- Confirmed the direct writer call sites pass only `p_event_class` and that revision has two provider-call catch sites.
- Confirmed the orchestrator's fallback guard is a read-before-write check, not a database idempotency guarantee.
- No tests were executed in this source-audit step.
- No database, Edge Function, schedule, chapter, or publication state was changed.

## Gate

**Not ready for rollout.** Do not apply `20261016180000_atomic_gemini_provider_throttle.sql` until quota-only counter semantics, durable event identity, atomic deduplication, exact privileges, schema provenance, and disposable-PostgreSQL concurrency tests all pass.
