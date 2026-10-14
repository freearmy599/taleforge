# Phase 1 reader-event abuse-control design — 2026-10-14

## Status and boundary

Design checkpoint only. This file does not implement or authorize a schema change. No production event rows were read, no intake endpoint was called, and no database mutation was performed. The current public trending aggregate must remain gated until the abuse controls and relationship repair are tested together.

## Verified schema contract (read-only catalog inspection)

The current `public.reader_events` columns are:

- `id bigint GENERATED ALWAYS AS IDENTITY`, primary key, no client-supplied default.
- `visitor_id text NOT NULL`.
- `event_type text NOT NULL`, constrained to `story_open`, `chapter_start`, `reading_progress`, `chapter_complete`, `follow`, `unfollow`, `bookmark`, `unbookmark`.
- `series_id uuid NULL` and `chapter_id uuid NULL`, each with an independent foreign key; there is no composite relationship constraint.
- `progress_percent smallint NULL`, constrained to 0–100 when present.
- `created_at timestamptz NOT NULL DEFAULT now()`.

The table has no client event UUID, idempotency token, or unique constraint that deduplicates repeated logical events. Indexes support time/visitor/series/event queries but do not enforce a replay contract. The relationship-policy candidate addresses only the chapter/series mismatch; it does not provide authenticity, deduplication, or rate limiting.

## Recommended staged design

### Stage A — keep the current read API gated

Before enabling `get_public_story_trending_scores()`, require the chapter/series policy repair, relation and column ACL cleanup, identity-sequence behavior test, and ordinary-role regression suite. Do not treat visitor IDs as verified identity. Do not expose raw event rows to clients.

### Stage B — idempotency contract (requires a separate schema migration)

1. Add a nullable `event_uuid uuid` field for client-generated event identity. Keep it nullable initially so historical rows do not need fabricated identifiers.
2. Add a partial unique index on `event_uuid` where it is not null. If product semantics require idempotency to be scoped by visitor, use a composite unique key only after the contract is explicitly chosen; do not silently mix the two models.
3. New clients generate one UUID per logical event and reuse that UUID for retries of the same event. A deliberate new reading action gets a new UUID. Server-side inserts should use `INSERT ... ON CONFLICT DO NOTHING` (or return a clear duplicate response) so retries do not inflate aggregates.
4. Keep this field separate from `visitor_id`: rotating a visitor ID must not make a replay of the same event UUID count twice.
5. Test migration against existing data and concurrent duplicate submissions before any rollout. Existing rows remain nullable and are not backfilled with invented event identities.

### Stage C — trusted intake and quotas

Direct browser-to-table INSERT is not a sufficient anti-abuse boundary. Move new submissions behind a narrowly scoped intake endpoint that validates the payload and writes using server credentials. Keep service credentials server-side only.

- Enforce payload size, event-type allowlist, progress range, eligible series/chapter relationship, and timestamp assignment on the server. Ignore/reject client-supplied `created_at` if present; do not let callers backdate events.
- Apply short-window and daily quotas using a server-controlled limiter. Use only request metadata supplied by the trusted gateway as a network signal; never trust arbitrary client-provided IP headers. Hash or minimize retained identifiers and define a retention period before storing more anti-abuse data.
- A caller can still forge anonymous actions. Rate limits reduce abuse; they do not turn anonymous engagement into authenticated readership. Avoid describing the resulting counts as unique verified readers.
- Keep the existing direct insert path only during a controlled compatibility window, if needed; define its sunset and test that it cannot bypass new quotas before calling the rollout complete.

### Stage D — stateful engagement semantics

Do not score every positive follow/bookmark event as a permanent additive action. A follow or bookmark represents state, and its inverse removes that state. Recommended public score inputs:

- **Opens / chapter starts:** deduplicated per event UUID, with an optional per-visitor/series cooldown for repeated opens.
- **Reading progress:** retain only a bounded number of meaningful updates per visitor/chapter/time bucket, or compute the maximum/latest valid progress per window; never count every heartbeat as a separate full engagement action.
- **Chapter completion:** count at most once per visitor/chapter within the chosen retention window.
- **Follow / unfollow and bookmark / unbookmark:** derive current state from the latest valid event per visitor/series/action, or maintain an idempotent state table updated through the trusted intake path. Do not use a positive-only sum that ignores reversals.
- **Ranking:** cap each visitor's contribution to a series within a window, apply time decay after deduplication/state resolution, and keep the ranking an explicitly heuristic discovery signal.

A stable anonymous visitor ID is still forgeable and can be rotated; it is a deduplication hint, not proof of personhood. Stronger uniqueness guarantees would require an explicit account/session product decision.

## Required isolated test matrix

1. Same event UUID submitted twice sequentially: one logical event contributes.
2. Same event UUID submitted concurrently: exactly one accepted logical event.
3. Retry after timeout with the same UUID: no score increase.
4. Same visitor, different UUIDs for repeated opens: cooldown/cap behavior is deterministic.
5. Visitor ID changes but event UUID is reused: still deduplicated.
6. `follow → unfollow` leaves current follow state false; `bookmark → unbookmark` leaves bookmark state false.
7. Out-of-order state events are handled by a documented server timestamp/sequence policy; clients cannot force ordering with arbitrary timestamps.
8. Invalid event type, progress below 0/above 100, invalid series/chapter pair, unpublished chapter, and ineligible series are rejected.
9. Anonymous callers cannot read/update/delete/truncate raw events or bypass the trusted intake quota through direct INSERT.
10. Service-role workflows remain compatible; service credentials never enter browser bundles.
11. Event retention and deletion behavior remain correct when a series/chapter is removed, and aggregation does not resurrect deleted or ineligible content.
12. Aggregate output contract remains unchanged and contains only approved public series fields and derived counts.

## Release gate / decision record

Do not combine all controls into one unreviewable migration. Separate the relationship/ACL repair from the idempotency schema change, then introduce trusted intake and stateful aggregate semantics with regression coverage. Each stage needs a disposable-database test and a compatibility check against the live browser client before release.

No production changes, deployments, migrations, schedule changes, generation, or publication were performed for this design checkpoint.
