# Aevora Phase 1 verification checkpoint — 2026-10-17

Status: branch-only verification; production remains unchanged.

## Latest verified commit

- Commit: `3e14f354c34c6c38e0e86dfa3c7905f939db91a7`
- Workflow: [Aevora Edge source validation](https://github.com/freearmy599/taleforge/actions/runs/39000021114)
- Type-check and source-contract job: passed.
- Disposable PostgreSQL rehearsal job: passed all 16 rehearsal steps.

The database rehearsal covered readiness invariants, concurrent series completion, reader-event integrity, trending aggregate ACLs, provider-state ACL and redaction, provider throttle concurrency, future default privileges, system-health access, chapter write ACLs, internal policyless-table grants, and internal RPC EXECUTE revocation.

## Internal RPC ACL verification

The disposable fixture models broad pre-migration EXECUTE grants for `anon`, `authenticated`, and `service_role`, applies migration `20261013110000_restrict_internal_invoker_rpc_execution.sql`, and verifies:

- `PUBLIC`/browser-role inherited EXECUTE access is removed for the 12 listed internal RPC and trigger functions.
- `service_role` retains EXECUTE access.
- An ordinary `anon` caller can still perform an allowed table update whose trigger invokes the revoked trigger function.
- Direct RPC invocation fails with a permission-denied error rather than succeeding or failing for an unrelated reason.
- The runner requires explicit disposable-database opt-in, rejects Supabase database URLs, and requires an `aevora_*` database name.

A follow-up strengthened the runtime denial check to exercise both `anon` and `authenticated` roles. That follow-up must be considered pending until the workflow triggered by its commit is confirmed green; the earlier workflow run above predates that follow-up.

## Production safety boundary

No production migration, Edge Function deployment, ACL change, chapter generation or publication, schedule mutation, or billable Supabase development branch was initiated by this verification. Green CI demonstrates candidate behavior on disposable fixtures; it does not prove the candidate migrations are applied in production.

## Remaining release blockers

1. Confirm CI for the follow-up runtime test covering both browser roles.
2. Resolve the `supabase_admin` default-privilege owner-context blocker using an authorized owner-level procedure and disposable rehearsal; do not weaken the ownership guard.
3. Implement a separately authorized, auditable human publication approval bound to the exact chapter output and policy version, enforced at the database publication transaction boundary.
4. Add/reconfirm publication race, idempotency, schedule-change, lease-loss, and outbox-trigger rollback rehearsals before automated publishing is enabled.
5. Prepare a schedule-by-schedule disposition and rollback/recovery plan before any release-readiness migration is applied.
6. Re-read live Gemini provider state before any model-backed operation. Do not probe Gemini while cooldown is active.
7. Obtain explicit production authorization before any production migration or function deployment.

The scheduler and publisher's fail-closed stop for automated publication must remain in place until the publication authorization primitive and its tests are complete.
