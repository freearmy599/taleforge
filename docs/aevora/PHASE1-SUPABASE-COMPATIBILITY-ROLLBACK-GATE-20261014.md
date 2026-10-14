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
