# Aevora Phase 1 — base story-planning read-surface gap
**Audit date:** 2026-10-16  
**Environment:** live Supabase catalog/schema inspection only  
**Status:** candidate migration is branch-only; disposable rehearsal was still running at the time of this report

## Confirmed live evidence

Three base tables contain internal narrative plans or production lifecycle state:

- `public.story_arc_plan` includes central conflict, final question/answer, arc structure, character arcs, major revelations, payoffs, and ending requirements.
- `public.story_ending_plans` includes planned ending chapter, final conflict/resolution, character/world end states, required payoffs and resolutions.
- `public.story_lifecycle` includes target buffer sizes, daily chapter bounds, planned ending chapter, ending arc/requirements, required end state, completion thresholds, and ending review status.

All three tables have RLS enabled and effective client SELECT privileges. Live policy predicates:
- `story_arc_plan`: public SELECT policy checks `series.status = 'published'`.
- `story_ending_plans`: public SELECT policy checks `series.status = 'published'`.
- `story_lifecycle`: public SELECT policy checks only `series.published_at IS NOT NULL`, which is not equivalent to the current series publication status.

The live `series_status_check` constraint permits only `draft`, `ongoing`, `completed`, `hiatus`, and `cancelled`; it does **not** permit `published`. Therefore the two status='published' policies and the `get_active_story_arc_plan(uuid)` function predicate are inconsistent with the current series status model and appear ineffective for ordinary rows. The lifecycle policy remains materially broader because it checks only the historical `published_at` timestamp, potentially making ending plans and operational buffer settings readable for any series that was published at some point.

Read-only source inspection found no direct browser references to these three table names. Server-side Edge Function code does use `story_arc_plan` and `story_lifecycle` in planner, generation, and scheduling paths; those use trusted server clients. No Edge Function callsite for `story_ending_plans` was found in the inspected entrypoints. This is not proof that no external consumer exists, so migration rollout still needs a compatibility review.

## Branch-only candidate

Added `supabase/migrations/20261016220000_lock_base_story_planning_read_surfaces.sql`. It:
- fails closed if any of the three required relations is missing;
- ensures RLS is enabled;
- revokes relation-level and column-level privileges from `PUBLIC`, `anon`, and `authenticated`;
- drops client/public policies on those relations;
- deliberately preserves trusted `service_role` privileges.

The disposable internal-table rehearsal now creates fixture tables with broad client grants and public SELECT policies, applies the candidate, and asserts client access is removed while trusted server CRUD remains. It also runs a browser-source contract that rejects direct client queries of these raw planning tables.

## Validation and release boundary

At report creation, CI run [38946455150](https://github.com/freearmy599/taleforge/actions/runs/38946455150) had passed Edge type-checking and source-contract tests; the disposable PostgreSQL job had not yet completed. Record the final outcome only after the workflow finishes.

This candidate is not applied to live Supabase. No production policy, ACL, migration, Edge Function, schedule, generation, or publication was changed. Automatic publishing remains NO-GO.
