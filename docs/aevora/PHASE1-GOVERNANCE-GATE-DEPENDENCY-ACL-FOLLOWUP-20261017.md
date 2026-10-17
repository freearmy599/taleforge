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
- The two inspected chapter triggers for publication sync and continuity extraction also have SECURITY DEFINER functions configured with `search_path=public`; their complete body-level shadowing risk was not assessed in this pass. Do not infer exploitability from the trigger metadata alone.

Because `service_role` has database TEMP privilege and can execute these routines, temporary-relation shadowing is a credible test case, not a demonstrated exploit. No temporary objects were created and no candidate routine was invoked. The safe next step is a disposable PostgreSQL rehearsal that proves whether a caller-created temporary relation can intercept each unqualified reference, followed by a tested fixed-path/fully-qualified implementation and trigger behavior regression. Do not change live definitions or trigger state as part of this audit.

### Disposable temp-relation shadowing rehearsal added — 2026-10-17

A generic PostgreSQL-only rehearsal has been added at `scripts/test-aevora-search-path-shadowing.sh` and wired into the existing CI disposable PostgreSQL service. It creates a separately named disposable database, requires an explicit acknowledgement environment variable, and refuses to run unless the connection URL ends in `/aevora_search_path_shadowing_test`.

The rehearsal contrasts two test functions:
- A SECURITY DEFINER function with `SET search_path = public` and an unqualified `FROM series`, expected to resolve the caller's temporary `series` table first.
- A SECURITY DEFINER function with `SET search_path = pg_catalog, public, pg_temp` and explicit `FROM public.series`, expected to read the public table instead.

A static contract test checks the safety guard, expected assertions, and CI wiring. This is a **generic PostgreSQL behavior test**, not execution of the live Aevora routines and not proof that any production function is exploitable. It is intended to validate the risk mechanism before designing a narrow fix. The new workflow must finish green before treating the rehearsal as verified. No production database was touched.
