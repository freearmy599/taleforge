# Aevora governance gate dependency and ACL follow-up — 2026-10-17

Scope: read-only catalog inspection of the connected live Supabase project and tracked branch source. No data rows were read or modified, and no grants, policies, functions, migrations, deployments, schedules, chapters, or publications were changed.

## Findings

### 1. Gate dependency is now identified

The live `public.taleforge_ceo_execution_gate(p_action_scope text)` calls `public.taleforge_boss_evaluate(p_action_scope)`. Both are owned by `postgres`, are `SECURITY DEFINER`, use `search_path=public`, and have effective EXECUTE for `service_role` but not `anon` or `authenticated`. The gate also checks `auth.role() = 'service_role'`.

The boss evaluator reads governance registry/dependency/health state and inserts a governance-run record. It can return `proceed_with_restrictions` for some degraded/unknown conditions; the CEO gate treats that decision as `authorized: true`. Therefore, this is a platform health/governance decision, not a per-chapter human approval token. It cannot close the missing trusted-approver requirement for publication.

### 2. Governance tables have overbroad explicit table ACLs

The live catalog reports RLS enabled but not forced for these tables, with explicit relation grants to `anon`, `authenticated`, and `service_role`:

- `public.taleforge_system_governance_registry`
- `public.taleforge_system_governance_dependencies`
- `public.taleforge_system_governance_runs`
- `public.taleforge_system_health`

Effective table privilege checks show client roles have mutation privileges at the ACL layer. Policy inspection returned a client SELECT policy only for `taleforge_system_health`; no policies were returned for the other three tables, and no client write policies were returned for any of these four. Thus the ACLs are overbroad and should be reconciled, but this query alone does **not** prove that client writes succeed through PostgREST: RLS policy enforcement is a separate gate. No write test was attempted.

This needs to be included in the broader relation-by-relation ACL reconciliation. Do not apply isolated revokes until all browser, Edge, trigger, SQL routine and operational callers are mapped and a rollback/rehearsal plan is approved.

### 3. Source provenance remains unresolved

Connected GitHub source search returned no tracked matches for `taleforge_ceo_execution_gate` or `taleforge_boss_evaluate`. The inspected governance migrations create the earlier system registry/health structures but do not define these exact routines or the `taleforge_system_governance_*` objects. Live definitions are known from catalog inspection, but the authoritative migration/source artifact is not yet recovered. Search results are not a complete historical repository archive, so this is a provenance gap—not proof the source never existed.

## Required follow-up

1. Recover the authoritative migration or platform-created SQL artifact for both governance routines and their tables.
2. Add the four governance relations to the ACL reconciliation matrix with explicit intended role-by-role privileges.
3. Keep the governance gate classified as health/policy evaluation only, not human publication approval.
4. Keep automated publishing **NO-GO** until a trusted approver identity/source and a transaction-bound approval record are defined, tested and authorized.
5. Rehearse ACL changes in a disposable database before any live rollout; current `supabase_admin` default-ACL owner limitation remains a separate blocker.

Metadata-only audit. No production changes were made.


## Follow-up: exact default-ACL grants by creator role

A second read-only catalog query grouped default privileges by the creating role, avoiding the earlier report's omission of that dimension. In schema `public`, both `postgres` and `supabase_admin` have default ACL entries granting the following to both `anon` and `authenticated`:

- Tables: `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` and the PostgreSQL-version-specific `MAINTAIN` privilege.
- Sequences: `SELECT, UPDATE, USAGE`.
- Functions: `EXECUTE`.

None of these expanded default ACL grants is grantable onward. The entries are present separately for both creator roles. This provides direct live evidence that newly created public-schema objects can inherit broad client privileges unless object-specific ACL changes or corrected defaults intervene. It does not identify who originally established the entries or prove which existing relation ACLs came from them.

The executor still lacks the required `supabase_admin` owner path, so no default privileges were altered. The remediation must be rehearsed for each creator role and object type, with before/after effective ACL checks; production changes remain blocked pending authorized owner/operator execution and caller review.


## Follow-up: live governance routine caller inventory — 2026-10-17

A read-only catalog query searched public-schema function/procedure source bodies for references to governance tables and gate routines, and checked effective EXECUTE privileges for anon, authenticated, and service_role.

The focused result set included:

