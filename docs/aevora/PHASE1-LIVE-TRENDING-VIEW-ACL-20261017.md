# Aevora Phase 1 — Live trending/intelligence view ACL review

**Date:** 2026-10-17  
**Scope:** Read-only Supabase catalog and branch-source review. No live grants, policies, data, or function definitions were changed.

## Live catalog findings

- `public.story_trending_scores` and `public.story_intelligence` are views with `security_invoker=true`.
- Both currently have effective table-level SELECT for `anon` and `authenticated`; neither view has RLS of its own (expected for views).
- `public.reader_events` has RLS enabled, client SELECT grants, and only the `Public can record reader events` INSERT policy in the inspected policy inventory; it has no client SELECT policy.
- `public.series` has a public SELECT policy, and `public.chapters` has a published-chapter SELECT policy.
- The live `story_trending_scores` definition aggregates `reader_events` directly. Because the view is security-invoker, client calls evaluate that source under the caller's RLS; the missing reader-event SELECT policy means ordinary client requests cannot see event rows in the aggregate. The view can still return eligible series metadata with zero-valued aggregate metrics. This is a functional/readiness mismatch rather than evidence that individual reader events are exposed.
- `public.get_public_story_trending_scores()` does not exist in the live catalog. The live migration ledger remains at `20261010161919`; the branch candidate is not deployed.

## Branch containment and browser behavior

- Candidate migration `20261014130000_public_trending_aggregate_rpc.sql` creates a fixed, parameterless, SECURITY DEFINER aggregation function, explicitly validates chapter/series relationships and published status, limits repeat contributions, and grants function EXECUTE only to `service_role`.
- That candidate replaces the view with a security-invoker wrapper and revokes ordinary-client SELECT on both `story_trending_scores` and `story_intelligence` until trusted intake and abuse quotas are approved. The migration remains branch-only.
- The current branch browser path in `stories.html` catches a denied trending query and displays a neutral “Trending is warming up” state. `taleforge-data.js` treats intelligence enrichment as optional, so the access gate should degrade rather than block the basic story catalog. This source inspection does not prove the deployed frontend commit.
- The aggregate RPC is not a substitute for trusted reader-event intake, abuse controls, a rollout review, or a production PostgREST smoke test.

## Decision / next steps

1. Keep live access unchanged until an explicitly authorized migration rollout; do not expose raw `reader_events` to obtain ranking metrics.
2. Before enabling ranking, complete the reader-event intake deployment and abuse/quota controls, validate the aggregate RPC on disposable PostgreSQL, then run an authenticated and anonymous PostgREST smoke test against the deployed schema.
3. Verify the frontend gate and fallback against the actual deployed site commit.
4. Treat the current live behavior as “public series metadata with no reliable event-backed trending score,” not as a working production trending system.

**Safety boundary:** catalog/source inspection only. No live migration, grant/policy change, Edge deployment, generation/publication, schedule mutation, or billable Supabase branch was initiated. Automatic publishing remains NO-GO.
