# Phase 1 reader-event abuse-control design — 2026-10-14

## Status and boundary

Design checkpoint for the still-incomplete abuse controls. Branch-only relationship-integrity, INSERT-only ACL, event-idempotency, and server-timestamp migrations now have disposable-PostgreSQL regression coverage, along with browser retry, progress dedupe, and event-vocabulary contracts. These controls reduce accidental duplicates and timestamp manipulation but do not replace trusted intake or quotas, and they do not authorize production schema changes. No production event rows were read, no intake endpoint was called, and no database mutation was performed. The current public trending aggregate must remain gated until deduplication, rate limiting, and relationship integrity are addressed together.

## Verified schema contract (read-only catalog inspection)

The current `public.reader_events` columns are:

- `id bigint GENERATED ALWAYS AS IDENTITY`, primary key, no client-supplied default.
- `visitor_id text NOT NULL`.
- `event_type text NOT NULL`, constrained to `story_open`, `chapter_start`, `reading_progress`, `chapter_complete`, `follow`, `unfollow`, `bookmark`, `unbookmark`.
- `series_id uuid NULL` and `chapter_id uuid NULL`, each with an independent foreign key; there is no composite relationship constraint.
- `progress_percent smallint NULL`, constrained to 0–100 when present.
- `created_at timestamptz NOT NULL DEFAULT now()`.

The original live table has no client event UUID, idempotency token, or unique constraint that deduplicates repeated logical events; the branch-only migration adds an optional UUID and unique partial index. Indexes support time/visitor/series/event queries but do not enforce a replay contract. The branch relationship migration now requires every event to identify an eligible series, requires any supplied chapter to belong to that same series and be published, and preserves series-only events. It still does not provide authenticity, deduplication, or rate limiting.

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
2. `reading-progress.js` now creates an event UUID when supported and retains the pending UUID in page memory if the insert fails, so a retry of the same event key reuses it. A successful insert or a duplicate-key response clears the pending key. The pending map is not persisted across reloads, so this is a limited retry contract rather than a durable client queue. Successful/duplicate progress values are also deduplicated in a page-session set so repeated scroll callbacks at the same rounded percentage do not keep creating fresh UUIDs; this is still not durable across reloads. The behavior and repeat-value suppression tests passed in [run `38550665636`](https://github.com/freearmy599/taleforge/actions/runs/38550665636).
3. The disposable PostgreSQL replay verifies duplicate UUID rejection, legacy NULL compatibility, INSERT-only table grants, and identity-generated inserts after direct sequence access is revoked. GitHub Actions run [`38548574598`](https://github.com/freearmy599/taleforge/actions/runs/38548574598) passed the disposable PostgreSQL migration assertions, Edge source validation, and reader-event idempotency contract tests, including progress-specific retry-key behavior.
4. Keep this field separate from `visitor_id`: rotating a visitor ID must not make a replay of the same event UUID count twice.
5. A two-session disposable PostgreSQL race now submits the same UUID concurrently and asserts exactly one insert succeeds while the competing insert receives the named unique-index violation. GitHub Actions run [`38550347974`](https://github.com/freearmy599/taleforge/actions/runs/38550347974) passed this concurrency rehearsal.
6. A behavioral browser-source test now exercises failed-insert retry UUID reuse and distinct progress-value keys. GitHub Actions run [`38550465786`](https://github.com/freearmy599/taleforge/actions/runs/38550465786) passed the test alongside the full Edge validation workflow.
7. This only prevents duplicate submissions that reuse the same UUID. It does **not** prevent spoofing, spam with fresh UUIDs, or authenticated-looking anonymous activity. The public trending aggregate remains gated until trusted intake and quotas are implemented and reviewed.
8. Branch migration `20261014230000_reader_event_server_timestamp.sql` adds a `BEFORE INSERT` trigger that replaces `created_at` with statement time for `anon` and `authenticated` callers, while preserving trusted service-role timestamps. The disposable PostgreSQL assertions now attempt both past and future client timestamps and require both to be replaced; they also verify trusted service-role timestamps are preserved. GitHub Actions run [`38551270523`](https://github.com/freearmy599/taleforge/actions/runs/38551270523) passed the disposable PostgreSQL rehearsal. This narrows timestamp manipulation but does not authenticate event content or stop high-volume fresh-UUID submissions.
9. The browser event vocabulary contract caught a mismatch: bookmark removal emitted `bookmark_remove`, while the database accepts `unbookmark`. The client now emits `unbookmark`, and GitHub Actions run [`38551343943`](https://github.com/freearmy599/taleforge/actions/runs/38551343943) passed the vocabulary regression check.

### Stage C — trusted intake and quotas

Direct browser-to-table INSERT is not a sufficient anti-abuse boundary. Move new submissions behind a narrowly scoped intake endpoint that validates the payload and writes using server credentials. Keep service credentials server-side only.

- Enforce payload size, event-type allowlist, progress range, eligible series/chapter relationship, and timestamp assignment on the server. Ignore/reject client-supplied `created_at` if present; do not let callers backdate events.
- Apply short-window and daily quotas using a server-controlled limiter. Use only request metadata supplied by the trusted gateway as a network signal; never trust arbitrary client-provided IP headers. Hash or minimize retained identifiers and define a retention period before storing more anti-abuse data.
- A caller can still forge anonymous actions. Rate limits reduce abuse; they do not turn anonymous engagement into authenticated readership. Avoid describing the resulting counts as unique verified readers.
- Keep the existing direct insert path only during a controlled compatibility window, if needed; define its sunset and test that it cannot bypass new quotas before calling the rollout complete.

### Stage D — stateful engagement semantics

The branch-only trending aggregate now resolves follow/unfollow and bookmark/unbookmark as latest state per visitor and target, rather than adding every positive event forever. Active state counts persist beyond the 30-day score window, while only recent state changes contribute decayed score. Future-dated events are excluded from recent scores and from state ordering. The disposable PostgreSQL fixture seeds follow → unfollow and bookmark → unbookmark transitions, confirms only active states are counted, and verifies future-dated opens do not inflate recent opens. Full GitHub Actions run [`38552076374`](https://github.com/freearmy599/taleforge/actions/runs/38552076374) passed.

This remains a branch-only aggregate. Keep it gated until trusted intake and quotas prevent direct-insert bypass/spam, and until the event retention and anonymous-identity limitations are accepted.

Do not treat the current branch aggregate as abuse-proof. Remaining controls before trusting public ranking:

- **Opens / chapter starts:** UUID retries are deduplicated, but server-side per-visitor/series cooldowns and contribution caps are not implemented.
- **Reading progress:** repeated rounded values are deduplicated in page memory, but this is not durable and does not stop scripted fresh-key submissions; use bounded server-side time buckets or maximum/latest progress per window.
- **Chapter completion:** no server-side one-completion-per-visitor/chapter rule exists yet.
- **Follow / unfollow and bookmark / unbookmark:** latest-state semantics are implemented in the branch aggregate, but forgeable/rotatable visitor IDs can still inflate apparent distinct state.
- **Ranking:** per-visitor contribution caps and trusted-intake quotas remain unimplemented. Keep ranking explicitly heuristic and do not enable the public aggregate in production until these controls are designed and tested.

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
