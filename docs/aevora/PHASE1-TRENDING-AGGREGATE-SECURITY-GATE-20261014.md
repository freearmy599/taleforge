# Aevora Phase 1 — Trending Aggregate Security Gate

Date: 2026-10-14  
Status: branch-only review; production rollout blocked pending verification.

## Scope

Reviewed the branch-only migrations:

- `20261014130000_public_trending_aggregate_rpc.sql`
- `20261014150000_reader_events_insert_only.sql`

This was a source-level review only. No database function was invoked, no reader-event rows were queried, and no production state was changed.

## Positive controls present in source

- The aggregate function has no caller-supplied parameters.
- It declares `SECURITY DEFINER` and fixes `search_path` to `pg_catalog`; referenced application relations are schema-qualified.
- The return contract is explicitly declared as 12 columns.
- The query limits returned series to `ongoing` and `completed`.
- Raw `reader_events` access is not granted to ordinary clients by these migrations; the intake migration grants INSERT only.
- The aggregate function has explicit EXECUTE grants, and the discovery views retain their intended SELECT grant.
- The event aggregation window is bounded to the last 30 days.

These source-level properties do not by themselves prove the deployed role ownership, RLS behavior, or effective PostgREST behavior.

## Required rollout gates

### 1. Verify function owner and RLS bypass behavior

The aggregate function reads `public.reader_events` while running with its owner's privileges. Before rollout, inspect the function owner, table owner, `relrowsecurity`, `relforcerowsecurity`, and effective privileges. Confirm in a disposable/local database that the function returns aggregates for an ordinary caller while raw event SELECT remains denied. If the function owner is subject to row security, verify that behavior explicitly; do not solve it by granting public SELECT on raw events.

### 2. Verify the view's effective API behavior

The view is declared `security_invoker = true` and delegates to a `SECURITY DEFINER` function. Test the actual PostgREST endpoint with anonymous and authenticated roles after applying the migration to a disposable environment. Confirm:
- the view still returns the exact 12-column contract expected by the Explore page;
- ordinary clients can read aggregate discovery results;
- ordinary clients cannot select raw reader events or execute unrelated internal functions;
- no unpublished/draft series appear;
- errors fail closed rather than exposing event-level data.

### 3. Reconcile view dependencies and column types

Before replacing the existing view, compare the live view definition, output column names/order/types, dependent views/functions, and frontend query fields. A `CREATE OR REPLACE VIEW` may fail if existing output types or column ordering differ. Do not assume the documented 12-column contract covers every dependency.

### 4. Ranking integrity remains unresolved

The aggregate currently counts accepted client-submitted events. INSERT-only privileges do not prevent event spam, replay, or fabricated visitor IDs. Until deduplication and rate limits are implemented and tested, treat the score as a heuristic rather than verified engagement. Do not add a blanket unique index or behavior-changing trigger without first confirming current frontend event semantics.

### 5. Privilege and migration compatibility

The separate reader-event migration revokes table and column privileges from `PUBLIC`, `anon`, and `authenticated`, then grants INSERT. Confirm identity-column inserts still work with sequence grants and the existing RLS policy. Verify that the migration role can alter the view/function and that explicit `service_role` access remains correct. The broader default-privilege finding is not addressed by these two migrations.

## Decision

**Do not apply these migrations to production yet.** The source contains useful least-privilege controls, but owner/RLS behavior, API behavior, dependent-view compatibility, and event-abuse controls remain rollout gates. Next validation should use local/disposable SQL and contract tests, not a live dispatch, generation, or publication.

No production migrations, permissions, schedules, Edge Functions, queue state, or reader events were changed during this review.


## Fail-closed access gate added — 2026-10-15

A source review found that the earlier branch migration granted the aggregate function and story_trending_scores view to ordinary client roles even though this document and the reader-event abuse-control design said public ranking must remain gated until trusted intake and quotas exist. That mismatch is now corrected on the branch:

- get_public_story_trending_scores() EXECUTE is granted only to service_role; PUBLIC, anon, and authenticated remain revoked.
- story_trending_scores SELECT is granted only to service_role; ordinary clients cannot read the ranking view yet.
- story_intelligence remains an explicitly public, read-only surface.
- Static contract tests and the disposable PostgreSQL ACL assertion now require this closed gate.

This intentionally defers public trending availability. Do not re-enable client access until trusted intake, per-visitor contribution caps/cooldowns, chapter-completion dedupe, compatibility checks, and rollout approval are complete. This is a branch-only correction; no production changes were made.
