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

The branch now treats `completed` as terminal for ordinary publication: scheduler and publisher both reject it, including the publisher's final status recheck. A final chapter must be published before the series transitions to completed. No post-completion exception exists in the general release path; if product later requires one, it must use a distinct explicit authorization and dedicated tests.

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
- The generation orchestrator checks readiness before provider-state lookups or AI-dependent work, and the direct `generate-chapter` blueprint path checks schedule readiness plus autonomous-series provenance before building generation context. Autonomous series with a missing/ambiguous schedule are blocked rather than treated as manual.
- Deno and Node source-contract tests were added to the branch CI workflow.

**This is still not deployment-ready.** The branch now includes a candidate migration (`20261014210000_release_automation_readiness_gate.sql`), a server-only atomic readiness RPC, a revised enrollment trigger that leaves unready automation disabled, and a tracked runner source reconstructed from deployed Edge Function v6. The runner now writes a disabled schedule, confirms bootstrap audit evidence, and only then calls the readiness RPC. Scheduler and publisher enforce the marker independently.

Repository CI has passed on the runner integration and readiness-contract checkpoints. The migration has been replayed against an ephemeral PostgreSQL 17 service in GitHub Actions. Earlier runtime assertions passed for legacy-schedule cleanup, rejection of legacy re-enable writes, RPC-only readiness-marker setting, manual-schedule compatibility, atomic readiness activation, and completed-series deactivation. One real concurrent completion-versus-readiness interleaving also passed. The latest added duplicate-schedule and non-ongoing lifecycle assertions are being revalidated in CI. This is a disposable PostgreSQL fixture—not an isolated Supabase project—so Supabase-specific RLS/ACL/catalog compatibility and broader concurrent-writer/rollback rehearsal remain outstanding, and the production runner remains unchanged. The migration intentionally leaves existing rows unready; a reviewed backfill/disposition process is still required before any production rollout. The exact runner source was recovered read-only from deployed v6 fingerprint `d7aea3c7ee29c363ee828325a69e463a35d3b2f032b1b9ff8cb120b842260c4f`; its branch implementation is versioned as `aevora-autonomous-series-runner-v3-readiness-gate`.

Next implementation gate: broaden concurrent schedule-writer/readiness-claim interleavings, rehearse rollback, verify Supabase-managed RLS/ACL compatibility without a billable branch, and design the separate audited approval route for legacy/manual-review series. The current CI checkpoints passed prepared Edge Function validation and the disposable PostgreSQL migration rehearsal, including the added manual-schedule invariant (run 38538097074). No live data or production configuration was changed by this checkpoint.



## Follow-up safety review (2026-10-14)

- The readiness migration now preserves the deployed enrollment trigger's **8-hour default interval** and UTC timezone for schedules it creates or normalizes. The autonomous runner explicitly configures its own intended 24-hour cadence and Asia/Kolkata timezone. The readiness change must not silently rewrite unrelated schedule cadence.
- The migration also disables existing schedules with a null readiness marker when they have `auto_generate` or `auto_publish` enabled. This intentionally pauses legacy automation during a migration-first rollout so old Edge Function versions cannot continue scheduled generation before the new readiness-aware workers are deployed. It does **not** mark any existing schedule ready; reviewed activation remains required.
- The readiness RPC follows the enrollment trigger's lock order (**series, then schedule**), revalidates the schedule-to-series relationship after locking, and refuses readiness when a series has anything other than exactly one release schedule. This reduces deadlock risk and rejects ambiguous schedule state; it does not replace a database uniqueness constraint or eliminate races from writers that do not follow the same lock protocol.
- The readiness marker is protected by a private transaction-bound authorization table, not a caller-settable custom PostgreSQL setting. The RPC inserts an authorization row for the current transaction and schedule, performs the readiness update, then removes the authorization row; the table grants no access to client or service roles, and the trigger runs as its tightly scoped definer to verify the row.
- The schedule trigger now refuses to reassign a ready/automatic schedule to another series. A separate after-insert/series-reassignment trigger revokes readiness and disables every schedule for a series as soon as a duplicate schedule row exists. The enrollment trigger also disables all rows when a series is not `ongoing` or schedule count is ambiguous. These protections reduce the window where a post-activation duplicate could leave one schedule eligible; existing duplicates still require explicit reconciliation.
- A disposable PostgreSQL 17 concurrency rehearsal now holds the series-row lock while another transaction changes the series to `completed`; the readiness RPC waits, re-reads the locked row, rejects activation, and the final assertion confirms the completed series remains disabled with no readiness marker. This tests one important interleaving, not every concurrent schedule writer or rollback path.
- Manual schedule semantics are now enforced at both boundaries: the database trigger rejects `schedule_mode='manual'` with either automatic flag enabled, and the publisher checks all schedules (including manual rows) so duplicate/ambiguous rows or a manual/automatic flag conflict cannot bypass readiness checks. Disposable PostgreSQL assertions verify the database rule; Edge source-contract tests verify publisher rejection.
- The scheduler skips unready schedules before claiming a lease. The publisher independently blocks autonomous series with missing/ambiguous schedule configuration and blocks any non-manual automation schedule unless it is enabled, auto-publishing, and marked ready.
- **Non-autonomous/manual-review activation remains unresolved.** The current readiness RPC intentionally requires an autonomous creation run and its bootstrap audit evidence. Therefore, existing or creator-studio series that do not have such a run cannot be activated through this RPC. The trigger leaves unready ongoing schedules disabled. Before rollout, define and implement a separate authenticated, auditable approval path for non-autonomous schedules, or explicitly keep those schedules manual-only. Do not weaken the autonomous evidence checks merely to make legacy schedules run.
- Completed, cancelled, and hiatus series are blocked by the scheduler, generation orchestrator, direct generator, and publisher; the publisher also performs a fresh status recheck before chapter insertion. This is the chosen safety policy for the current hardening branch; any future continuation/revival should require an explicit status transition back to an eligible lifecycle and fresh readiness evaluation.

