# Phase 1 reader-event integrity checkpoint — 2026-10-14

## Verified live finding

The live INSERT policy on `public.reader_events` validates that any supplied series is ongoing/completed and that any supplied chapter is published. It does not validate that the chapter belongs to the supplied series. If both IDs are supplied, a caller can attempt to create a semantically inconsistent event unless another constraint or trigger prevents it.

The branch-only migration `20261014150000_reader_events_insert_only.sql` limits ordinary clients to INSERT at the table-privilege layer and retains row-level validation, but INSERT-only permissions do not establish event authenticity and do not prevent replay or high-volume spam.

## Required branch-only repair

Prepare a separate migration that recreates the existing INSERT policy while requiring:
- if `chapter_id` is supplied, `series_id` must also be supplied;
- the referenced chapter must match both supplied IDs (`chapters.id = chapter_id` and `chapters.series_id = series_id`);
- the referenced chapter must be published;
- any supplied series must remain ongoing/completed.

Do not deploy or apply this proposal until migration compatibility review and authorization.

## Required regression tests

1. Ongoing/completed series + published chapter from that same series: accepted.
2. Published chapter paired with a different series: rejected.
3. Chapter ID supplied without series ID: rejected.
4. Draft/unpublished chapter: rejected.
5. Draft/archived series: rejected.
6. Series-only event with an eligible series: accepted.
7. Anonymous/authenticated roles cannot SELECT, UPDATE, DELETE, TRUNCATE, or create triggers on raw reader events after the intended least-privilege migration.
8. Confirm service-role intake and existing reader flows remain compatible.

## Remaining abuse controls

The visitor identifier is client supplied and length checks do not prove uniqueness or authenticity. Trending remains vulnerable to replay/fabricated events unless intake adds deduplication, rate controls, and/or trusted server-side validation. These are separate from the relationship-integrity fix.

## Production safety

This is an audit checkpoint only. No production DDL, migrations, function deployments, schedule changes, chapter generation, or publication were performed.


## Exact live policy and effective privilege recheck (read-only, 2026-10-14)

A fresh catalog query confirmed the relationship gap and a more urgent table-level privilege drift:

- RLS is enabled on `public.reader_events`, but FORCE RLS is false; owner is `postgres`.
- The live policy `Public can record reader events` is INSERT-only at the policy-command level. It checks visitor ID length, an eligible supplied series, and a published supplied chapter—but it does not compare `chapters.series_id` with `reader_events.series_id`, nor require a series when a chapter is supplied.
- The foreign keys only validate that each ID independently exists. They do not enforce the chapter/series pair relationship.
- Despite the INSERT-only policy, effective table privileges currently report **SELECT, INSERT, and UPDATE = true** for both `anon` and `authenticated`. The policy has no SELECT/UPDATE policy, so RLS ordinarily denies those row operations; however, the grants are broader than intended and leave unnecessary privilege (and table-level UPDATE does not become safe just because a policy currently blocks row access).
- Both `public.reader_events_id_seq` and `public.aevora_engineering_events_id_seq` currently report `USAGE` for `anon` and `authenticated`. The branch-only sequence cleanup is not live.
- The branch-only `20261014150000_reader_events_insert_only.sql` and `20261014120000_lock_public_identity_sequence_grants.sql` are therefore relevant, but their absence from the migration ledger is not permission to apply them. Test identity inserts and sequence behavior in an isolated environment first.

**Priority update:** the live raw-event access model is not yet at the intended least-privilege state. Keep the aggregate RPC gated on the relationship repair, table/column ACL cleanup, sequence ACL cleanup, anti-replay/spam controls, and role-based regression tests. No production grants, policies, sequences, or data were changed by this check.


## Branch candidate and duplicate-migration cleanup (2026-10-14)

The branch now contains `20261014200000_validate_reader_event_series_chapter_pair.sql`, which recreates the INSERT policy with the required chapter/series match, requires a series when a chapter is supplied, and requires the chapter to be published while its series is ongoing/completed. Series-only events remain permitted.

A duplicate migration with the same timestamp was briefly created during parallel continuation. It was removed immediately, and the regression test now targets the single canonical migration file. The final branch tree must contain only one migration for timestamp `20261014200000`; CI is being checked against the latest commits.

The policy repair does not solve replay, forged visitor IDs, or high-volume spam. Those require separate deduplication and rate-control design and remain release blockers for trusting public trending aggregates. No production policy was changed.


## Client intake and trending abuse review (read-only, 2026-10-14)

The current browser tracker in `reading-progress.js` writes directly to `public.reader_events`. It generates a UUID in local storage for `visitor_id` and applies in-memory throttling (15 seconds for reading progress; 3 seconds for other event types). Those controls improve ordinary-client behavior but are not security controls: a caller can bypass the UI, clear storage, forge visitor IDs, and submit repeated events directly.

The live schema has no event-level idempotency key or unique constraint beyond the event row ID. Its indexes on `(visitor_id, created_at)`, `(series_id, created_at)`, and `(event_type, created_at)` support queries but do not prevent replay. There are no user-defined triggers on `reader_events` in the current catalog snapshot.

A further semantic issue exists in the prepared trending aggregate: the allowed event vocabulary includes `unfollow` and `unbookmark`, but a simple positive sum of `follow` and `bookmark` events ignores those reversals. It can therefore retain positive engagement after a reader unfollows or removes a bookmark, and repeated submissions can inflate the score. The aggregate is a discovery heuristic, not an authenticated count of unique readers.

### Required design before enabling public trending

1. Keep raw event intake INSERT-only for browser roles, with the chapter/series policy repair and table/column/sequence ACL cleanup.
2. Add an event idempotency contract, such as a client-generated event UUID persisted with each submission and a unique constraint; confirm retry semantics and migration backfill before choosing exact schema.
3. Apply server-side rate limits/quotas by trusted network/session signals where available. Do not treat the browser-supplied `visitor_id` as authenticated identity or rely on client-only throttling.
4. Define event semantics explicitly: dedupe opens/completions, bound progress updates, and compute follow/bookmark state from the latest per-visitor state or correctly net reversals rather than summing every historical positive event.
5. Add tests for duplicate event UUIDs, rapid repeated events, changing visitor IDs, follow→unfollow, bookmark→unbookmark, invalid progress, and chapter/series mismatch. Use an isolated database for policy/constraint behavior.
6. Recheck privacy/data-retention needs for visitor identifiers before collecting more detailed anti-abuse signals.

No raw event rows were queried; this review used only schema, policy, index, trigger, and browser-code metadata. No production change was made.
