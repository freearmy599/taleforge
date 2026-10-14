# Aevora Phase 1 — Supabase compatibility and rollback gate

Date: 2026-10-14  
Branch: `aevora/release-scheduler-hardening`  
Status: verification plan only; not deployed.

## Purpose

Define the evidence required to close the Supabase-specific compatibility and rollback gaps for the autonomous release-readiness candidate. Disposable PostgreSQL CI passing is necessary but does not establish that Supabase-managed RLS, grants, PostgREST behavior, Edge Function deployment ordering, or recovery are safe.

## Non-negotiable boundaries

- Do not apply the candidate migration to production as part of this gate.
- Do not deploy or change Edge Functions, schedules, cron, generation, or publication.
- Do not create a billable Supabase development branch.
- Use the existing project's read-only catalog inspection only where authorized and safe; otherwise record the check as blocked rather than infer a result.
- Keep all six existing schedules unapproved until a reviewed per-series disposition exists. Do not fabricate autonomous-run provenance or enable auto-publication.

## Gate A — Supabase catalog and API compatibility

Capture dated, read-only evidence for:

1. PostgreSQL version and whether the candidate column `release_schedules.automation_ready_at` is absent before migration.
2. RLS enabled/forced state and policies for every touched table.
3. Effective table-level and column-level privileges for `PUBLIC`, `anon`, `authenticated`, and `service_role`, especially `release_schedules`.
4. Function owner, `SECURITY DEFINER/INVOKER`, fixed `search_path`, and effective EXECUTE grants for every new/replaced RPC and trigger function.
5. Whether Supabase/PostgREST schema-cache refresh or function-signature changes are relevant.
6. Whether service-role access still works through the intended server-side path while client roles cannot set readiness or mutate protected control-plane fields.

For every check, record the exact query/command, timestamp, expected result, observed result, and evidence link. A failed or blocked query is not a pass. Never paste secrets, access tokens, or service-role keys into the report.

## Gate B — Disposable rollback rehearsal

Use a disposable PostgreSQL 17 fixture (not production and not a billable Supabase branch):

1. Restore the pre-candidate schema, function definitions, triggers, grants, and representative schedule rows from a versioned fixture.
2. Capture a baseline of schema objects, grants, trigger definitions, and schedule safety flags.
3. Apply the exact candidate migration and run all forward runtime and concurrency assertions.
4. Exercise rollback using a reviewed rollback script that restores the exact prior function/trigger definitions and grants; account explicitly for the new readiness column, private transaction-authorization table, and any readiness/approval state.
5. Re-run catalog/grant assertions and confirm no API role can mutate protected readiness state.
6. Confirm rollback leaves automation disabled whenever prior readiness/provenance cannot be established. Rollback must not blindly re-enable the six legacy schedules.
7. Re-run scheduler/publisher contract tests and migration replay from a clean fixture after rollback.
8. Repeat rollback after a simulated partial rollout and after a failed transaction; confirm no partial authorization or approval records remain.

Required artifacts: before/after schema diff, rollback script, test output, grant matrix, and a concise pass/fail report. Do not describe a forward migration replay as a rollback test.

## Gate C — Deployment compatibility review (no deployment)

Before proposing rollout, review the exact deployed versions and candidate versions of the enrollment trigger, autonomous-series runner, scheduler, generation orchestrator, direct generator, review entry points, and publisher.

Document a safe ordering that never leaves an old worker able to bypass readiness and never deploys a readiness-aware worker before the schema exists. If no safe ordering can be demonstrated, rollout remains blocked.

## Gate D — Legacy schedule decisions

For each of the six schedules, produce a private, reviewer-facing disposition record with:

- production series versus test fixture classification;
- lifecycle and quality/safety/originality evidence;
- current cadence and timezone;
- decision: manual-only, reviewed generation-only, or separately reviewed publication authorization;
- approver identity/source, reason, timestamp, and configuration snapshot.

Default to manual-only. Generation approval must not imply publication approval. The test fixture must not be enabled for production automation without a specifically recorded policy exception.

## Exit criteria

