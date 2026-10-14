# Aevora Phase 1 — Trending View Compatibility Gate
Date: 2026-10-14
Status: branch-only compatibility review; no production changes.

## Live view contract observed

A read-only `pg_get_viewdef`/catalog inspection confirmed these current public discovery view shapes:

- `story_trending_scores`: 12 columns — `series_id, title, subtitle, description, status, published_at, trending_score, opens, completions, follows, bookmarks, latest_activity`.
- `story_intelligence`: 22 columns — the public series metadata and chapter recency fields, followed by `trending_score, opens, completions, event_follows, bookmarks, intelligence_status`.
- `story_intelligence` joins `story_trending_scores`; it does not directly join `reader_events`. Its definition is security-invoker.

## Compatibility conclusion

The branch proposal `20261014130000_public_trending_aggregate_rpc.sql` declares the same 12 output names and order as the currently observed `story_trending_scores` view, then recreates that view as a security-invoker view over a fixed, parameterless `SECURITY DEFINER` aggregate function. The aggregate function reads `reader_events` internally and returns series-level aggregates only. This is the intended compatibility path for the separate insert-only client grant migration: callers need SELECT on the discovery view and EXECUTE on the fixed function, not SELECT on raw reader events.

The migration does not recreate `story_intelligence`; it revokes and restores SELECT on that existing view. Since that view joins `story_trending_scores`, preserve the exact trending-view column contract and confirm the existing 22-column intelligence contract with an integration check before any rollout.

## Remaining integrity limitation

This design is an access-boundary improvement, not an anti-abuse solution. Repeated valid-looking event submissions can still inflate the aggregate. Do not present its score as trusted until the event intake has deduplication/frequency controls and abuse-case tests.

## Validation and safety boundary

- The compatibility conclusion is based on live view metadata plus source inspection; the proposed migration was not executed against production.
- Add static contract assertions for the exact 12 output columns and ensure no direct client SELECT is restored on `reader_events`.
- Before rollout, use a disposable non-billable local/test database or reviewed CI integration environment to verify view creation, output column order, `story_intelligence` compatibility, and permissions. Do not create a billable Supabase branch.
- No production view, function, grant, RLS policy, migration history, or reader-event row was changed.