- A fresh read-only grouped inventory found all six current schedules in `interval` mode, attached to ongoing series, enabled for generation, and disabled for auto-publication. No current `custom`, `weekly`, or `manual` rows appeared in that snapshot. The production constraint nevertheless permits `custom`; the proposed readiness RPC deliberately rejects it for now. If custom schedules are introduced before rollout, they will need explicit compatibility handling rather than implicit activation.
- A second read-only provenance join found that **none of those six** schedules has a non-dry autonomous-creation run or a `created` run audit row. The autonomous-only readiness RPC will not activate them, and the migration's fail-closed cleanup will pause their current generation schedules. This is an explicit rollout impact: a separate auditable per-series approval path is required if these legacy/creator-studio series should resume automation; do not manufacture autonomous provenance or bulk-mark them ready.
- The unready enrollment-trigger branch now changes only the safety flags (`enabled=false`, `auto_generate=false`, `auto_publish=false`) and update timestamp; it does not rewrite an existing schedule's mode, interval, or buffer preferences. New schedule rows retain the live 8-hour/UTC fallback; the autonomous runner explicitly sets its own 24-hour/Asia-Kolkata cadence.


- A separate read-only production aggregate confirmed 6 total schedules, all 6 enabled, all 6 with `auto_generate=true`, and 0 with `auto_publish=true`. The readiness gate therefore must cover generation as well as publication to avoid spending provider quota for schedules that cannot release.
- The branch now gates the `generation-orchestrator` schedule loop before provider-state checks, review recovery, planning refresh, or generation work. The direct `generate-chapter` blueprint path also independently checks automatic schedule readiness before building generation context. Manual generation with no automatic schedule remains available; a configured automatic schedule must be unique, enabled, and ready.

These checks are repository-side only. The live enrollment trigger was inspected read-only and currently uses an 8-hour interval fallback, confirming why the migration was adjusted to preserve it. No production changes were made.

## Read-only production schedule baseline (2026-10-14)

A read-only aggregate query against the live catalog returned six release-schedule rows: six distinct series and zero duplicate schedule rows; all six are enabled with automatic generation, zero have automatic publication enabled, zero enabled auto-publish schedules have a null `next_release_at`, zero completed-series schedules remain auto-publish-enabled, and zero schedules have missing lifecycle rows. A direct read-only query also confirmed that `automation_ready_at` does not yet exist in production, as expected because the candidate migration remains branch-only.

This is a useful baseline and means the aggregate snapshot did not show an immediately publishable auto-publish schedule at query time. It does **not** remove the trigger race: the current trigger can set `auto_publish=true` when a series is activated, and a later autonomous creation can introduce the intermediate state. The count is time-specific, not a guarantee about future writes, and it does not prove that generation workers or other callers are safe.

Before a rollout, repeat the same aggregate and a detailed reviewed inventory as a dry run, including schedule mode, next release time, series status, lifecycle state, and the approved backfill disposition. Do not expose individual series identifiers in broad audit output unnecessarily.