- taleforge_ceo_execution_gate(text) directly invokes taleforge_boss_evaluate(text).
- taleforge_ceo_analyze_root_cause(text) calls taleforge_observe_all_systems() and then reads the latest governance run.
- taleforge_ceo_build_repair_plan() joins the legacy health table to the governance registry, another explicit cross-generation dependency.
- taleforge_ceo_run_diagnostic() reads governance-run and legacy health state.
- taleforge_observe_all_systems() iterates the governance registry and reads dependency state.
- aevora_audit_registry_consistency() and aevora_diagnose_issue_evidence(uuid) compare or combine legacy and governance registry records.

For these eight inspected routines, the catalog showed SECURITY DEFINER, owner postgres, and explicit ACL {postgres=X/postgres,service_role=X/postgres}; effective EXECUTE was false for anon and authenticated and true for service_role. Their source-level role checks remain relevant and are not replaced by ACL inspection.

This is a targeted source-body inventory, not a complete caller graph. It does not enumerate every Edge Function invocation, dynamic SQL reference, external scheduler/operator caller, or possible routine omitted by the text filters. No routine was executed as part of this inventory; no rows, grants, policies, functions, or other production state were changed.

### Implications

1. The lineage review must include cross-generation routines, not just the six relations.
2. Any future ACL plan must preserve service-role-only routine invocation and verify the same effective privilege matrix after rehearsal.
3. The search_path=public SECURITY DEFINER configuration on the CEO evaluator/gate remains an operator-reviewed security concern. Do not change it without recovered source provenance, dependency analysis, and disposable-database rehearsal.
4. Automated publication remains NO-GO; this routine inventory does not establish per-chapter human approval.


## Follow-up: broader SECURITY DEFINER search-path exposure inventory — 2026-10-17

A read-only catalog scan across public-schema routines found 69 SECURITY DEFINER routines whose configured search_path includes public. The effective EXECUTE matrix for this set was: anon = 0, authenticated = 0, service_role = 69. Of the 69, 55 specify exactly search_path=public, 11 specify search_path=public, pg_temp, and the remaining three use another public-inclusive path configuration.

A separate read-only privilege check confirmed service_role can create temporary objects in the current database, but cannot CREATE objects in public; anon and authenticated cannot CREATE in public either. PostgreSQL implicitly searches a session's temporary schema first for relation/type names when pg_temp is not explicitly placed in the search_path. Therefore, the 55 routines with exactly search_path=public are a **priority candidate set for source-level shadowing review**, especially where they use unqualified relation/type names. This is not proof that all 55 are exploitable: exploitability depends on each routine's statements, qualification, caller path, and runtime context.

### Required follow-up

1. Inventory unqualified relation/type references in the 55 exact-public-path routines, starting with routines callable by service_role through externally reachable Edge Functions.
2. Review whether each routine can safely use a fixed path such as pg_catalog, public, pg_temp, or fully qualified relation names, based on its actual dependencies.
3. Add disposable-database tests that attempt temp-object shadowing for selected routines before proposing any path change.
4. Do not bulk-edit routine definitions from this count alone. Preserve existing service-role-only EXECUTE posture and require authoritative source recovery, dependency review, and regression coverage.

This expands the security review scope; it does not authorize production changes. No functions, grants, policies, data, migrations, schedules, chapters, or publications were changed. Automated publishing remains **NO-GO**.


## Follow-up: first-pass unqualified relation reference scan — 2026-10-17

The validation workflow for the preceding audit completed successfully, including both read-only schema provenance contract tests and the disposable readiness-migration rehearsal. Workflow: https://github.com/freearmy599/taleforge/actions/runs/39042084278

A first-pass, read-only source-body scan narrowed the exact `search_path=public` candidate set to three routines with clear unqualified relation references in the inspected source preview:

- `taleforge_reassess_long_term_narrative_architecture(uuid)`: unqualified reads from `series`, `chapters`, and other architecture/thread tables.
- `taleforge_refresh_long_term_narrative_architecture(uuid)`: uses several unqualified aliases/relations in parts of the function body, while the inspected opening section also includes explicitly qualified references.
- `taleforge_verify_narrative_memory_consolidation()`: unqualified read from `series` and unqualified reference to `taleforge_narrative_memory_consolidations`.

All three were catalogued as SECURITY DEFINER with exactly `search_path=public`; effective service_role EXECUTE was true. This is a **first-pass scan**, not a complete parser or proof of exploitability. The text filter may miss formatting variants, CTEs, dynamic SQL, relation names outside the seed list, or references hidden later in a body. The next safe step is to inspect the complete definitions and callers for these three routines, then expand the scan across the full 55-routine set.

No routines were invoked, no temp objects were created, and no production state was modified. Do not alter search paths until the complete definitions, dependency/caller graph, and disposable shadowing rehearsal are reviewed. Automated publishing remains **NO-GO**.


