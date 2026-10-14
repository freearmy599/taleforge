# Aevora Phase 1 — Release-readiness rollout and rollback runbook

Date: 2026-10-14  
Branch: `aevora/release-scheduler-hardening`  
Status: **Planning only — NO-GO for production rollout**

## Purpose

Coordinate the `automation_ready_at` schema gate with the autonomous-series runner, scheduler, generation orchestrator, direct generation worker, and publisher. The readiness marker is only effective when every path that can generate or publish checks it.

## Preconditions before any production change

- [ ] Explicit approval for the exact rollout window and production changes.
- [ ] Current source fingerprints captured for the runner, scheduler, generation orchestrator, direct `generate-chapter`, and publisher.
- [x] The migration and runtime assertions pass against a disposable PostgreSQL 17 fixture in GitHub Actions; no billable Supabase development branch was created.
- [x] A concurrent completion-versus-readiness rehearsal passes in disposable PostgreSQL; duplicate-schedule activation and terminal-state cleanup are covered by fixture assertions.
- [ ] Replay and assertions pass against a disposable Supabase environment or an equivalently faithful fixture, including Supabase-specific RLS/ACL/catalog behavior and rollback. The plain PostgreSQL fixture does not certify Supabase-specific auth, Data API, RLS, or managed-role behavior.
- [ ] The complete live schedule inventory is reviewed by series owner/status/mode and a disposition chosen for every existing row.
- [ ] An approved plan exists for non-autonomous series. The autonomous readiness RPC intentionally requires a matching successful creation-run audit; do not weaken that evidence to activate legacy/creator-studio schedules.
- [ ] Internal API keys, service-role invocation, cron callers, and response contracts are verified for every Edge Function being deployed.
- [ ] Before/after SQL checks and rollback commands are peer-reviewed. No migration batch is inferred safe from the migration ledger alone.

## Existing schedule impact discovered by read-only inventory

A read-only aggregate join on 2026-10-14 found **six** current schedules, all `interval` mode, attached to `ongoing` series, with `enabled=true`, `auto_generate=true`, and `auto_publish=false`. None of those six series had a non-dry autonomous-creation run, and none had a `created` autonomous-run audit row. A separate grouped query found all six series have `origin_type='ai_original'` and `originality_status='pending'`.

Consequences:

- The readiness migration's fail-closed cleanup disables automatic flags for all six existing schedules because they have no readiness marker. The enrollment trigger also disables all schedules when the series is not `ongoing` or has duplicate schedule rows; the readiness RPC refuses any series that does not have exactly one schedule.
- The autonomous-only readiness RPC cannot activate these six schedules; that is intentional, not a transient error.
- A separate auditable approval mechanism for non-autonomous schedules is not implemented. Until such a path is designed, reviewed, and explicitly used, these six schedules must remain paused/manual-only after the migration.
- Do not silently classify them as autonomous, fabricate creation-run evidence, or bulk-mark them ready. Before rollout, the product owner must accept this generation pause or approve a separate per-series approval design.

## Critical deployment-order hazard

The migration replaces the enrollment trigger and adds the readiness column, while the currently deployed autonomous runner v6 still writes `enabled=true`, `auto_generate=true`, and `auto_publish=true` directly after its own bootstrap. If the migration is applied while that old runner can still execute, the old runner may re-enable a schedule with a NULL readiness marker. The branch scheduler and publisher block such a schedule, but the live versions do not yet enforce the marker.

Therefore **do not apply the migration while the old autonomous runner or old release/generation workers can execute uncoordinated**. A production rollout would need a separately approved and verified pause/fencing plan for the relevant cron dispatches, followed by schema and code deployment as one controlled window. This document does not authorize pausing or changing any cron job.

## Proposed controlled sequence

1. **Capture baseline:** record live function fingerprints, active cron job definitions, schedule aggregate and detailed reviewed inventory, migration ledger, effective grants, and current trigger/function definitions.
2. **Pause autonomous dispatch under explicit approval:** verify the exact cron jobs and in-flight requests, stop new runner/scheduler/generation dispatches, and prove no relevant invocation remains in flight. Do not assume a cron disable alone cancels requests already submitted through `pg_net`.
3. **Apply only the reviewed readiness migration:** use the exact branch migration `20261014210000_release_automation_readiness_gate.sql` after disposable-environment replay passes. Existing readiness markers remain NULL.
4. **Deploy the coordinated Edge Function set:** readiness-aware runner, scheduler, generation orchestrator, direct generator, and publisher. Confirm internal authentication and expected source fingerprints for every deployment.
5. **Run non-mutating verification:** inspect schema/trigger/RPC grants; run dry-run scheduler/orchestrator checks; verify unready schedules are reported as unready and do not claim leases, call Gemini, insert chapters, or advance schedules.
6. **Exercise a dedicated test series only:** under explicit approval and an isolated/controlled target, confirm bootstrap audit evidence, atomic readiness RPC success, one unique schedule, correct 24-hour Asia/Kolkata cadence, lease-fenced publication, and safe behavior on forced failures. Do not use a real reader-facing series as the first test.
7. **Reconcile historical rows:** review each existing series and schedule. Leave legacy or creator-studio schedules manual-only unless a separately approved auditable readiness path exists. Never bulk-set `automation_ready_at=now()`.
8. **Restore dispatch under explicit approval:** only after all gates pass, re-enable the approved cron jobs and immediately verify dispatch correlation, lease behavior, publication outcomes, and schedule advancement.
9. **Observe and retain evidence:** preserve redacted run IDs, function versions, CI links, before/after counts, and failure results without exposing story content, secrets, or internal diagnostic payloads.

## Required post-deployment assertions

- No enabled automatic schedule may have `automation_ready_at IS NULL`.
- No autonomous series may be generated or published unless it has exactly one enabled, appropriate automatic schedule and a valid readiness marker.
- A completed, cancelled, or hiatus series cannot be automatically generated or published.
- Provider-state lookup failure or active cooldown prevents Gemini-dependent work.
- Lease claim/renewal/ownership failure prevents publication and schedule advancement.
- Schedule advancement occurs only after publication is confirmed; a publisher response alone is not enough if the resulting chapter is not actually published.
- Existing manual workflows remain possible only through the explicitly intended manual mode and authorized caller path.
- RLS, grants, SECURITY DEFINER search paths, trigger side effects, and cron dispatch correlation remain compatible.

## Rollback and recovery

- Treat this as a coordinated control-plane rollback, not a simple function revert.
- If any invariant fails, keep autonomous dispatch paused under the approved incident plan and ensure schedules cannot auto-publish while the marker is absent or untrusted.
- Do not restore the legacy trigger or old runner in isolation: together they can re-enable automatic publication without readiness.
- Prefer retaining the additive readiness column and fail-closed trigger while reverting only a proven-bad code change, unless a reviewed rollback plan explicitly establishes a safer alternative.
- Reconcile in-flight leases and chapter publication status before resuming dispatch. Do not blindly advance `next_release_at`, reset lease rows, or replay a publication.
- Record the reason, affected schedule count, exact source fingerprints, recovery decision, and verification evidence.

## Current decision

**NO-GO.** This runbook is not authorization. The readiness migration has not been applied to any Supabase database. The ephemeral PostgreSQL 17 migration replay and runtime assertions pass in GitHub Actions, but Supabase-specific compatibility plus concurrency/rollback rehearsal remain outstanding. The production runner remains v6, and historical/non-autonomous schedule disposition is not yet approved. No production cron, schedule, database, generation, or publication state was changed while writing this document.
