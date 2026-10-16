# Aevora Phase 1 — public RPC function-execution inventory
**Audit date:** 2026-10-16  
**Environment:** read-only live Supabase catalog inspection  
**Status:** inventory and review queue; no grants or function definitions changed

## Confirmed live finding

A live catalog query found 12 non-system functions in schema `public` with EXECUTE privileges available to `anon` and/or `authenticated`. None of the functions returned by the separate SECURITY DEFINER query had client EXECUTE access. The functions listed below are SECURITY INVOKER, so their table access remains subject to the caller's privileges and RLS. This reduces risk but does not make every RPC appropriate for anonymous exposure.

| Function | Initial classification | Reason / next action |
|---|---|---|
| `taleforge_score_story_opportunity(numeric,numeric,numeric,numeric,numeric)` | Likely public-safe utility | Pure score calculation; validate input bounds if called from clients. |
| `taleforge_update_updated_at()`, `update_updated_at()`, `touch_story_lifecycle_updated_at()`, `update_series_chapter_count()` | Trigger/internal | Intended for trigger execution; review grants and trigger bindings before revoking anything. |
| `get_active_story_arc_plan(uuid)` | Internal or published-only | Reads arc-plan fields; underlying RLS policy only permits rows whose series status is exactly `published`. Verify whether this function is used and whether those fields are meant to be client-readable. |
| `get_story_narrative_destination(uuid)` | Internal/high spoiler sensitivity | Returns story blueprint, ending-plan and lifecycle fields. Underlying RLS limits rows, but fields include final conflict/resolution and required payoffs. Verify that no public UI or browser RPC needs this. |
| `get_production_buffer_plan()` | Internal operational metadata | Returns series lifecycle, target buffer, active buffer, deficit and priority score. It is executable by client roles and should be treated as internal until a legitimate client use is demonstrated. |
| `taleforge_get_long_term_architecture_context(uuid)` | Internal | Reads long-term narrative architecture; underlying table has no client SELECT grant in the live catalog, but the RPC surface should still be reviewed. |
| `apply_attachment_directives(uuid)`, `prepare_next_chapter_blueprint(uuid)` | Internal mutation helpers | Intended to update planned chapter-blueprint directives. Under invoker security, RLS applies; no client call site was found in the initial repository search. |
| `refresh_story_attachment_metrics(uuid)` | Internal mutation helper | Recomputes and upserts story attachment metrics. Under invoker security, RLS applies; no client call site was found in the initial repository search. |
| `get_production_buffer_plan()` | Internal operational metadata | See above; do not expose buffer strategy through a public RPC unless intentionally designed. |

The catalog showed broad client EXECUTE ACLs on these functions, in some cases inherited from PostgreSQL's default PUBLIC EXECUTE privilege. The exact ACL must be evaluated by effective privilege, not only explicit grantee rows.

## Underlying RLS observations relevant to these RPCs

- `chapter_blueprints`, `chapter_generation_outputs`, `story_blueprints`, and `story_attachment_metrics` have RLS enabled and no policies in the live catalog; direct client reads should be blocked despite table SELECT ACLs.
- `story_arc_plan` has a client SELECT policy scoped to series with status `published`.
- `story_ending_plans` has a client SELECT policy scoped to series with status `published`.
- `story_lifecycle` has a client SELECT policy scoped by `published_at IS NOT NULL`, which is not identical to checking the current publication status. Review whether that predicate is the intended release boundary.
- `taleforge_long_term_narrative_architecture` has no client SELECT grant in the live catalog.

## Recommended next steps

1. The branch already contains candidate migration `20261013110000_restrict_internal_invoker_rpc_execution.sql`, which revokes `EXECUTE` from `PUBLIC`, `anon`, and `authenticated` for these 12 internal/trigger helper functions while preserving trusted `service_role` grants. Do not create a duplicate migration.
2. The repository's `supabase/functions/release-scheduler/contract.test.ts` has a static contract for all 12 signatures. Verify that the disposable PostgreSQL rehearsal executes the candidate migration and checks effective grants and trigger behavior; static source matching alone is not enough.
3. Complete caller inventory for every listed function across Edge Functions, triggers, scheduled jobs, SQL migrations and browser code. Initial Edge source inspection found `get_production_buffer_plan()` called by `blueprint-planner` and `generation-orchestrator`; those use trusted server clients. Continue checking all other callers before rollout.
4. Review the `story_lifecycle` SELECT predicate and the published-only conditions for story arc/ending-plan tables against the product's actual publication states.
5. Keep the candidate unapplied until disposable PostgreSQL checks, deployed-schema compatibility and rollout authorization are separately satisfied. Do not broadly revoke EXECUTE from all functions: legitimate public utilities and trigger-bound functions need separate handling.

## Caller inventory and candidate validation

- Scanning the 21 Edge Function TypeScript entrypoints found `get_production_buffer_plan()` called by `blueprint-planner` and `generation-orchestrator`; both use trusted server clients. No direct Edge Function callsite was found for the other inventoried helper RPC names.
- Live trigger catalog inspection confirmed `taleforge_update_updated_at()` is attached to chapter blueprints, generation jobs, release schedules, chapters, series and story blueprints; `touch_story_lifecycle_updated_at()` is attached to story lifecycle; `update_series_chapter_count()` is attached to chapters; and `update_updated_at()` is attached to collections, comments, profiles, ratings and stories.
- Candidate migration `20261013110000_restrict_internal_invoker_rpc_execution.sql` is already present on the branch and revokes client EXECUTE from the exact 12 internal/trigger helper functions while preserving trusted `service_role` grants. The disposable ACL rehearsal now verifies all 12 client denials, preserved service-role execution, and that a trigger still fires after client EXECUTE is revoked. [CI run 38946001150](https://github.com/freearmy599/taleforge/actions/runs/38946001150) passed.
- Base story-planning tables are also addressed by branch-only candidate `20261016220000_lock_base_story_planning_read_surfaces.sql`; its effective table/column ACL and policy-removal rehearsal passed in [CI run 38946455150](https://github.com/freearmy599/taleforge/actions/runs/38946455150).

## Release status

This remains a live read-only inventory with branch-only hardening candidates. No production ACLs, policies, migrations, functions, or application settings were modified. Function EXECUTE and story-planning read-surface hardening remain unapplied live; the broader least-privilege audit is not complete.