### Caller and trigger follow-through for the three first-pass candidates

A second read-only catalog check confirmed the effective ACL for all three routines is `{postgres=X/postgres,service_role=X/postgres}`: `anon` and `authenticated` cannot execute them; `service_role` can.

The limited source-text caller search found:
- `taleforge_refresh_long_term_narrative_architecture(uuid)` is called by `taleforge_refresh_long_term_architecture_on_publish()`.
- That trigger function is attached to `public.chapters` via `trg_taleforge_refresh_long_term_architecture`, firing after chapter insert or status update.
- `taleforge_verify_narrative_memory_consolidation()` is called by `taleforge_refresh_narrative_memory_consolidation_health()`.
- No direct source-text caller was found for `taleforge_reassess_long_term_narrative_architecture(uuid)` in the searched public routine bodies.

These are source-text matches plus catalog trigger metadata, not a complete Edge Function/external caller graph. The chapter trigger makes the refresh routine higher priority for review because it runs in a publication-adjacent database path. Do not alter the trigger or function until temp-object shadowing has been safely rehearsed and a corrected fixed-path or qualified-reference definition has passed regression tests.

### Complete live-definition inspection — 2026-10-17

The complete live definitions were retrieved read-only for the three candidates and their two caller routines. This narrows the risk description beyond the initial source preview:

- **Highest priority — publication-adjacent refresh:** `taleforge_refresh_long_term_narrative_architecture(uuid)` reads from unqualified `series`, `chapters`, `story_arc_plan`, `story_blueprints`, and multiple `taleforge_narrative_*` tables, then inserts into unqualified `taleforge_long_term_narrative_architecture`. Its trigger wrapper is also SECURITY DEFINER with `search_path=public` and calls the refresh function by its schema-qualified name. The live trigger `trg_taleforge_refresh_long_term_architecture` is enabled on `public.chapters` after INSERT or status UPDATE.
- **Secondary candidate — reassessment routine:** `taleforge_reassess_long_term_narrative_architecture(uuid)` uses unqualified `series`, `chapters`, and architecture/thread relations for reads and writes, including an insert into `taleforge_long_term_narrative_architecture`. No direct source-text caller was found in the bounded routine-body search; external/Edge Function callers remain unverified.
- **Secondary candidate — memory integrity check:** `taleforge_verify_narrative_memory_consolidation()` uses unqualified `series` and `taleforge_narrative_memory_consolidations` reads. Its health-refresh wrapper invokes it by a schema-qualified function name but itself also uses `search_path=public` and unqualified health/check relations.
- The two inspected chapter triggers for publication sync and continuity extraction also have SECURITY DEFINER functions configured with `search_path=public`. Their complete live bodies were inspected: both table writes are schema-qualified (`public.publication_sync_outbox` and `public.taleforge_continuity_extraction_queue`), so this pass found no unqualified table target in those two bodies. This does not assess called routines or other trigger functions.

Because `service_role` has database TEMP privilege and can execute these routines, temporary-relation shadowing is a credible test case, not a demonstrated exploit. No temporary objects were created and no candidate routine was invoked. The safe next step is a disposable PostgreSQL rehearsal that proves whether a caller-created temporary relation can intercept each unqualified reference, followed by a tested fixed-path/fully-qualified implementation and trigger behavior regression. Do not change live definitions or trigger state as part of this audit.

The complete live definitions also confirm that `taleforge_verify_narrative_memory_consolidation()` reads unqualified `series` and `taleforge_narrative_memory_consolidations`, while `taleforge_refresh_narrative_memory_consolidation_health()` writes unqualified `taleforge_system_checks` and calls `taleforge_refresh_system_health()` without schema qualification. These are additional review candidates; no routine was invoked during inspection.


### Disposable temp-relation shadowing rehearsal added — 2026-10-17

A generic PostgreSQL-only rehearsal has been added at `scripts/test-aevora-search-path-shadowing.sh` and wired into the existing CI disposable PostgreSQL service. It creates a separately named disposable database, requires an explicit acknowledgement environment variable, and refuses to run unless the connection URL ends in `/aevora_search_path_shadowing_test`.

The rehearsal contrasts two test functions:
- A SECURITY DEFINER function with `SET search_path = public` and an unqualified `FROM series`, expected to resolve the caller's temporary `series` table first.
- A SECURITY DEFINER function with `SET search_path = pg_catalog, public, pg_temp` and explicit `FROM public.series`, expected to read the public table instead.