This gate closes only when all of the following are true:

- Supabase-specific RLS/ACL/function-grant checks have actual passing evidence.
- Forward migration and rollback both pass in a disposable fixture.
- Worker deployment ordering and rollback behavior are reviewed.
- Each legacy schedule has an explicit disposition, with no bulk approval.
- No production state was changed during verification.

Until then, Phase 1 remains open and production rollout is not authorized by these tests or documents.


## Read-only advisor evidence addendum (2026-10-14)

Supabase advisors were queried without applying SQL or changing project state.

### Security advisor

The `rls_enabled_no_policy` informational lint returned 91 findings. Its sample includes `public.release_schedules`, `public.story_attachment_metrics`, `public.publication_sync_outbox`, and `public.aevora_release_scheduler_leases`. RLS enabled without policies can be the intended deny-by-default state for server-only tables; this finding alone does not establish a vulnerability or prove grants are correct.

Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

### Performance advisor

- 68 unindexed foreign-key findings (INFO).
- 55 unused-index findings (INFO).
- 2 RLS initialization-plan findings (WARN): `chief_editor_series_health` and `chief_editor_alerts`.
- 1 duplicate-index finding (WARN): two indexes on `taleforge_narrative_memory_consolidations`.

References:
- https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
- https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index
- https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
- https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index

These are advisory inventory results only. No policies or indexes were changed; unused-index findings must not prompt automatic drops without workload evidence.

### Evidence boundary

The direct SQL catalog check remains blocked, so exact table/column grants, function security modes, and EXECUTE privileges are still unverified. Advisor results do not close Gate A. The inspected CI workflow confirms successful forward migration replay, runtime assertions, concurrency checks, and reader-event integrity/grant tests; the visible workflow steps do not establish a dedicated rollback-and-restore rehearsal. Gate B therefore remains open.

## Candidate migration rollback inventory (read-only source review, 2026-10-14)

The candidate migration was inspected at `supabase/migrations/20261014210000_release_automation_readiness_gate.sql` (blob `536e0b20c28000890641df23cb34b8653f728862`). This is a source inventory, not proof of rollback.

A rollback rehearsal must account for more than dropping `automation_ready_at`:

- **Schema:** `release_schedules.automation_ready_at`, partial index `release_schedules_ready_due_idx`, and private table `taleforge_release_readiness_authorizations` (including its RLS state and grants).
- **Replaced functions:** `taleforge_enroll_series_in_production()` and `taleforge_check_autonomous_creation_gate(...)` must be restored to their exact pre-migration definitions, not merely dropped.
- **Candidate functions:** `taleforge_lock_release_schedule_parent()`, `taleforge_revoke_ambiguous_release_schedules()`, `taleforge_protect_release_automation_readiness()`, `taleforge_mark_release_automation_ready(uuid)`, and `taleforge_guard_chapter_publication_lifecycle()` need a deliberate restore/drop disposition.
- **Triggers:** `trg_lock_release_schedule_parent`, `trg_revoke_ambiguous_release_schedules`, `trg_protect_release_automation_readiness`, and `trg_guard_chapter_publication_lifecycle` must be reconciled with the exact pre-migration trigger set and definitions.
- **Privileges:** restore the pre-migration table/column grants and function EXECUTE grants from a versioned baseline, then assert them as `PUBLIC`, `anon`, `authenticated`, and `service_role`. Do not assume the disposable fixture's grants are identical to production.
- **Data effects:** the migration intentionally disables existing unready schedules and may clear readiness/automation state through triggers. Dropping the new column cannot recover the prior values; tests must prove the rollback policy keeps schedules safely disabled unless the prior state is independently evidenced.

The migration fixture provides a minimal pre-candidate schema and an enrollment-trigger stub for disposable tests, but it is not a captured production baseline. The current migration-assertion and concurrency scripts are forward-path tests. Until a separate rollback/restore script captures and compares pre/post schema, trigger definitions, grants, and safety flags on a disposable database, **Gate B remains blocked**. No production rollback or state change was attempted.

### CI harness cross-check (2026-10-14)

