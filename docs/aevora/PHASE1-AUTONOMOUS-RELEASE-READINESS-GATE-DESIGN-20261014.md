# Aevora Phase 1 — Autonomous release readiness gate design

Date: 2026-10-14  
Branch: `aevora/release-scheduler-hardening`  
Status: design proposal only; not deployed and not applied to production.

## Decision summary

Do not treat `series.status = 'ongoing'` as sufficient proof that an autonomous series is ready to publish. The live trigger `public.taleforge_enroll_series_in_production()` currently enables a schedule and sets `auto_generate = true` and `auto_publish = true` when a series becomes ongoing. The autonomous-series runner performs lifecycle and schedule writes in later, separate PostgREST requests. The scheduler accepts `next_release_at IS NULL` as due. These facts create an observable interval in which a partially initialized series may be eligible for release.

The required invariant is:

> A schedule is eligible for generation or publication only after the series bootstrap has completed successfully, all required lifecycle and schedule rows are verified, and a trusted server-side readiness marker has been committed.

Series status, schedule existence, or a successful HTTP response alone must not imply readiness.

## Recommended data contract

Add a server-controlled readiness marker to `public.release_schedules`, preferably `automation_ready_at timestamptz NULL` (null means not ready). The field must not be writable by ordinary client roles. The marker is not a substitute for existing `enabled`, `auto_generate`, `auto_publish`, status, review, or lease checks; it is an additional prerequisite.

The migration must be designed as one transaction and include all of the following:

1. Add the readiness column and an index suitable for the due-schedule query if query plans justify it.
2. Replace the series-enrollment trigger so an unready/newly bootstrapped schedule is created with `enabled=false`, `auto_generate=false`, `auto_publish=false`, and `automation_ready_at=NULL`. A transition to `ongoing` must not unconditionally override these safeguards.
3. Define an explicit, reviewed backfill rule for existing schedules. Do not mark every row ready blindly. Preserve already-operating schedules only where series status, lifecycle row, schedule configuration, and policy conditions satisfy the agreed invariant; quarantine ambiguous rows for review.
4. Ensure lifecycle/schedule rows for a new autonomous series are created disabled and remain disabled until readiness is granted.
5. Grant the readiness transition only to the trusted server-side role/RPC path; explicitly revoke ordinary client UPDATE privileges on the readiness field and test column-level grants and RLS behavior.
6. Update the scheduler query to require non-null readiness for all real runs, including explicitly targeted runs. A targeted schedule ID must never bypass readiness. Dry-run may inspect unready schedules for diagnosis but must label them as ineligible and must not claim a lease or mutate anything.
7. Update the publisher to independently verify the readiness marker, series status, and schedule-to-series relationship before publishing. Scheduler filtering alone is insufficient because the publisher can be called directly.
8. Ensure lease-fenced schedule advancement and lifecycle activation also verify readiness and the exact schedule/series pair.

## Atomic bootstrap and activation

Preferred flow:

1. Orchestration creates the series in a non-publishable draft/preparing state.
2. A database-side transaction creates/validates the lifecycle row and creates/validates a disabled release schedule.
3. The same transaction records required bootstrap/audit state and verifies invariants.
4. Only after the prerequisites pass does a trusted activation operation set `automation_ready_at`, update the intended series/lifecycle status, and enable the approved automation flags.
5. The scheduler and publisher independently enforce readiness before any release side effect.

If product constraints require multiple Edge Function requests, keep automation disabled across those requests and make the final readiness operation a narrow server-side RPC that rechecks all prerequisites inside one transaction. A later pipeline-snapshot/audit failure must not silently undo the safety boundary or report a fully successful bootstrap; determine whether that snapshot is required for readiness and encode the choice in the RPC contract.

The trigger must not re-enable automation when an unready series is changed to `ongoing`. Do not make an unconditional `auto_publish=true` update in a status trigger. Readiness changes should be explicit and auditable.

## Compatibility and rollout requirements

- The currently deployed scheduler v12 does not call the branch's lease RPCs; production is not in a safe state for a casual schema/function rollout.
- The branch scheduler already has lease claim/renew/release and atomic advancement checks, but it does not yet enforce the proposed readiness column.
- The live runner v6 and branch scheduler/publisher must be reviewed together. Never deploy a readiness-aware scheduler before the column exists; never deploy a trigger that disables automation without a tested recovery path for currently active schedules.
- Do not silently backfill historical schedules to ready. Produce a dry-run inventory of candidate ready, incomplete, and ambiguous schedules; validate row counts and sample cases before any authorized migration.
- Use a disposable database for migration rehearsal, concurrency tests, and rollback verification. Do not create a billable Supabase branch.

