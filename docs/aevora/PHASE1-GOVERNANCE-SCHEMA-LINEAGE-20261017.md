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
