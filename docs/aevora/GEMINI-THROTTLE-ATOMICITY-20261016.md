# Aevora Phase 1 — Gemini throttle persistence atomicity audit (2026-10-16)

## Status

**Open hardening item. Branch-only audit note; no database or production changes.**

The current `generation-orchestrator` fallback recorder performs a read-modify-upsert against `taleforge_ai_provider_state`. It reads `cooldown_until` and `consecutive_throttle_count`, calculates the next count/cooldown in TypeScript, then upserts on `provider`. The active-cooldown early return protects an already-active cooldown from being shortened and avoids double-counting when the read sees an active cooldown. It does not make the transition atomic.

## Race

Two workers can both read the same expired/empty state and the same prior counter. Each computes the same next counter and performs an upsert. One increment can be lost. Their computed cooldowns can also race, so application-side `Math.max` against a stale value is not a concurrency guarantee.

The orchestration entry guard currently fails closed when provider-state lookup is missing or errors, and stops further AI-dependent work after observing a throttle. Preserve those guards while repairing persistence.

## Required evidence before implementation

1. Establish the canonical definition of `taleforge_ai_provider_state` from tracked migrations or an authorized, read-only catalog inventory: columns and types, primary/unique key, owner, RLS/policies, grants, existing triggers, and all routines that write this row.
2. Confirm which deployed functions already persist provider cooldowns so the orchestrator fallback does not count a single provider response twice.
3. Do not infer this table's schema from application queries alone. Do not apply a production migration, deploy functions, create a billable Supabase branch, or run generation/publication to investigate.

## Atomic repair contract

Implement a narrowly scoped server-only database routine only after schema provenance is complete. The transition must occur inside one database transaction and serialize on the single Gemini provider-state row (or use an equivalent atomic conditional update). The routine must:

- Validate the provider key and the failure category against a small allowlist.
- Check the current row while holding the lock; if a cooldown is still active, preserve it and follow the documented no-double-count behavior.
- Otherwise increment the stored throttle counter atomically and derive the new cooldown from the incremented value, not from a stale client read.
- Never shorten a still-active cooldown; malformed stored timestamps or unexpected missing state must fail closed rather than reset the counter.
- Set the diagnostic error fields and `updated_at` in the same transaction.
- Pin `search_path`, schema-qualify objects, revoke execution from `PUBLIC`, `anon`, and `authenticated`, and grant only the trusted server role.
- Return a minimal outcome distinguishing updated, active cooldown preserved, and safe rejection/error without leaking internal database diagnostics.

The exact SQL types, function signature, owner, and grants remain intentionally unspecified until canonical schema evidence is available.

## Required disposable-PostgreSQL tests

- Many concurrent calls against an expired/missing cooldown produce the expected serialized count (or the explicitly documented count semantics) without lost updates.
- A concurrent call cannot shorten an active cooldown.
- Active cooldown behavior does not double-count one already-persisted provider response.
- 429 and 503 paths apply the intended cooldown durations.
- Invalid provider/failure inputs, malformed timestamps, missing state, and database errors fail closed.
- Routine privileges, owner, pinned search path, and default-privilege assumptions are asserted.
- The Edge Function contract test verifies the orchestrator calls the atomic routine and no longer performs a client-side read-modify-upsert.

## Release gate

This item remains open until the canonical schema evidence, atomic routine, concurrency/privilege rehearsal, and Edge Function integration are all reviewed and green. A green branch CI run alone does not establish production schema compatibility. Automated publication remains **NO-GO** independently until the publication commit-boundary RPC is implemented and rehearsed.