## Required regression matrix

1. New draft series: lifecycle exists; schedule exists but is disabled, non-generating, non-publishing, and unready.
2. Series becomes ongoing before bootstrap completion: trigger cannot enable automation; scheduler excludes it even when `next_release_at IS NULL`.
3. Bootstrap succeeds: one atomic readiness transition enables only policy-approved flags; the scheduler sees it only after commit.
4. Lifecycle insert/update, schedule write, or audit step fails: readiness remains false and no release is eligible.
5. Retry after timeout: no duplicate lifecycle/schedule rows, no unintended activation, and no automatic publish before readiness.
6. Concurrent scheduler tick during activation: it either sees unready and skips or sees the fully committed ready state; no intermediate state.
7. Explicit schedule ID and direct publisher calls cannot bypass readiness.
8. Lease expires or is lost between readiness check and publication: existing lease-fencing and database-confirmed publication checks still stop unsafe advancement.
9. Existing active schedule backfill: valid rows preserve intended behavior; incomplete/ambiguous rows remain quarantined.
10. Transitions to hiatus/cancelled/completed: automation is disabled according to the agreed lifecycle policy, and stale schedule rows cannot publish.
11. Client roles cannot set/clear readiness or directly invoke the activation RPC.
12. Dry-run has no lease, schedule, lifecycle, or publication side effects.

## Adjacent policy gate: completed series

Current branch scheduler and publisher guards skip draft/cancelled/hiatus but do not explicitly reject completed. Decide whether completed means no further chapter may publish. If yes, reject completed at both boundaries and test stale enabled schedules/direct publisher calls. If a terminal chapter is allowed after completion, represent that exception with a distinct explicit authorization rather than the general path.

## Acceptance criteria

- The trigger no longer unconditionally enables auto-publication for unready series.
- A single trusted transaction is the only path to mark a newly bootstrapped autonomous series ready.
- Scheduler and publisher both enforce readiness.
- Existing-schedule backfill is reviewed and dry-run evidence retained.
- All regression cases pass in an isolated database and repository CI.
- Production rollout remains a separately approved operation.

No production query in this work changed data. No migration, deployment, schedule update, generation, or publication was executed.


## Branch implementation checkpoint (2026-10-14)

A branch-only enforcement prototype now exists in commit `206aed56` and later commits:

- `supabase/functions/release-scheduler/readiness.ts` fails closed on missing or malformed readiness timestamps.
- The scheduler checks the readiness marker before it can reach the publisher call; an unready targeted dry run reports `readiness_unverified_dry_run`, and a real run reports `automation_not_ready`.
- The publisher independently queries non-manual schedules for the series and rejects ambiguous, disabled, non-auto-publishing, or unready automation schedules before chapter insertion.
- Deno and Node source-contract tests were added to the branch CI workflow.

**This is not yet a deployable end-to-end change.** The branch does not yet include the schema migration that adds `release_schedules.automation_ready_at`, the revised enrollment trigger, a server-only atomic readiness RPC, or the live autonomous runner source/wiring that calls that RPC after bootstrap succeeds. The deployed autonomous runner is not present as a tracked Edge Function in this branch; do not assume changing the scheduler and publisher alone completes the rollout. Until those pieces are implemented and tested together, do not deploy either function. Existing schedules would otherwise have no readiness marker and be blocked by the new code, and the column query would fail if the schema were not migrated first.

Next implementation gate: retrieve/reconstruct and version the exact runner source, define the bootstrap transaction contract, then add an isolated-testable migration and runner integration before considering deployment. No live data or production configuration was changed by this checkpoint.


## Read-only production schedule baseline (2026-10-14)

A read-only aggregate query against the live catalog returned six release-schedule rows: six enabled, six with automatic generation enabled, zero with automatic publication enabled, zero enabled auto-publish schedules with a null `next_release_at`, zero completed-series schedules still auto-publish-enabled, and zero schedules with missing lifecycle rows.

This is a useful baseline and means the aggregate snapshot did not show an immediately publishable auto-publish schedule at query time. It does **not** remove the trigger race: the current trigger can set `auto_publish=true` when a series is activated, and a later autonomous creation can introduce the intermediate state. The count is time-specific, not a guarantee about future writes, and it does not prove that generation workers or other callers are safe.

Before a rollout, repeat the same aggregate and a detailed reviewed inventory as a dry run, including schedule mode, next release time, series status, lifecycle state, and the approved backfill disposition. Do not expose individual series identifiers in broad audit output unnecessarily.
