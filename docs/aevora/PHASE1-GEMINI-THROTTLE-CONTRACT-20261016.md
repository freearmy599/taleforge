# Aevora Phase 1 — Gemini throttle contract decision

Date: 2026-10-16
Status: branch-only design decision; not production authorization
Scope: `aevora_record_gemini_throttle` and all Gemini provider-state writers.

## Decision

1. **Quota escalation counts quota events only.** HTTP 429 / explicit quota or rate-limit exhaustion may advance the consecutive quota counter. A transient overload (for example HTTP 503) must not increment or reset that counter. It receives a separate minimum one-hour cooldown. The effective cooldown is monotonic: an event must never shorten an already-active, longer cooldown.
2. **Unknown classification fails closed.** Only allowlisted event classes are accepted. Ambiguous provider failures do not silently become quota events. Raw provider response bodies, prompts, keys, and user content are never persisted as diagnostics.
3. **Duplicate observations need stable identity.** Each failed provider-call observation gets one event ID, assigned once when the failure is classified and before persistence is attempted. The same ID must be reused if persistence of that observation is retried. A new provider-call attempt gets a new ID. The child that performed the provider call owns persistence; the parent orchestrator observes the structured result and must not record the same failure again. A ledger must atomically deduplicate the ID and update provider state in one transaction.
4. **Malformed state is not repaired implicitly.** Null, negative, non-integer, unsafe, or otherwise invalid counters fail closed. Do not normalize corrupt values to zero. A separately reviewed operator repair may be designed later with evidence and auditability.
5. **Cooldown and counter have distinct meanings.** Cooldown is the current provider backoff boundary; quota counter measures consecutive quota-class events. Overload updates safe diagnostic fields and cooldown, but does not affect quota escalation.
6. **Concurrency must be atomic.** Concurrent first inserts and updates must preserve all distinct quota events, enforce idempotency for repeated event IDs, and never shorten an existing cooldown. Mixed quota/overload concurrency must preserve these rules.

## Required tests before implementation is accepted

- First quota event establishes counter 1 and the documented initial cooldown.
- Consecutive quota events escalate according to the approved cap; the cap is never exceeded.
- Overload-only events leave quota counter unchanged and establish at least one hour of cooldown.
- An overload event does not reduce a longer quota cooldown; a quota event does not reduce a longer overload cooldown.
- Same event ID replayed serially and concurrently is recorded once.
- Distinct event IDs under concurrent first insertion preserve the exact count.
- Unknown/null event class rejects without changing state.
- Negative, null, fractional, unsafe, and malformed persisted counters fail closed without mutation.
- Error diagnostics are allowlisted and contain no provider response body or user content.
- Effective EXECUTE grants remain service-role-only; client roles and PUBLIC cannot call the privileged RPC.
- Edge Runtime compatibility and live-schema compatibility are verified separately from static source contracts and disposable PostgreSQL.

## Implementation boundary

This document defines the acceptance contract. The earlier candidate migration `20261016180000_atomic_gemini_provider_throttle.sql` was not compliant because it had no event identifier and counted overloads toward quota escalation. A newer branch-only candidate `20261016190000_idempotent_gemini_provider_throttle.sql` now implements the event ledger and quota-only counter rule; it remains unvalidated until the updated CI and disposable PostgreSQL rehearsal finish. No production database, deployed functions, schedules, or publication state were changed.

## Remaining prerequisite

Implementation follow-up: ten direct provider-call owners now supply one UUID per caught provider failure, and `generation-orchestrator` no longer has a fallback writer. The event ledger and updated rehearsal are branch-only; source, disposable PostgreSQL, runtime, ACL, and live-schema validation remain separate rollout gates.
