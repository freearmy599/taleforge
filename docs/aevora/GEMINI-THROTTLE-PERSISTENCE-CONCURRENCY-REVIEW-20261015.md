# Aevora Gemini throttle persistence concurrency review — 2026-10-15

## Status

**Known reliability gap; no production changes.** The generation orchestrator's fallback throttle recorder currently reads `consecutive_throttle_count` and `cooldown_until`, calculates a new count/cooldown in application code, then upserts the provider row. Two concurrent workers can read the same prior count and overwrite each other's increments. Depending on timing, a later write may also replace a longer cooldown with a shorter proposed cooldown if the first write is no longer observed as active at read time.

The fallback only records Gemini HTTP 429 / `RESOURCE_EXHAUSTED` and HTTP 503. Direct worker paths normally record their own cooldown. This reduces the frequency of the race but does not remove it. The existing top-level orchestration guard fails closed when provider state is missing, unreadable, or malformed; preserve that behavior.

## Evidence in current source

In `supabase/functions/generation-orchestrator/index.ts`, `recordGeminiThrottle`:
1. selects `cooldown_until,consecutive_throttle_count` for provider `gemini`;
2. derives `count = prior + 1` in TypeScript;
3. calculates the cooldown duration using that derived count;
4. writes the row with `upsert(..., { onConflict: "provider" })`.

This is a read/modify/write sequence rather than one atomic database operation. The repository's tracked migrations include the server-only grant lock for `taleforge_ai_provider_state`, but do not define the table's canonical creation/schema migration. Therefore a new RPC must not be authored against assumed constraints or column types without first verifying the canonical live schema and repository history.

## Safe repair path

1. Obtain the canonical schema for `taleforge_ai_provider_state` from the repository's source of truth and a read-only production schema audit, when authorized. Do not query or mutate production as part of this branch-only task.
2. Add a narrowly scoped server-only RPC to atomically increment the throttle count and extend cooldown. The SQL operation should lock/update the single `provider='gemini'` row; calculate the next count inside the transaction; and set `cooldown_until` to the later of the existing deadline and the new proposed deadline. It must never shorten an active cooldown.
3. Treat unknown throttle kinds, malformed state, missing row, and database errors as a fail-closed persistence result. Do not leak provider response bodies or database diagnostics.
4. Pin `search_path`, schema-qualify objects, revoke execution from `PUBLIC`, `anon`, and `authenticated`, and grant only to the intended trusted server role(s). Check owner-level default privileges separately.
5. Replace the fallback read/modify/write with the RPC and retain existing per-worker cooldown guards.
6. Add SQL rehearsal and contract tests for concurrent increments, never-shortened cooldown, malformed state, missing row, permissions, and safe errors. Use disposable PostgreSQL only.

## Required race tests

- Two simultaneous quota-throttle recordings starting from count 0 produce a final count of 2, not 1.
- Concurrent cooldown proposals retain the latest/later deadline; no interleaving shortens an already-active cooldown.
- A 503 overload event and a 429 quota event serialize without losing either count increment.
- RPC failure does not permit subsequent AI work; the existing fail-closed provider-state policy remains effective.
- No client role can execute the RPC or read/write the provider-state table directly.

## Release decision

This race is a reliability hardening item and should be repaired before relying on throttle streaks for cost protection. Do not add an RPC until the table schema and existing owner/default-privilege assumptions are verified. No production migration, deployment, generation, publication, schedule mutation, or billable Supabase branch is authorized by this note.
