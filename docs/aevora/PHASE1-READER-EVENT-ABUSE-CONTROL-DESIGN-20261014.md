# Phase 1 reader-event abuse-control design — 2026-10-14

## Status and boundary

Design checkpoint for the still-unimplemented abuse controls. Branch-only relationship and INSERT-only migrations now have disposable-PostgreSQL regression coverage, but this does not authorize production schema changes. No production event rows were read, no intake endpoint was called, and no database mutation was performed. The current public trending aggregate must remain gated until deduplication, rate limiting, and relationship integrity are addressed together.

## Verified schema contract (read-only catalog inspection)

The current `public.reader_events` columns are:

- `id bigint GENERATED ALWAYS AS IDENTITY`, primary key, no client-supplied default.
- `visitor_id text NOT NULL`.
- `event_type text NOT NULL`, constrained to `story_open`, `chapter_start`, `reading_progress`, `chapter_complete`, `follow`, `unfollow`, `bookmark`, `unbookmark`.
- `series_id uuid NULL` and `chapter_id uuid NULL`, each with an independent foreign key; there is no composite relationship constraint.
- `progress_percent smallint NULL`, constrained to 0–100 when present.
- `created_at timestamptz NOT NULL DEFAULT now()`.

The table has no client event UUID, idempotency token, or unique constraint that deduplicates repeated logical events. Indexes support time/visitor/series/event queries but do not enforce a replay contract. The branch relationship migration now requires every event to identify an eligible series, requires any supplied chapter to belong to that same series and be published, and preserves series-only events. It still does not provide authenticity, deduplication, or rate limiting.

## Branch-only runtime verification (2026-10-14)

The branch now rehearses the identity-sequence ACL migration, INSERT-only table grants, and relationship policy together on disposable PostgreSQL 17. The regression script verifies:

- Ordinary roles retain INSERT but lose raw SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges.
- Direct client access to the identity sequence is revoked while identity-generated inserts continue to work.
- Matching published chapter/series pairs, eligible series-only events, and completed-series events are accepted.
- Mismatched pairs, chapter events without a series, events without a series, unpublished chapters, ineligible series, and undersized visitor IDs are rejected.
- The raw event table remains unreadable to anon/authenticated roles.

GitHub Actions run [38547727704](https://github.com/freearmy599/taleforge/actions/runs/38547727704) passed the disposable PostgreSQL replay and the branch's prepared Edge Function/source-contract validation. This is not a Supabase-managed environment test, and it does not address spoofed-but-valid event payloads, random-UUID replay, per-visitor quotas, or trusted intake.

## Recommended staged design

### Stage A — keep the current read API gated

Before enabling `get_public_story_trending_scores()`, require the chapter/series policy repair, relation and column ACL cleanup, identity-sequence behavior test, and ordinary-role regression suite. Do not treat visitor IDs as verified identity. Do not expose raw event rows to clients.

### Stage B — idempotency contract (branch implementation added; rollout still gated)

1. Branch migration `20261014220000_reader_event_idempotency_key.sql` adds nullable `event_uuid uuid` and a partial unique index. Historical rows remain NULL; no fabricated identifiers are backfilled.
2. `reading-progress.js` now creates an event UUID when supported and retains the pending UUID in page memory if the insert fails, so a retry of the same event key reuses it. A successful insert or a duplicate-key response clears the pending key. The pending map is not persisted across reloads, so this is a limited retry contract rather than a durable client queue.
3. The disposable PostgreSQL replay verifies duplicate UUID rejection, legacy NULL compatibility, INSERT-only table grants, and identity-generated inserts after direct sequence access is revoked. GitHub Actions run `38548320860` passed the runtime migration assertions and Edge source validation.
4. Keep this field separate from `visitor_id`: rotating a visitor ID must not make a replay of the same event UUID count twice.
5. This only prevents duplicate submissions that reuse the same UUID. It does **not** prevent spoofing, spam with fresh UUIDs, or authenticated-looking anonymous activity. The public trending aggregate remains gated until trusted intake and quotas are implemented and reviewed.

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
