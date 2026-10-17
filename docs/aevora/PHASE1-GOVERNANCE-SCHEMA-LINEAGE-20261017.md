# Aevora Phase 1 — governance schema lineage recheck

Date: 2026-10-17  
Branch: `aevora/release-scheduler-hardening`

## Scope and safety

This is a source comparison only. It does not apply SQL, query application rows, or authorize production changes.

## Tracked migration versus live catalog names

The full tracked migration `supabase/migrations/20261007043000_taleforge_system_governance.sql` defines:

- `public.taleforge_system_registry`
- `public.taleforge_system_dependencies`
- `public.taleforge_system_health`

It enables RLS and creates public SELECT policies for all three legacy-named tables.

The 2026-10-17 read-only live catalog inspection instead reported these governance relations:

- `public.taleforge_system_governance_registry`
- `public.taleforge_system_governance_dependencies`
- `public.taleforge_system_governance_runs`
- `public.taleforge_system_health`

The first two names differ from the tracked migration's names. The live `taleforge_system_governance_runs` table has no CREATE TABLE definition in the inspected migration. The tracked migration also does not define the live `taleforge_ceo_execution_gate` or `taleforge_boss_evaluate` routines. Repository searches for those exact live names returned no matching tracked definitions.

## Assessment

This is an unresolved live-schema lineage and naming mismatch. It is stronger than simply noting that a search did not find the routines, because the legacy table definitions are present and their names can be compared directly with the live names.

It is not proof that no rename or later migration exists anywhere: the migration could be outside the inspected branch or the objects could have been created through a platform SQL editor. Do not infer table equivalence solely from similar names.

## Required safe follow-up

1. Retrieve the authoritative migration history or platform-created SQL artifact for the live governance tables and routines.
2. Compare relation OIDs, columns, constraints, policies, dependencies, and routine references before deciding whether the current and legacy tables are related.
3. Reconcile ACL intent for each confirmed object and identify all Edge, browser, SQL routine, trigger, and operational callers.
4. Rehearse any proposed changes in a disposable database before seeking authorized production execution.

No production objects were changed. Automated publishing remains **NO-GO** until the separate trusted-approver and publication-boundary requirements are satisfied.


## Follow-up live catalog comparison — 2026-10-17

A second read-only catalog query compared relation OIDs, columns/defaults, constraints, and catalog dependencies for the legacy and governance-prefixed objects. The results materially strengthen the mismatch finding:

- The legacy and governance-prefixed registry/dependency relations have **different OIDs** and are distinct live tables, not just alternate names for the same relation.
- The legacy registry uses a `status` field with legacy status values and a `description` field. The governance registry instead uses `registry_status`, `failure_policy`, `allowed_actions`, `blocking_conditions`, `health_source`, and `metadata`.
- The legacy dependency table permits `required/recommended/observability`; the governance dependency table permits `required/advisory/conditional` and adds an `action_scope` JSONB field.
- The live `taleforge_system_health.system_key` foreign key references the **legacy** `taleforge_system_registry`, not the governance-prefixed registry. This is a concrete cross-generation coupling that must be preserved or deliberately migrated only after provenance and data mapping are recovered.
- The live governance-prefixed dependency table's foreign keys reference `taleforge_system_governance_registry`. Its own constraints and columns are distinct from the legacy dependency relation.
- The live `taleforge_system_governance_runs` table has its own decision/scope/level constraints and indexes; no direct dependency edge to the legacy registry was returned by this focused catalog query.

These results are catalog metadata only; no application rows were read and no mutation was attempted. Catalog dependency views are not a complete application-call graph, and the absence of a returned dependency edge does not prove that no dynamic SQL or external caller exists.

### Updated conclusion and guardrail

Treat the two registry/dependency pairs as **separate schema generations with different contracts**, not rename candidates. Do not merge, rename, drop, copy, or ACL-align them based on naming similarity. Recover the authoritative creation history and inspect the live evaluator's full definition/call graph, triggers, policies, and data semantics before proposing any schema or ACL change.

No production objects, grants, policies, functions, migrations, schedules, chapters, or publications were changed. Automated publishing remains **NO-GO**.
