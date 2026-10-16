# Aevora Phase 1 — Gemini throttle contract decision

Date: 2026-10-16
Status: branch-only design decision; not production authorization
Scope: `aevora_record_gemini_throttle` and all Gemini provider-state writers.

## Decision

1. **Quota escalation counts quota events only.** HTTP 429 / explicit quota or rate-limit exhaustion may advance the consecutive quota counter. A transient overload (for example HTTP 503) must not increment or reset that counter. It receives a separate minimum one-hour cooldown. The effective cooldown is monotonic: an event must never shorten an already-active, longer cooldown.
2. **Unknown classification fails closed.** Only allowlisted event classes are accepted. Ambiguous provider failures do not silently become quota events. Raw provider response bodies, prompts, keys, and user content are never persisted as diagnostics.
3. **Duplicate observations need stable identity.** Each actual provider-call attempt must receive one event ID before the call, and that same ID must be reused if the persistence of that observation is retried. Prefer a persisted job/attempt identity where one exists; otherwise an opaque UUID may be assigned once per provider-call attempt, retained through the catch/persistence path, and returned to any parent fallback. Never regenerate an ID when retrying persistence for the same observation. A new provider-call attempt gets a new ID. The parent orchestrator must reuse the child's event ID rather than create a second observation. A ledger must atomically deduplicate the ID and update provider state in one transaction.
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

This document records the intended contract only. It does not change the RPC, migrations, production database, deployed functions, schedules, or publication state. The existing candidate RPC is explicitly not compliant with the idempotency requirement yet: it has no event identifier and increments once per invocation. Its current behavior must not be described as duplicate-safe.

## Remaining prerequisite

Before changing the candidate SQL, inspect all branch writers and callers to identify a trustworthy stable event key and the exact classification available at each catch site. If a safe key cannot be propagated consistently, introduce an auditable event-ledger design in a separate candidate migration and rehearse it in disposable PostgreSQL before considering rollout.