A static contract test checks the safety guard, expected assertions, and CI wiring. The initial rehearsal exposed a test-environment collision because an earlier disposable test had already created the generic `service_role`; the rehearsal was corrected to use its own `aevora_shadow_test_role`. Both the static contract suite and disposable PostgreSQL rehearsal then passed in [workflow 39042997008](https://github.com/freearmy599/taleforge/actions/runs/39042997008). This is a **generic PostgreSQL behavior test**, not execution of the live Aevora routines and not proof that any production function is exploitable. No production database was touched.

### Expanded exact-path candidate review — continuity and memory routines

A second read-only pass over live definitions confirmed two additional functions with real unqualified relation references under exact `search_path=public`:

- **`taleforge_consolidate_narrative_memory(uuid, integer)`** reads unqualified `chapters`, `taleforge_continuity_reconciliation_runs`, `chapter_continuity_snapshots`, `story_continuity_state`, `character_continuity_events`, `world_continuity_events`, and `taleforge_narrative_thread_events`; it inserts/upserts `taleforge_narrative_memory_consolidations`. It is SECURITY DEFINER, has `search_path=public`, and EXECUTE is available to `service_role` but not `anon` or `authenticated`. No direct caller was found by the bounded search of live public routine bodies; Edge Function, scheduler, and external callers remain unverified.
- **`taleforge_verify_plot_thread_progression()`** reads unqualified `taleforge_narrative_thread_progression`. It is SECURITY DEFINER with `search_path=public`, executable by `service_role` and not by `anon` or `authenticated`. No direct caller was found in the bounded live public routine-body search.

Two nearby functions were deliberately **not** counted as table-shadowing candidates after inspecting their full definitions:
- `taleforge_reconcile_continuity(uuid, integer)` schema-qualifies its table references with `public.`.
- `taleforge_refresh_narrative_depth_expansion(uuid)` schema-qualifies its persistent table references; its `FROM canonical` / `FROM jsonb_array_elements` regex matches are CTE/function syntax, not unqualified persistent relations.

This is a targeted source review, not a complete parser or complete caller graph. It does not establish exploitability. The generic disposable PostgreSQL rehearsal is now green in CI, which validates the mechanism but does not prove that these particular live functions can be exploited. Continue with narrow function-by-function rehearsal and caller tracing; do not change production function definitions or trigger state from this finding alone.

### Confirmed unqualified write target in memory-health wrapper

A catalog-backed relation-name scan (matching extracted SQL identifiers against actual public relations to reduce variable/CTE false positives) found one additional confirmed unqualified persistent relation reference: `taleforge_refresh_narrative_memory_consolidation_health()` inserts into `taleforge_system_checks` without schema qualification while running as SECURITY DEFINER with `search_path=public`. Its verification call is explicitly `public.taleforge_verify_narrative_memory_consolidation()`; the subsequent `taleforge_refresh_system_health()` call is unqualified and should be separately reviewed for function-resolution/caller semantics. EXECUTE is service_role-only among the inspected client roles.

The same relation-name scan's apparent `INTO profiles` match in `taleforge_verify_narrative_culture()` was reviewed and rejected as a false positive: `profiles` is a PL/pgSQL variable, while persistent relations in that function are schema-qualified. This demonstrates why the regex output is only a candidate generator and why full function definitions are required before labeling a finding.

Current confirmed unqualified persistent-relation candidates from the inspected definitions are:
1. `taleforge_refresh_long_term_narrative_architecture(uuid)` — publication-adjacent trigger path.
2. `taleforge_reassess_long_term_narrative_architecture(uuid)`.
3. `taleforge_consolidate_narrative_memory(uuid, integer)`.
4. `taleforge_verify_narrative_memory_consolidation()`.
5. `taleforge_verify_plot_thread_progression()`.
6. `taleforge_refresh_narrative_memory_consolidation_health()`.

This is not yet a claim that the six functions are exploitable, nor an exhaustive audit of all 55 routines. The next priority is to inspect all six for temp-object interaction in a controlled rehearsal, trace their actual callers, and build a narrow tested patch with schema-qualified relations (or a carefully chosen fixed search path including `pg_temp` last). Production definitions remain unchanged.

### Trigger-adjacent scope refined

The live trigger inventory was checked for all enabled, non-internal triggers whose SECURITY DEFINER functions have exact `search_path=public`. The four inspected trigger functions on `public.chapters` / `public.series` are executable by `service_role` but not `anon` or `authenticated`. Full body previews show that `enqueue_publication_sync_event`, `taleforge_enqueue_continuity_extraction`, and `taleforge_enroll_series_in_production` schema-qualify their persistent table references. The publication-trigger wrapper `taleforge_refresh_long_term_architecture_on_publish` calls the architecture refresh function with a schema-qualified function name, but that downstream refresh function still has the confirmed unqualified persistent-table references listed above. Therefore the downstream refresh is the priority; do not treat every `search_path=public` trigger function as equally risky.

### Risk-mechanism boundary and trigger write-path cross-check

The PostgreSQL rehearsal confirms the specific relation-resolution mechanism: an unqualified table reference in a SECURITY DEFINER routine with `search_path=public` can resolve a caller-session temporary relation first when that session has TEMP privilege. It does **not** establish that an untrusted user can reach the relevant same database session or invoke these functions; the inspected routines have no EXECUTE grant to `anon` or `authenticated`, while `service_role` can execute them. Treat this as a privileged-caller/session-isolation risk to validate, not an anonymous exploit finding.

A fresh read-only inspection of enabled triggers on `public.chapters`, `public.series`, and `public.story_blueprints` refined the adjacent paths:
- `enqueue_publication_sync_event()` writes `public.publication_sync_outbox` explicitly.
- `taleforge_enqueue_continuity_extraction()` writes `public.taleforge_continuity_extraction_queue` explicitly.
- `taleforge_enroll_series_in_production()` explicitly qualifies persistent `public.story_lifecycle` and `public.release_schedules` relations in its insert/select/update paths.
- `taleforge_refresh_long_term_architecture_on_publish()` explicitly invokes `public.taleforge_refresh_long_term_narrative_architecture(new.series_id)`, but that downstream routine uses unqualified persistent relations and remains the highest-priority trigger-adjacent candidate.
- The story-ending metadata trigger's function uses `search_path=public, taleforge_internal` and its inspected persistent relations are explicitly schema-qualified. It is outside the exact-`public` bucket and was not included in the six-function candidate count.

The unqualified call to `taleforge_refresh_system_health()` in `taleforge_refresh_narrative_memory_consolidation_health()` should be tracked as a dependency/caller clarity item, but PostgreSQL's temporary-schema-first behavior for relation names should not be incorrectly generalized to function resolution. The confirmed temp-relation candidate in that wrapper is its unqualified INSERT target `taleforge_system_checks`.

**Evidence limits:** GitHub source search returned no matches for the four routine names queried in the checked repository source index. This is not proof of no caller: deployed Edge Function bundles, SQL artifacts absent from the repository, scheduled jobs, and external callers remain unverified. Do not close caller mapping based on these empty search results.

### Live Edge Function caller trace — 2026-10-17

I retrieved the deployed source of all 26 functions returned by the live Supabase Edge Function inventory (read-only) and searched their source for the six exact candidate routine names listed above. No direct textual invocation of those six routines was found in the deployed Edge Function source. This materially narrows the known application-level caller map but is **not** proof that the routines are unused: PostgREST RPC calls by constructed names, SQL triggers/functions, database cron jobs, external services, and source code not present in the Edge Function bundle remain separate paths to inspect. The chapter trigger calling `taleforge_refresh_long_term_narrative_architecture(uuid)` remains the one confirmed publication-adjacent path.

The source retrieval was inventory/read-only only. No Edge Function was invoked, redeployed, or modified. The next caller-map pass should inspect live scheduled jobs and routine bodies for indirect/dynamic calls, then compare each routine's actual execution role/session path against the temp-table rehearsal. Keep all production definitions unchanged until that map and a narrow regression patch are reviewed.

### Live pg_cron caller check — 2026-10-17

A read-only query of `cron.job` found no scheduled command containing any of the six candidate routine names. The matching active HTTP-dispatch jobs are the expected orchestration paths: generation orchestrator (every 15 minutes), release scheduler (every 5 minutes), blueprint planner (every 15 minutes), Story DNA planner (every 30 minutes), arc planner (hourly), publication sync processor (every 5 minutes), semantic continuity extraction (every 10 minutes), and autonomous series creation runner (daily at 06:00 database time). These jobs dispatch Edge Functions with the service-role credential from Vault; the source audit found no direct call from the retrieved deployed Edge Function source to the six candidate routines.

This does not close indirect calls from SQL routines triggered by chapter writes or from dynamic SQL. In particular, the confirmed chapter trigger remains a caller of the architecture refresh routine, and any function called during its execution must be considered in that trigger transaction. Cron was only inspected; no job was paused, edited, or executed manually.