The successful disposable-PostgreSQL job invokes `bash scripts/test-aevora-readiness-migration.sh`, which runs the fixture, candidate migration, and forward assertions. The same job separately invokes `scripts/test-aevora-readiness-concurrency.sh`. In workflow run [38571249545](https://github.com/freearmy599/taleforge/actions/runs/38571249545), both jobs completed successfully; the PostgreSQL job's visible step list names forward replay, runtime assertions, concurrency, and reader-event integrity/grant checks. Neither the harness source nor those visible steps performs a post-commit migration rollback/restore. This confirms the rollback gap is real, not just missing documentation.


## Rollback rehearsal implementation (2026-10-14; execution pending)

Added a fixture-scoped rollback path and wired it into the existing disposable PostgreSQL migration test runner:

- `scripts/aevora-readiness-rollback.sql` first disables all schedules and clears readiness, then removes candidate triggers/functions/index/table/column and restores the versioned fixture's pre-migration function bodies and ACLs.
- `scripts/aevora-readiness-rollback-assertions.sql` checks candidate objects are gone, the baseline enrollment trigger and creation-gate stub are restored, fixture ACLs return, and every schedule remains disabled.
- `scripts/test-aevora-readiness-migration.sh` now runs rollback and rollback assertions after the existing forward migration assertions, so the existing CI invocation exercises both directions.
- `scripts/test-aevora-readiness-rollback.sh` provides an explicit opt-in runner and refuses Supabase-hosted URLs.

Important boundary: this is a **disposable fixture rollback rehearsal**, not a production-grade rollback script. The fixture's pre-migration function bodies and grants are deliberately versioned test stand-ins; they do not prove exact production definitions or ACLs. The rollback policy intentionally does not restore any previous enabled/auto flags because provenance and approval cannot be inferred from pre-migration values. Failed-transaction recovery and Supabase-specific catalog/API behavior remain separate checks.

The runner and SQL were committed to the branch, but this environment has not run PostgreSQL locally (no `psql`/server/container runtime available), and the latest commits currently show no reported CI status. Therefore the rehearsal is **implemented but not yet verified as passing**. Gate B remains open until the CI job executes successfully and its logs are inspected; production remains untouched.


### Follow-up review — rollback ACL fidelity and static regression coverage

A second review found that replacing the fixture's autonomous-creation gate function would preserve the migration's narrowed ACL unless the fixture's original PUBLIC EXECUTE grant was explicitly restored. The rollback now restores that grant and asserts that fixture API roles can execute the baseline stub. This grant is intentionally a fixture property only; it is not a recommendation for the production function's permissions.

The readiness contract test now checks that the forward test runner includes both rollback steps, that rollback retains fail-closed schedule state, and that the standalone runner requires explicit opt-in, rejects Supabase URLs, and requires an aevora_readiness database identifier.

These are source-level regression checks. They do not substitute for actually running PostgreSQL. The branch's latest inspected commit still has no reported CI status; Gate B remains open pending an actual run and log review.


A further failure-mode review moved the schedule shutdown into its own committed transaction before rollback DDL begins. This is important because a DDL/ACL rollback error must not roll back the fail-closed schedule shutdown. The contract test now asserts this ordering. This remains source-reviewed only until disposable PostgreSQL CI executes the complete path.


The rollback assertions were extended to check the fixture baseline functions' SECURITY DEFINER and search_path attributes, not just their bodies and execute grants. This closes another class of rollback drift in the test fixture; PostgreSQL execution is still required to validate the catalog assertions.

### Disposable-target guard follow-up (2026-10-14)

The CI-invoked migration-and-rollback runner now requires the explicit marker `AEVORA_DISPOSABLE_MIGRATION_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE`, rejects Supabase-hosted URLs, and requires the database URL to identify an `aevora_readiness` disposable database. The workflow supplies the marker only for its local PostgreSQL 17 service. A source-contract test checks both the guard and workflow opt-in. This reduces accidental execution against a live database but is not a substitute for actual CI execution; the latest commit has no visible reported workflow/status result, so the PostgreSQL rehearsal remains unverified.
