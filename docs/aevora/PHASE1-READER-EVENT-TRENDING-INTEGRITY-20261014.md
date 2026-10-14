# Aevora Phase 1 — Reader Event Abuse / Trending Integrity Review
Date: 2026-10-14
Status: read-only metadata finding; mitigation design required. No production changes.

## Finding

The live schema metadata shows that `public.reader_events` accepts anonymous/authenticated INSERTs under the existing `Public can record reader events` RLS policy. The check predicate validates visitor identifier shape and requires any supplied series/chapter references to point to published content. The table has indexes for series/time, event type/time, and visitor/time, but no uniqueness or rate-limit constraint that prevents repeated events from the same visitor.

The table's event-type CHECK constraint limits values to the expected reader event vocabulary, and progress is constrained to 0–100. Those constraints protect data shape, not event authenticity. Since public trending aggregates are computed from these events, a client can potentially inflate a series' opens, completions, follows, bookmarks, and trending score by submitting repeated valid-looking events. This is an integrity/abuse risk, not evidence that abuse has occurred.

## Immediate least-privilege containment

The branch-only migration `20261014150000_reader_events_insert_only.sql` narrows ordinary clients to INSERT only. It preserves the existing INSERT RLS policy and trusted `service_role` grants. It does not solve spam or prove that submitted events correspond to real reader behavior.

## Recommended design before treating engagement scores as trustworthy

1. **Choose the authoritative intake path.** Prefer a small Edge Function or database RPC that validates the event vocabulary, published-content relation, visitor/session identity, and allowed frequency. If direct anonymous INSERT remains, enforce the same rules in a database trigger so clients cannot bypass them.
2. **Add replay/frequency controls without blocking normal reading.** Use a bounded idempotency key or a server-defined dedupe window for countable events such as `story_open`, `chapter_start`, `chapter_complete`, `follow`, and `bookmark`. Treat progress updates as replaceable state or coarse time buckets rather than unlimited score increments.
3. **Separate operational events from ranking inputs.** Store raw telemetry if needed, but compute public ranking from deduplicated/validated aggregates. Consider minimum activity thresholds and caps so a single visitor cannot dominate a series.
4. **Avoid trusting caller-supplied semantics.** A public client should not be able to claim a completed chapter without a plausible progression sequence. Any stronger check should be designed to preserve privacy and anonymous reading.
5. **Test abuse cases.** Repeated same-event submissions, changed visitor IDs, invalid/unpublished series and chapter IDs, rapid progress spam, duplicate follow/bookmark events, and normal multi-chapter reading must all have explicit expected outcomes.
6. Do not add a blanket unique index or trigger until current frontend event behavior and desired counting semantics are documented. The present metadata review did not read event rows or invoke the intake path.

## Scope / decision gate

This remains a design item for Phase 1 integrity. No event was inserted, updated, or deleted; no trigger, policy, grant, view, or production migration was changed. The branch-only insert-only grant migration should not be applied to production until migration drift and the full migration set are reviewed and explicitly approved.
