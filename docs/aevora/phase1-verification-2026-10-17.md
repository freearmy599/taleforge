# Aevora Phase 1 verification checkpoint — 2026-10-17

Status: branch-only verification; production remains unchanged.

## Latest verified commit

- Commit: `63960047fdcf7e5cff523e1ea4e9a3e3134cb9eb`
- Workflow: [Aevora Edge source validation](https://github.com/freearmy599/taleforge/actions/runs/39003585384)
- Type-check and source-contract job: passed.
- Disposable PostgreSQL rehearsal job: passed, including the atomic quality-review persistence/rollback rehearsal.

The database rehearsal covered readiness invariants, concurrent series completion, reader-event integrity, trending aggregate ACLs, provider-state ACL and redaction, provider throttle concurrency, future default privileges, system-health access, chapter write ACLs, internal policyless-table grants, internal RPC EXECUTE revocation, and atomic quality-review persistence with rollback.

## Internal RPC ACL verification

The disposable fixture models broad pre-migration EXECUTE grants for `anon`, `authenticated`, and `service_role`, applies migration `20261013110000_restrict_internal_invoker_rpc_execution.sql`, and verifies:

- `PUBLIC`/browser-role inherited EXECUTE access is removed for the 12 listed internal RPC and trigger functions.
- `service_role` retains EXECUTE access.
- An ordinary `anon` caller can still perform an allowed table update whose trigger invokes the revoked trigger function.
- Direct RPC invocation fails with a permission-denied error rather than succeeding or failing for an unrelated reason.
- The runner requires explicit disposable-database opt-in, rejects Supabase database URLs, and requires an `aevora_*` database name.

The latest successful workflow includes the runtime denial checks for both `anon` and `authenticated`, and both GitHub Actions jobs passed.

## Additional generation and review hardening

The same verified branch adds regression coverage for Gemini provider-state guards in `generate-chapter` and `review-orchestrator`. The generation cooldown guard is scoped to generation requests so deterministic quality validation can still run during provider cooldown; AI quality review has its own guard immediately before the model call. Both deterministic and AI quality-review output-status transitions now go through a database-level atomic review-write primitive. The candidate primitive is covered by the latest green disposable PostgreSQL rehearsal.

## Atomic quality-review commit — branch CI verified

After the last fully green commit above, the branch adds candidate migration `20261017150000_aevora_atomic_quality_review_commit.sql` and updates both deterministic and AI quality-review paths to call `aevora_commit_quality_review`. The SECURITY INVOKER function updates only eligible output states and writes the `chapter_reviews` row in the same transaction. A stale/finalized output returns a fenced result without writing a review; a review-write error rolls back the output transition. Browser-role EXECUTE is revoked and `service_role` is explicitly granted EXECUTE.

The successful workflow run `39003244008` (commit `578697aea61ea938552ef5f847ce0a8317ec523c`) passed both jobs. The disposable rehearsal verifies successful commit, finalized-output fencing, stale-review timestamp fencing while the output remains reviewable, rollback when review persistence fails, idempotent retry/upsert, invalid review status and score rejection, and RPC ACLs. Source-contract tests verify both callers use the atomic RPC, send the observed output timestamp, and return the validated persisted score. The function now compares `updated_at` and uses wall-clock timestamps for subsequent writes. This candidate is verified on the branch only; it has not been applied to production.

## Default-privilege owner-context follow-up

Added `docs/aevora/phase1-default-privilege-owner-runbook.md` to document the safe escalation path for the `supabase_admin` default-ACL ownership blocker. It requires an authorized owner/operator context, a read-only inventory before any change, no workaround through role elevation or global-default changes, and a disposable rehearsal afterward. This is procedural documentation only; it does not change any ACL.

## Production safety boundary

No production migration, Edge Function deployment, ACL change, chapter generation or publication, schedule mutation, or billable Supabase development branch was initiated by this verification. Green CI demonstrates candidate behavior on disposable fixtures; it does not prove the candidate migrations are applied in production.

## Remaining release blockers

1. Resolve the `supabase_admin` default-privilege owner-context blocker using an authorized owner-level procedure and disposable rehearsal; do not weaken the ownership guard.
2. Implement a separately authorized, auditable human publication approval bound to the exact chapter output and policy version, enforced at the database publication transaction boundary.
3. Add/reconfirm publication race, idempotency, schedule-change, lease-loss, and outbox-trigger rollback rehearsals before automated publishing is enabled.
4. Prepare a schedule-by-schedule disposition and rollback/recovery plan before any release-readiness migration is applied.
5. Re-read live Gemini provider state before any model-backed operation. Do not probe Gemini while cooldown is active.
6. Obtain explicit production authorization before any production migration or function deployment.

The scheduler and publisher's fail-closed stop for automated publication must remain in place until the publication authorization primitive and its tests are complete.
