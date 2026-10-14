# Aevora Phase 1 — Legacy automation approval route ADR

Date: 2026-10-14  
Branch: `aevora/release-scheduler-hardening`  
Status: decision record for implementation; not deployed.

## Context

The readiness migration deliberately leaves `automation_ready_at` NULL for existing schedules and disables legacy generation/publication flags until a trusted approval path is used. The read-only production inventory found six interval schedules with `auto_generate=true`, `auto_publish=false`, no non-dry autonomous creation run, and one schedule explicitly identified as an autonomous pipeline test. None can satisfy the autonomous-run provenance contract. Creating fake autonomous-run records or bulk-marking these rows ready is prohibited.

Aevora needs to distinguish **autonomous bootstrap approval** from **reviewed legacy/creator-studio approval**. The former proves the autonomous runner created and bootstrapped a series; the latter must prove a trusted reviewer deliberately approved a specific existing series and schedule.

## Decision required before implementation

Do not relax `taleforge_mark_release_automation_ready(uuid)` to accept missing autonomous provenance. Keep that RPC restricted to a run ID explicitly recorded in locked lifecycle metadata, and preserve its atomic checks.

Choose one of these product dispositions for each legacy schedule:

1. **Manual-only (safe default):** keep `enabled=false`, `auto_generate=false`, `auto_publish=false`, and readiness NULL. Manual, explicitly invoked workflows may remain available under their own authorization and review checks.
2. **Reviewed scheduled generation, no auto-publication:** use a separate approval RPC to approve generation only. It must keep `auto_publish=false`, record the approver/source/reason and schedule configuration snapshot, and require an explicit fresh approval if the approved configuration changes.
3. **Reviewed autonomous generation and publication:** only if separately approved as a product policy. It requires stronger review evidence, publication-specific approval, and a distinct explicit authorization—not an implication of generation approval.

Do not select option 3 merely to restore current behavior. The existing schedules have auto-publication disabled, and the current inventory does not establish that any should publish automatically.

## Proposed approval data contract

If options 2 or 3 are selected, use an append-only server-side approval ledger, not a caller-settable flag or free-form metadata alone. A proposed record should include:

- immutable approval ID and schedule/series IDs;
- approval class (`legacy_generation` or `legacy_publication`);
- approving authenticated principal and approval source;
- bounded reason/ticket reference;
- exact configuration snapshot/hash: mode, interval, timezone, chapter buffer, weekday/time, and approved automation flags;
- decision timestamp, expiration/review-by time, and revocation linkage;
- evidence references for lifecycle, content quality, safety/originality review, and whether the series is a test fixture.

The table must have no client write grants. A narrow SECURITY DEFINER RPC should verify the caller's trusted role, lock rows in the same order as enrollment/readiness (series, lifecycle, schedule), revalidate the unique series/schedule relation and current status, validate evidence and configuration, append the approval, and only then set readiness/flags atomically. The database must reject attempts to use an approval for a different schedule, altered configuration, terminal series, expired/revoked approval, or mismatched approval class.

The approval operation must not accept `automation_ready_at` as a client-supplied timestamp and must not use a custom GUC as its sole authorization mechanism. Preserve transaction-bound authorization and trigger fencing already used by the autonomous readiness path.

## Test requirements

Before enabling this route, disposable PostgreSQL tests must prove:

1. Anonymous/authenticated callers cannot invoke the approval RPC or mutate approval rows.
2. Service-role/internal callers cannot approve without explicit trusted approval evidence.
3. A legacy approval never fabricates an autonomous creation run.
4. Generation-only approval never enables auto-publication.
5. Publication approval cannot be inferred from generation approval.
6. A test-fixture series cannot be approved for production automation without an explicit override policy and recorded evidence.
7. Terminal series, missing lifecycle, duplicate/mismatched schedule, invalid cadence, stale review evidence, expired/revoked approval, and configuration drift all fail closed.
8. Concurrent approval, lifecycle transition, schedule mutation, and scheduler lease claim cannot leave a ready schedule with an unapproved configuration.
9. A revocation/pause immediately clears readiness and all automation flags; reactivation requires a new approval.
10. Audit history is append-only for API roles, and failed/rolled-back approvals leave no partial readiness state.

## Current disposition

Until the product decision and approval evidence source are defined, keep the legacy approval route **unimplemented** and all six legacy schedules unready on any readiness-gate rollout. The current migration's fail-closed cleanup is intentional. Do not apply the migration to production without a separately reviewed per-series disposition plan and explicit rollout authorization.

## Rollback / recovery gate

The current disposable PostgreSQL suite validates forward migration behavior and selected concurrency interleavings, but it is not a rollback rehearsal and does not model Supabase-managed ACL/RLS catalog state. Before production rollout, create a tested rollback plan that restores the prior trigger/function definitions and grants, accounts for any newly written approval/readiness state, and can be executed without enabling stale schedules. A rollback must prefer disabled automation over restoring an unsafe enabled state.

No production data, schedules, migrations, cron commands, or Edge Function deployments were changed to create this ADR.
