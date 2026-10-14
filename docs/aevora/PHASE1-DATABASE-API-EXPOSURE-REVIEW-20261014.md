# Aevora Database API Exposure Review — 2026-10-14

Status: read-only finding; review required. No production permissions were changed.

## Observation

A read-only query against the connected database found that the PostgreSQL PUBLIC role has EXECUTE on the pg_net HTTP request functions `net.http_get`, `net.http_post`, and `net.http_delete`. The `net` schema also reports USAGE for the `anon` and `authenticated` roles. The same inspection did not show those client roles with table privileges on `net._http_response`, and they did not have USAGE on `cron`.

## Interpretation

This is a permission-hardening item, not evidence that an outside party has exploited the database. The database-side PostgREST exposed-schema setting was not available in the inspected settings, so client API reachability for these functions is not confirmed. Function execute grants alone do not establish that the functions are reachable over the public API.

## Safe next steps

1. Verify the project's actual PostgREST exposed schemas using supported project configuration, not assumptions based on database settings.
2. Check current Supabase guidance and pg_net requirements for safe function grants.
3. If client invocation is possible, prepare a narrowly scoped correction and confirm that the trusted role executing scheduled dispatches retains the required privileges.
4. Add a regression check for the intended schema exposure and grants.
5. Obtain explicit approval before changing production privileges.

Do not blindly revoke broad grants: a correction must preserve scheduler compatibility. No schema, grant, function, schedule, table, or production state was modified during this inspection.

## Follow-up: effective public-schema function EXECUTE inventory

A metadata-only follow-up using `has_function_privilege` confirmed 12 public-schema invoker functions currently have effective EXECUTE for `anon` and `authenticated`. Four are trigger-returning functions attached to table triggers (`taleforge_update_updated_at`, `touch_story_lifecycle_updated_at`, `update_series_chapter_count`, `update_updated_at`); this is not proof they can be meaningfully invoked through PostgREST RPC. The prepared migration `20261013110000_restrict_internal_invoker_rpc_execution.sql` revokes client EXECUTE on seven named planner/metrics functions. One additional non-trigger function, `taleforge_score_story_opportunity(numeric,numeric,numeric,numeric,numeric)`, also has effective client EXECUTE and no catalog trigger references, but it is not in that migration. Its intended audience and caller paths have not been verified, so it remains a **classification item**, not an automatic revoke. Confirm whether it is used by any client-facing workflow before extending the migration. Do not change production privileges during this audit.



## Follow-up: scoring helper and trusted-role compatibility check

The previously unclassified `public.taleforge_score_story_opportunity(numeric,numeric,numeric,numeric,numeric)` was inspected via catalog metadata and function definition (no function invocation). It is an immutable, non-`SECURITY DEFINER` pure scoring helper returning a score and decision, with no trigger references. No client call path was identified in the repository review. The branch migration now revokes inherited/client `EXECUTE` from `PUBLIC`, `anon`, and `authenticated` for this helper as well as the seven previously listed internal planner/metrics functions.

A read-only ACL check confirmed all eight target functions currently have explicit `service_role` EXECUTE grants. The proposed revokes therefore retain trusted `service_role` access; function owners retain owner privileges. This was verified against live metadata only. The migration remains branch-only and must still pass CI and an approved compatibility review before any production application.


## Follow-up: complete function inventory and trigger-helper classification

A fresh read-only catalog query confirms **12 public-schema functions** have effective EXECUTE for both `anon` and `authenticated`: eight internal planner/metrics/scoring functions plus four trigger-returning helpers. The branch migration `20261013110000_restrict_internal_invoker_rpc_execution.sql` now includes all twelve and revokes execution from `PUBLIC`, `anon`, and `authenticated`. The four trigger helpers have catalog trigger references; revoking direct EXECUTE does not prevent PostgreSQL from invoking them via their attached triggers. The migration has a regression contract, and the workflow run for commit `d35b7a5802494a52a4f6772119f2fa864fc0f33b` passed: https://github.com/freearmy599/taleforge/actions/runs/38514774575.

This is still branch-only. Live metadata shows the current client EXECUTE grants remain until an approved migration is applied. The check did not invoke any function or mutate production.

## Follow-up: schema-specific default privileges are a separate high-priority issue

A read-only `pg_default_acl` inventory confirms that **both `postgres` and `supabase_admin`** have schema-specific default privileges in `public` granting ordinary client roles broad privileges on future objects. For future tables, each owner has entries granting `anon` and `authenticated` DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, and UPDATE. Both owners also have default EXECUTE grants for future public-schema functions to `anon` and `authenticated`; default sequence privileges include SELECT, UPDATE, and USAGE. These are templates for objects created by those owners, not proof that every existing object has those grants.

This matters beyond current table cleanup: even if the prepared relation/function migrations are applied, later objects created by these owners may inherit broad client access. Do **not** issue a generic `ALTER DEFAULT PRIVILEGES` change yet. The two default-ACL owners may have different membership/ownership constraints and existing application migrations may rely on intentional public defaults. Before a fix, inventory which migration/deployment role creates objects, compare global versus schema-specific default ACLs, verify how Supabase expects these owner defaults to be managed, and prepare owner-scoped least-privilege defaults plus explicit grants for intentionally public objects. Test in an offline/disposable environment and obtain approval before production changes.

No default ACL, role membership, grant, or existing object was changed during this review.


## Follow-up: public trending views cannot see reader events under current RLS

A read-only catalog inspection of `public.story_trending_scores` and `public.story_intelligence` found that both are `security_invoker=true` views. The `story_trending_scores` definition aggregates `public.reader_events` over the last 30 days into per-series scores/counts. The only current `reader_events` policy for `anon` and `authenticated` is `INSERT` ("Public can record reader events"), with checks for visitor ID length and references to ongoing/completed series or published chapters. There is no SELECT policy on `reader_events`.

**Likely consequence:** ordinary callers using these security-invoker views cannot see the underlying `reader_events` rows under RLS, so event-derived trending counts/scores may resolve to zeros or otherwise fail to reflect actual engagement. This is a metadata/view-definition conclusion, not a claim based on reading event rows; no event payloads were queried.

Do not fix this by adding a public SELECT policy to raw `reader_events`, because it contains visitor identifiers and event-level behavior. Preferred design for review: expose only a per-series aggregate projection through a tightly defined owner-rights view or a narrowly scoped trusted RPC, ensure its SQL filters to ongoing/completed series, publish only aggregate counts/scores (never visitor IDs or raw events), and add tests that (1) anonymous event insertion remains validated, (2) raw event SELECT stays denied, (3) aggregate discovery values can be read, and (4) unpublished series never appear. Review the view owner, `security_barrier`/security-invoker semantics, grants, and RLS interactions before preparing a migration. No view, policy, grant, or data was changed.

The current `stories.html` page queries `story_trending_scores` directly for Explore ranking. Therefore, the RLS/view interaction is likely to affect reader-facing rankings, not just internal analytics.
